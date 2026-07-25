import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Brief } from './types';

/**
 * 读取指定目录下所有简讯 md 文件（递归子目录）
 */
export function readBriefs(briefsRoot: string): Brief[] {
  const briefs: Brief[] = [];
  if (!fs.existsSync(briefsRoot)) return briefs;

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const b = parseBriefFile(full);
        if (b) briefs.push(b);
      }
    }
  };
  walk(briefsRoot);
  return briefs;
}

function parseBriefFile(filePath: string): Brief | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data || {};

    if (!data.id || !data.date || !data.source) {
      console.warn(`[readBriefs] 跳过无效文件（缺字段）: ${filePath}`);
      return null;
    }

    // gray-matter 会把 ISO 8601 date 自动解析为 Date 对象，统一转回 ISO 字符串
    const dateStr =
      typeof data.date === 'string'
        ? data.date
        : data.date instanceof Date
        ? data.date.toISOString()
        : String(data.date);

    const title =
      data.title && typeof data.title === 'object'
        ? data.title
        : data.title
        ? { zh: String(data.title) }
        : {};
    const summary =
      data.summary && typeof data.summary === 'object'
        ? data.summary
        : data.summary
        ? { zh: String(data.summary) }
        : {};

    const brief: Brief = {
      id: data.id,
      date: dateStr,
      source: data.source,
      sourceUrl: data.sourceUrl || '',
      author: data.author,
      image: data.image,
      title,
      summary,
      originalTitle: data.originalTitle,
      originalSummary: data.originalSummary,
      tags: Array.isArray(data.tags) ? data.tags : [],
      category: data.category || '',
      aspect: data.aspect || '',
      customAttrs:
        data.customAttrs && typeof data.customAttrs === 'object'
          ? data.customAttrs
          : {},
      status: data.status || 'raw',
      agentMeta: data.agentMeta,
      body: parsed.content.trim(),
      _filePath: filePath,
    };
    return brief;
  } catch (e) {
    console.warn(`[readBriefs] 解析失败: ${filePath}`, e);
    return null;
  }
}

/**
 * 读取单条简讯 by id（扫描目录）
 */
export function readBriefById(briefsRoot: string, id: string): Brief | null {
  const all = readBriefs(briefsRoot);
  return all.find((b) => b.id === id) || null;
}

/**
 * 保存简讯回 md 文件（保留 frontmatter + body）
 * 仅更新传入字段，不覆盖未传入字段
 */
export function saveBrief(brief: Partial<Brief> & { id: string }): boolean {
  if (!brief._filePath) {
    console.warn(`[saveBrief] 无文件路径，无法保存: ${brief.id}`);
    return false;
  }
  try {
    const raw = fs.readFileSync(brief._filePath, 'utf8');
    const parsed = matter(raw);
    const data = { ...parsed.data };

    if (brief.title !== undefined) data.title = brief.title;
    if (brief.summary !== undefined) data.summary = brief.summary;
    if (brief.aspect !== undefined) data.aspect = brief.aspect;
    if (brief.tags !== undefined) data.tags = brief.tags;
    if (brief.category !== undefined) data.category = brief.category;
    if (brief.status !== undefined) data.status = brief.status;
    if (brief.customAttrs !== undefined) data.customAttrs = brief.customAttrs;
    if (brief.originalTitle !== undefined) data.originalTitle = brief.originalTitle;

    const output = matter.stringify(parsed.content, data);
    fs.writeFileSync(brief._filePath, output, 'utf8');
    return true;
  } catch (e) {
    console.error(`[saveBrief] 保存失败: ${brief.id}`, e);
    return false;
  }
}
