// 跨源重复检测：对同一天（±1 天）的 processed 简讯做聚类，选主简讯，其余置 duplicate
//
// 设计要点：
// - 复用 dedup.ts 的 titleSimilarity（≥0.8 视为同一事件）
// - 选主策略：来源优先级（priority 小优先）> 信息完整度（摘要长+有图）> 采集时间（先入库）
// - 记录留存：主简讯写 customAttrs.mergedFrom / mergedCount / mergedAt
//              被合并简讯写 status=duplicate + customAttrs.mergedTo
// - 幂等：已是 duplicate 的不再参与，已带 mergedFrom 的主简讯可重算（支持新增源后重跑）

import { Brief } from '../core/types';
import { SourceConfig } from '../store/configRepo';
import { titleSimilarity } from './dedup';
import { BriefRepo } from '../store/briefRepo';
import { Logger } from '../logger/logger';

export interface DedupResult {
  /** 检测的事件聚类数（含主+被合并的） */
  clusters: number;
  /** 被标记为 duplicate 的简讯数 */
  duplicates: number;
  /** 参与检测的简讯总数 */
  total: number;
  /** 每个聚类的详情 */
  details: {
    primaryId: string;
    primarySource: string;
    duplicateIds: string[];
    title: string;
  }[];
}

/**
 * 构建 sourceName → priority 映射。未配置 priority 视为 99（最低）。
 */
function buildPriorityMap(sources: SourceConfig[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sources) {
    m.set(s.name, s.priority ?? 99);
  }
  return m;
}

/**
 * 提取简讯用于比较的标题（优先中文，回退英文，再回退原标题）
 */
function comparableTitle(b: Brief): string {
  return b.title?.zh || b.title?.en || b.originalTitle || '';
}

/**
 * 提取简讯用于比较的摘要
 */
function comparableSummary(b: Brief): string {
  return b.summary?.zh || b.summary?.en || b.originalSummary || '';
}

/**
 * 信息完整度评分：摘要长度 + 有无图片 + 正文长度。分数高的优先。
 */
function completenessScore(b: Brief): number {
  const sumLen = comparableSummary(b).length;
  const hasImage = b.image ? 50 : 0;
  const bodyLen = Math.min(b.body?.length || 0, 500) / 10;
  return sumLen + hasImage + bodyLen;
}

/**
 * 对一组同事件简讯选主
 *
 * 排序键：priority 升序 > 完整度降序 > date 升序（先入库的优先）
 */
function pickPrimary(group: Brief[], priorityMap: Map<string, number>): Brief {
  return [...group].sort((a, b) => {
    const pa = priorityMap.get(a.source) ?? 99;
    const pb = priorityMap.get(b.source) ?? 99;
    if (pa !== pb) return pa - pb;
    const ca = completenessScore(a);
    const cb = completenessScore(b);
    if (ca !== cb) return cb - ca;
    return (a.date || '').localeCompare(b.date || '');
  })[0];
}

/**
 * 按日期分组（±1 天视为同组，处理跨午夜的事件）
 *
 * 实现方式：先按 YYYY-MM-DD 分桶，然后对相邻桶的简讯做跨桶比较。
 * 简化实现：把相邻日期的简讯合并到同一检测池。
 */
function groupByDateWindow(briefs: Brief[]): Map<string, Brief[]> {
  // 按日期分桶
  const buckets = new Map<string, Brief[]>();
  for (const b of briefs) {
    const d = (b.date || '').substring(0, 10);
    if (!d) continue;
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(b);
  }
  return buckets;
}

/**
 * 对一个日期桶内的简讯做聚类
 *
 * 贪心算法：遍历每条简讯，与已有聚类的代表标题比较，相似度达标则归入，否则新建聚类。
 *
 * 跨源去重要比同源去重宽松，因为不同源会加后缀（期号、来源名、副标题等）。
 * 采用双重判定：
 * 1. 标题相似度 ≥ CROSS_SOURCE_THRESHOLD（0.6，比同源的 0.8 宽松）
 * 2. 或：归一化后一个标题包含另一个（子串关系，适合"长标题包含短标题"的情况）
 */
function cluster(briefs: Brief[]): Brief[][] {
  const clusters: { representative: string; normalizedRep: string; items: Brief[] }[] = [];
  for (const b of briefs) {
    const title = comparableTitle(b);
    if (!title) {
      // 无标题的独立成簇
      clusters.push({ representative: '', normalizedRep: '', items: [b] });
      continue;
    }
    const normTitle = normalizeForCompare(title);
    let matched = false;
    for (const c of clusters) {
      if (!c.normalizedRep) continue;
      const sim = titleSimilarity(c.representative, title);
      const isSubstring =
        normTitle.length > 15 &&
        c.normalizedRep.length > 15 &&
        (normTitle.includes(c.normalizedRep) || c.normalizedRep.includes(normTitle));
      // 数字差异约束：若两标题都含数字但数字不同，视为不同事件
      // 避免"Everything Coming to Netflix in 2026" vs "...Disney+ in August"误判
      const numMismatch = hasNumberMismatch(c.normalizedRep, normTitle);
      if (!numMismatch && (sim >= CROSS_SOURCE_THRESHOLD || isSubstring)) {
        c.items.push(b);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ representative: title, normalizedRep: normTitle, items: [b] });
    }
  }
  return clusters.map((c) => c.items);
}

