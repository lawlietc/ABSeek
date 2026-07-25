import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Brief } from '../core/types';
import { RawBrief } from '../collector/types';
import { validateBrief } from './validator';
import { contentHash, normalizeUrl } from '../collector/dedup';
import { Logger } from '../logger/logger';
import { SourceConfig } from './configRepo';

export class BriefRepo {
  constructor(
    private briefsDir: string,
    private invalidDir: string,
    private log: Logger
  ) {
    fs.mkdirSync(briefsDir, { recursive: true });
    fs.mkdirSync(invalidDir, { recursive: true });
  }

  /**
   * 递归读取所有简讯
   */
  list(): Brief[] {
    const result: Brief[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.md')) {
          const b = this.parseFile(full);
          if (b) result.push(b);
        }
      }
    };
    walk(this.briefsDir);
    return result;
  }

  getById(id: string): Brief | null {
    return this.list().find((b) => b.id === id) || null;
  }

  /**
   * 保存简讯（仅更新传入字段）
   */
  save(brief: Partial<Brief> & { id: string }): boolean {
    if (!brief._filePath) {
      this.log.warn(`[save] 无文件路径: ${brief.id}`);
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

      const out = matter.stringify(parsed.content, data);
      fs.writeFileSync(brief._filePath, out, 'utf8');
      return true;
    } catch (e) {
      this.log.error(`[save] 保存失败: ${brief.id}`, e);
      return false;
    }
  }

  /**
   * 解析单个 md 文件，失败移入 _invalid
   */
  parseFile(filePath: string): Brief | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data || {};

      const dateStr =
        typeof data.date === 'string'
          ? data.date
          : data.date instanceof Date
          ? data.date.toISOString()
          : String(data.date || new Date().toISOString());

      const title =
        data.title && typeof data.title === 'object'
          ? data.title
          : data.title
          ? { en: String(data.title) }
          : {};
      const summary =
        data.summary && typeof data.summary === 'object'
          ? data.summary
          : data.summary
          ? { en: String(data.summary) }
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

      const v = validateBrief(brief);
      if (!v.ok) {
        this.log.warn(`[parse] schema 校验失败: ${filePath}`, v.errors);
        // 校验失败不直接移走，仅返回 null；移走策略由 watcher 决定
        return null;
      }
      return brief;
    } catch (e) {
      this.log.warn(`[parse] 解析失败: ${filePath}`, e);
      this.moveToInvalid(filePath);
      return null;
    }
  }

  /**
   * 把异常文件移到 _invalid
   */
  moveToInvalid(filePath: string): void {
    try {
      const name = path.basename(filePath);
      const dest = path.join(this.invalidDir, `${Date.now()}-${name}`);
      fs.renameSync(filePath, dest);
      this.log.info(`[invalid] 移走异常文件: ${filePath} → ${dest}`);
    } catch (e) {
      this.log.warn(`[invalid] 移走失败: ${filePath}`, e);
    }
  }

  /**
   * 采集入库：生成文件名 + 写入 md
   * 文件名格式：{seq}-{source}-{slug}-{hash6}.md
   */
  saveCollected(raw: RawBrief, source: SourceConfig, existingIds: Set<string>): {
    saved: boolean;
    filename: string;
    dateDir: string;
    id: string;
    reason?: string;
  } {
    // 生成 id
    const dateDir = raw.date.substring(0, 10);
    const hash6 = contentHash(raw.title, raw.summary, raw.source).substring(0, 6);
    const slug = slugify(raw.title);
    const seq = this.nextSeq(dateDir, existingIds);
    const id = `${dateDir.replace(/-/g, '')}-${seq}-${hash6}-${source.id}-${slug}`;
    const filename = `${id}.md`;
    const filePath = path.join(this.briefsDir, dateDir, filename);

    if (fs.existsSync(filePath)) {
      return { saved: false, filename, dateDir, id, reason: 'exists' };
    }

    const brief: Brief = {
      id,
      date: raw.date,
      source: raw.sourceName,
      sourceUrl: raw.sourceUrl,
      author: raw.author,
      image: raw.image,
      title: { en: raw.title }, // 原始标题，agent 处理后补 zh
      summary: { en: raw.summary },
      originalTitle: raw.title,
      originalSummary: raw.summary,
      tags: raw.tags || source.defaultTags || [],
      category: source.defaultCategory || '',
      aspect: '',
      customAttrs: {},
      status: 'raw',
      body: raw.body || raw.content || '',
    };

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fileContent = matter.stringify(brief.body || '', this.toFrontmatter(brief));
      fs.writeFileSync(filePath, fileContent, 'utf8');
      return { saved: true, filename, dateDir, id };
    } catch (e) {
      this.log.error(`[saveCollected] 写入失败: ${id}`, e);
      return { saved: false, filename, dateDir, id, reason: 'write_error' };
    }
  }

  private toFrontmatter(b: Brief): Record<string, unknown> {
    return {
      id: b.id,
      date: b.date,
      source: b.source,
      sourceUrl: b.sourceUrl,
      author: b.author,
      image: b.image,
      title: b.title,
      summary: b.summary,
      originalTitle: b.originalTitle,
      originalSummary: b.originalSummary,
      tags: b.tags,
      category: b.category,
      aspect: b.aspect,
      customAttrs: b.customAttrs,
      status: b.status,
      agentMeta: b.agentMeta || null,
    };
  }

  /**
   * 当天序号：扫描已存在的文件 + 内存 ids，取最大+1
   */
  private nextSeq(dateDir: string, existingIds: Set<string>): string {
    const dir = path.join(this.briefsDir, dateDir);
    let max = 0;
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const m = f.match(/^(\d{8})-(\d{2})-/);
        if (m) {
          const n = parseInt(m[2], 10);
          if (n > max) max = n;
        }
      }
    }
    // 也考虑内存中的（同批次多次入库）
    const prefix = dateDir.replace(/-/g, '');
    for (const id of existingIds) {
      if (id.startsWith(prefix + '-')) {
        const m = id.match(/^(\d{8})-(\d{2})-/);
        if (m) {
          const n = parseInt(m[2], 10);
          if (n > max) max = n;
        }
      }
    }
    return String(max + 1).padStart(2, '0');
  }

  /**
   * 构建去重索引：返回最近 N 天简讯的 sourceUrl / contentHash 集合
   */
  buildDedupIndex(ttlDays: number): {
    urls: Set<string>;
    hashes: Set<string>;
    titles: { title: string; url: string }[];
  } {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    const titles: { title: string; url: string }[] = [];

    const cutoff = Date.now() - ttlDays * 24 * 3600 * 1000;
    const all = this.list();
    for (const b of all) {
      const ts = new Date(b.date).getTime();
      if (ts < cutoff) continue;
      if (b.sourceUrl) urls.add(normalizeUrl(b.sourceUrl));
      const titleEn = b.title.en || b.originalTitle || '';
      const sumEn = b.summary.en || b.originalSummary || '';
      hashes.add(contentHash(titleEn, sumEn, b.source));
      titles.push({ title: titleEn, url: b.sourceUrl });
    }
    return { urls, hashes, titles };
  }
}

function slugify(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
}
