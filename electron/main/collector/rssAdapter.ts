import RSSParser from 'rss-parser';
import { SourceConfig, ProxyConfig } from '../store/configRepo';
import { RawBrief } from './types';
import { createAgent } from './proxy';

/**
 * RSS 采集器
 * 通过 rss-parser 拉取，代理通过 requestOptions.agent 注入
 *
 * 注意：rss-parser 的 parseURL(url, callback) 第二参是回调函数，
 * requestOptions 必须在构造 parser 时通过 options.requestOptions 传入，
 * 因此每个 source 创建独立的 parser 实例（代理/UA 可能不同）。
 */
export async function collectRss(
  source: SourceConfig,
  proxy: ProxyConfig
): Promise<RawBrief[]> {
  const agent = createAgent(proxy);
  const requestOptions: Record<string, unknown> = {};
  if (agent) {
    (requestOptions as any).agent = agent;
  }

  const parser = new RSSParser({
    timeout: source.request?.timeoutMs || 20000,
    headers: {
      'User-Agent': source.request?.userAgent || 'ABSeek/1.0 (+https://github.com/abseek)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    requestOptions,
  });

  const feed = await parser.parseURL(source.url);
  const mapping = source.fieldMapping;
  const items = feed.items || [];

  const rawBriefs: RawBrief[] = [];
  for (const item of items) {
    const title = pickStr(item, mapping?.title || 'title');
    const link = pickStr(item, mapping?.link || 'link');
    const dateStr = pickStr(item, mapping?.date || 'pubDate');
    const summary = pickStr(item, mapping?.summary || 'contentSnippet');
    const content = mapping?.content ? pickStr(item, mapping.content) : undefined;
    const author = mapping?.author ? pickStr(item, mapping.author) : undefined;
    const image = mapping?.image ? pickStr(item, mapping.image) : undefined;

    if (!title || !link) continue;

    rawBriefs.push({
      title: stripHtml(title),
      summary: stripHtml(summary).slice(0, 500),
      content,
      date: normalizeDate(dateStr),
      source: source.id,
      sourceName: source.name,
      sourceUrl: link,
      author,
      image,
      body: content,
    });
  }
  return rawBriefs;
}

/**
 * 从 rss item 上取字符串字段，支持点号嵌套（如 enclosure.url）
 */
function pickStr(item: any, p: string): string {
  if (!p) return '';
  const parts = p.split('.');
  let cur: any = item;
  for (const k of parts) {
    if (cur == null) return '';
    cur = cur[k];
  }
  if (cur == null) return '';
  return String(cur);
}

function stripHtml(s: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(s: string): string {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}
