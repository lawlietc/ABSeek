import * as crypto from 'crypto';

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'source',
  'track',
  'tracking',
];

/**
 * URL 规范化：去 tracking 参数、http→https、去末尾 /
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:') u.protocol = 'https:';
    // 去末尾斜杠（仅 path 非 /）
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    // 去 tracking 参数
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * 内容哈希：hash(title + summary + source)
 */
export function contentHash(title: string, summary: string, source: string): string {
  const text = `${title}|${summary}|${source}`.toLowerCase().trim();
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').substring(0, 12);
}

/**
 * 标题相似度：归一化后比较，0-1
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // 简单 Jaccard 相似度（按词）
  const sa = new Set(na.split(/\s+/).filter(Boolean));
  const sb = new Set(nb.split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function normalizeTitle(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 标题相似度阈值（默认 0.8 视为重复）
 */
export const TITLE_SIMILARITY_THRESHOLD = 0.8;
