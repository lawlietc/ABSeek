import * as path from 'path';
import { SourceConfig, SourcesFile, ProxyConfig } from '../store/configRepo';
import { BriefRepo } from '../store/briefRepo';
import { RawBrief, CollectResult, TestConnectionResult } from './types';
import { collectRss } from './rssAdapter';
import { collectStatic } from './crawlerAdapter';
import { applyRules } from '../rules/ruleEngine';
import { normalizeUrl, contentHash, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from './dedup';
import { Logger } from '../logger/logger';

/**
 * 拉取单个 source 的原始数据（带代理降级重试）
 *
 * 行为：
 * - 先按传入的 proxy 配置采集（可能是 manual 或 none）
 * - 如果失败 且 当前用的是代理（mode !== 'none'），自动降级为 mode:'none' 再试一次
 * - 降级仍失败则抛出最后一次的错误
 *
 * 这样海外源默认走 Clash 代理，代理挂了/证书错时自动回退直连，
 * 避免单个源失败拖垮整次采集。
 */
async function fetchWithFallback(
  source: SourceConfig,
  proxy: ProxyConfig
): Promise<RawBrief[]> {
  const tryFetch = async (p: ProxyConfig): Promise<RawBrief[]> => {
    if (source.type === 'rss') return collectRss(source, p);
    if (source.type === 'crawler-static') return collectStatic(source, p);
    throw new Error(`不支持的采集类型: ${source.type}`);
  };

  try {
    return await tryFetch(proxy);
  } catch (e) {
    // 当前已经是直连，没有降级空间，直接抛出
    if (proxy.mode === 'none') throw e;
    // 当前是代理，降级为直连重试一次
    // 注意：这里不记录为业务错误，降级是预期内的容错行为
    return await tryFetch({ ...proxy, mode: 'none' });
  }
}

export class Collector {
  constructor(
    private repo: BriefRepo,
    private log: Logger
  ) {}

  /**
   * 采集单个 source：拉取 → 去重 → 入库
   */
  async collect(source: SourceConfig, sourcesFile: SourcesFile): Promise<CollectResult> {
    const rawBriefs: RawBrief[] = [];
    const proxy = source.request?.useProxy ? sourcesFile.global.proxy : { mode: 'none' as const };

    try {
      rawBriefs.push(...(await withRetry(() => fetchWithFallback(source, proxy), source.request)));
    } catch (e: any) {
      this.log.error(`[collect] 拉取失败: ${source.id}`, e);
      throw e;
    }

    // 规则引擎处理
    const processed = rawBriefs.map((r) => applyRules(r, source));

    // 去重
    const dedup = this.repo.buildDedupIndex(sourcesFile.global.dedup.ttlDays);
    const newBriefs: RawBrief[] = [];
    const existingIds = new Set<string>();
    let dupCount = 0;

    for (const r of processed) {
      const url = normalizeUrl(r.sourceUrl);
      const hash = contentHash(r.title, r.summary, r.source);

      // 第一级：URL
      if (url && dedup.urls.has(url)) {
        dupCount++;
        continue;
      }
      // 第二级：内容哈希
      if (dedup.hashes.has(hash)) {
        dupCount++;
        continue;
      }
      // 第三级：标题相似度
      const similar = dedup.titles.some(
        (t) => titleSimilarity(t.title, r.title) >= TITLE_SIMILARITY_THRESHOLD
      );
      if (similar) {
        dupCount++;
        continue;
      }

      // 入库
      const res = this.repo.saveCollected(r, source, existingIds);
      if (res.saved) {
        existingIds.add(res.id);
        newBriefs.push(r);
        // 同步更新去重索引，避免同批次重复入库
        if (url) dedup.urls.add(url);
        dedup.hashes.add(hash);
        dedup.titles.push({ title: r.title, url: r.sourceUrl });
      } else if (res.reason === 'exists') {
        dupCount++;
      }
    }

    this.log.info(
      `[collect] ${source.id} 拉取 ${rawBriefs.length} 条 / 去重 ${dupCount} / 新增 ${newBriefs.length}`
    );

    return {
      source,
      fetched: rawBriefs.length,
      rawBriefs: newBriefs,
    };
  }

  /**
   * 测试连接（不写入正式库）
   */
  async testConnection(source: SourceConfig, sourcesFile: SourcesFile): Promise<TestConnectionResult> {
    try {
      const proxy = source.request?.useProxy ? sourcesFile.global.proxy : { mode: 'none' as const };
      const rawBriefs = await fetchWithFallback(source, proxy);
      return {
        success: true,
        fetched: rawBriefs.length,
        sample: rawBriefs.slice(0, 3).map((r) => ({
          title: r.title,
          link: r.sourceUrl,
          date: r.date,
        })),
      };
    } catch (e: any) {
      return {
        success: false,
        fetched: 0,
        sample: [],
        error: e?.message || String(e),
      };
    }
  }
}

/**
 * 带重试的拉取
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  req?: { retry?: number; retryDelayMs?: number }
): Promise<T> {
  const max = req?.retry ?? 0;
  const delay = req?.retryDelayMs ?? 3000;
  let lastErr: unknown;
  for (let i = 0; i <= max; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < max) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
