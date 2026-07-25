import { SourceConfig } from '../store/configRepo';
import { RawBrief } from '../collector/types';

/**
 * 最小规则引擎：
 * - 应用 defaultTags / defaultCategory
 * - HTML 实体清理
 * - 日期标准化（ISO 8601）
 * - 关键词打标（基于来源配置的 defaultTags，复杂分类交给外部 agent）
 */
export function applyRules(raw: RawBrief, source: SourceConfig): RawBrief {
  let title = cleanText(raw.title);
  let summary = cleanText(raw.summary);
  const content = raw.content ? cleanText(raw.content) : undefined;

  // 应用默认标签
  const tags = new Set<string>(raw.tags || []);
  if (source.defaultTags) {
    for (const t of source.defaultTags) tags.add(t);
  }

  // 简单关键词打标：根据标题/摘要命中关键词补充标签
  const text = `${title} ${summary}`.toLowerCase();
  const keywordTags = matchKeywordTags(text);
  for (const t of keywordTags) tags.add(t);

  // 日期标准化
  const date = normalizeDate(raw.date);

  return {
    ...raw,
    title,
    summary: summary.slice(0, 500),
    content,
    date,
    tags: [...tags],
  };
}

/**
 * 关键词 → 标签映射（最小实现，可后续扩展为配置）
 */
const KEYWORD_MAP: Record<string, string[]> = {
  DLC: ['dlc', 'expansion', '扩展'],
  手游: ['mobile', '手游', 'ios', 'android'],
  电竞: ['esports', '电竞', 'tournament'],
  VR: ['vr', 'virtual reality'],
  独立: ['indie', '独立'],
  '3A': ['aaa', '3a'],
};

function matchKeywordTags(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, kws] of Object.entries(KEYWORD_MAP)) {
    if (kws.some((k) => text.includes(k))) tags.push(tag);
  }
  return tags;
}

function cleanText(s: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '') // 去 HTML 标签
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