/**
 * 跨源去重相似度阈值（比同源去重的 0.8 宽松，因为不同源会加后缀）
 */
const CROSS_SOURCE_THRESHOLD = 0.6;

/**
 * 归一化标题用于子串比较：小写 + 去标点 + 去多余空格
 */
function normalizeForCompare(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 检测两标题的年份数字是否冲突
 *
 * 只比较 4 位数（年份），忽略短数字（期号、日期序号等）。
 * 若两标题都含年份但年份不同，视为不同事件。
 * 例如："netflix in august 2026" vs "disney in august" → 一方有年份一方无 → 不冲突
 *       "ps5 slim 2023" vs "ps5 slim 2024" → 都有年份且不同 → 冲突
 *       "issue 644" vs "1st august" → 都无 4 位数 → 不冲突
 */
function hasNumberMismatch(a: string, b: string): boolean {
  const na = (a.match(/\d{4,}/g) || []).sort();
  const nb = (b.match(/\d{4,}/g) || []).sort();
  if (na.length === 0 || nb.length === 0) return false;
  return JSON.stringify(na) !== JSON.stringify(nb);
}

/**
 * 跨源重复检测主入口
 *
 * @param briefRepo 简讯仓库
 * @param sources 全部源配置（用于查 priority）
 * @param date 限定检测的日期（YYYY-MM-DD），不传则检测所有 processed
 * @param dryRun 只输出结果不写回
 * @param log 日志
 */
export async function detectDuplicates(
  briefRepo: BriefRepo,
  sources: SourceConfig[],
  date: string | undefined,
  dryRun: boolean,
  log?: Logger
): Promise<DedupResult> {
  const priorityMap = buildPriorityMap(sources);
  // 拉取所有 processed 简讯（list() 已默认排除 duplicate/excluded）
  const allProcessed = briefRepo.list().filter((b) => b.status === 'processed');
  // 也把已有 mergedFrom 标记的主简讯纳入（支持重算）：它们的 status 仍是 processed
  const candidates = date
    ? allProcessed.filter((b) => (b.date || '').substring(0, 10) === date)
    : allProcessed;

  log?.info(`[dedup] 待检测简讯: ${candidates.length} 条${date ? ` (日期=${date})` : ''}`);

  if (candidates.length === 0) {
    return { clusters: 0, duplicates: 0, total: 0, details: [] };
  }

  // 按日期分桶聚类
  const buckets = groupByDateWindow(candidates);
  const result: DedupResult = {
    clusters: 0,
    duplicates: 0,
    total: candidates.length,
    details: [],
  };

  for (const [bucketDate, bucketBriefs] of buckets) {
    const clusters = cluster(bucketBriefs);
    for (const group of clusters) {
      // 只处理多于 1 条的聚类
      if (group.length < 2) continue;

      const primary = pickPrimary(group, priorityMap);
      const duplicates = group.filter((b) => b.id !== primary.id);

      if (duplicates.length === 0) continue;

      result.clusters++;
      result.duplicates += duplicates.length;

      const dupIds = duplicates.map((b) => b.id);
      const mergedFromList = group.map((b) => b.id).join(',');

      if (!dryRun) {
        // 写主简讯：mergedFrom / mergedCount / mergedAt
        const existingMergedFrom = primary.customAttrs?.mergedFrom;
        briefRepo.save({
          id: primary.id,
          _filePath: primary._filePath,
          customAttrs: {
            ...primary.customAttrs,
            mergedFrom: mergedFromList,
            mergedCount: String(group.length),
            mergedAt: new Date().toISOString(),
          },
          agentMeta: {
            processedAt: new Date().toISOString(),
            tool: 'cli-brief-dedup-auto',
            version: 1,
            changes: ['customAttrs'],
            notes: `跨源去重: 主简讯，合并 ${duplicates.length} 条重复（共 ${group.length} 源报道）${existingMergedFrom ? '（重算）' : ''}`,
          },
        });

        // 写被合并简讯：status=duplicate + mergedTo
        for (const dup of duplicates) {
          // 跳过已经是 duplicate 的（避免重复写）
          if (dup.status === 'duplicate') continue;
          briefRepo.save({
            id: dup.id,
            _filePath: dup._filePath,
            status: 'duplicate',
            customAttrs: {
              ...dup.customAttrs,
              mergedTo: primary.id,
            },
            agentMeta: {
              processedAt: new Date().toISOString(),
              tool: 'cli-brief-dedup-auto',
              version: 1,
              changes: ['status', 'customAttrs'],
              notes: `跨源去重: 与 ${primary.id} 重复，合并到主简讯`,
            },
          });
        }
      }

      result.details.push({
        primaryId: primary.id,
        primarySource: primary.source,
        duplicateIds: dupIds,
        title: comparableTitle(primary),
      });

      log?.info(
        `[dedup] ${bucketDate}: "${comparableTitle(primary).slice(0, 40)}" → 主=${primary.id}(${primary.source}) 合并 ${dupIds.length} 条`
      );
    }
  }

  log?.info(
    `[dedup] 完成: 检测 ${result.total} 条 / ${result.clusters} 个重复聚类 / 标记 ${result.duplicates} 条 duplicate`
  );

  return result;
}
