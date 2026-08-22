import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Story, StorySource, BriefStatus } from '../core/types';
import { Logger } from '../logger/logger';
import { validateStory } from './validator';

/**
 * 展示简讯仓库：负责 stories/ 目录下 .md 文件的读写。
 *
 * 与 BriefRepo（信源简报）分离：
 * - brief 由采集写入，只作引用，不被编辑成展示。
 * - story 由 agent 聚合信源生成，是出图的唯一数据源。
 *
 * 文件命名：{YYYYMMDD}-{seq}-{slug}.md（seq 独立计数，不含 source 段）。
 */
export class StoryRepo {
  constructor(
    private storiesDir: string,
    private invalidDir: string,
    private log: Logger
  ) {
    fs.mkdirSync(storiesDir, { recursive: true });
    fs.mkdirSync(invalidDir, { recursive: true });
  }

  /**
   * 递归读取所有展示简讯
   * @param includeExcluded 是否包含 status='excluded' 或 'duplicate'（默认 false）
   */
  list(includeExcluded = false): Story[] {
    const result: Story[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.md')) {
          const s = this.parseFile(full);
          if (s) result.push(s);
        }
      }
    };
    walk(this.storiesDir);
    return includeExcluded
      ? result
      : result.filter((s) => s.status !== 'excluded' && s.status !== 'duplicate');
  }

  /** 返回全部展示简讯（含 excluded / duplicate） */
  listAll(): Story[] {
    return this.list(true);
  }

  getById(id: string): Story | null {
    return this.listAll().find((s) => s.id === id) || null;
  }

  /**
   * 保存展示简讯（仅更新传入字段）
   */
  save(story: Partial<Story> & { id: string }): boolean {
    if (!story._filePath) {
      this.log.warn(`[story:save] 无文件路径: ${story.id}`);
      return false;
    }
    try {
      const raw = fs.readFileSync(story._filePath, 'utf8');
      const parsed = matter(raw);
      const data = { ...parsed.data };
      if (story.title !== undefined) data.title = story.title;
      if (story.summary !== undefined) data.summary = story.summary;
      if (story.aspect !== undefined) data.aspect = story.aspect;
      if (story.tags !== undefined) data.tags = story.tags;
      if (story.category !== undefined) data.category = story.category;
      if (story.status !== undefined) data.status = story.status;
      if (story.customAttrs !== undefined) data.customAttrs = story.customAttrs;
      if (story.sources !== undefined) data.sources = story.sources;
      if (story.agentMeta !== undefined) data.agentMeta = story.agentMeta;

      const out = matter.stringify(parsed.content, data);
      fs.writeFileSync(story._filePath, out, 'utf8');
      return true;
    } catch (e) {
      this.log.error(`[story:save] 保存失败: ${story.id}`, e);
      return false;
    }
  }

  /**
   * 新增展示简讯：生成文件名 + 写入 md。
   * 文件名格式：{YYYYMMDD}-{seq}-{slug}.md
   */
  create(data: {
    date: string;
    title: Record<string, string>;
    summary?: Record<string, string>;
    tags?: string[];
    category?: string;
    aspect?: string;
    customAttrs?: Record<string, string>;
    status?: BriefStatus;
    sources?: StorySource[];
    agentMeta?: Story['agentMeta'];
    body?: string;
  }): { saved: boolean; filename: string; dateDir: string; id: string; reason?: string } {
    const dateDir = data.date.substring(0, 10);
    const slug = slugify(data.title.en || Object.values(data.title).find(Boolean) || data.date);
    const seq = this.nextSeq(dateDir);
    const id = `${dateDir.replace(/-/g, '')}-${seq}-${slug}`;
    const filename = `${id}.md`;
    const filePath = path.join(this.storiesDir, dateDir, filename);

    if (fs.existsSync(filePath)) {
      return { saved: false, filename, dateDir, id, reason: 'exists' };
    }

    const story: Story = {
      id,
      date: data.date,
      title: data.title,
      summary: data.summary || {},
      tags: data.tags || [],
      category: data.category || '',
      aspect: data.aspect || '',
      customAttrs: data.customAttrs || {},
      status: data.status || 'raw',
      sources: data.sources || [],
      agentMeta: data.agentMeta,
      body: data.body || '',
    };

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fileContent = matter.stringify(story.body || '', this.toFrontmatter(story));
      fs.writeFileSync(filePath, fileContent, 'utf8');
      return { saved: true, filename, dateDir, id };
    } catch (e) {
      this.log.error(`[story:create] 写入失败: ${id}`, e);
      return { saved: false, filename, dateDir, id, reason: 'write_error' };
    }
  }

  /**
   * 解析单个 md 文件，失败移入 _invalid
   */
  parseFile(filePath: string): Story | null {
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

      const story: Story = {
        id: data.id,
        date: dateStr,
        title:
          data.title && typeof data.title === 'object'
            ? data.title
            : data.title
            ? { en: String(data.title) }
            : {},
        summary:
          data.summary && typeof data.summary === 'object'
            ? data.summary
            : data.summary
            ? { en: String(data.summary) }
            : {},
        tags: Array.isArray(data.tags) ? data.tags : [],
        category: data.category || '',
        aspect: data.aspect || '',
        customAttrs:
          data.customAttrs && typeof data.customAttrs === 'object'
            ? data.customAttrs
            : {},
        status: data.status || 'raw',
        sources: Array.isArray(data.sources) ? data.sources : [],
        agentMeta: data.agentMeta,
        body: parsed.content.trim(),
        _filePath: filePath,
      };

      const v = validateStory(story);
      if (!v.ok) {
        this.log.warn(`[story:parse] schema 校验失败: ${filePath}`, v.errors);
        return null;
      }
      return story;
    } catch (e) {
      this.log.warn(`[story:parse] 解析失败: ${filePath}`, e);
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
      this.log.info(`[story:invalid] 移走异常文件: ${filePath} → ${dest}`);
    } catch (e) {
      this.log.warn(`[story:invalid] 移走失败: ${filePath}`, e);
    }
  }

  private toFrontmatter(s: Story): Record<string, unknown> {
    const raw: Record<string, unknown> = {
      id: s.id,
      date: s.date,
      title: s.title,
      summary: s.summary,
      tags: s.tags,
      category: s.category,
      aspect: s.aspect,
      customAttrs: s.customAttrs,
      status: s.status,
      sources: s.sources,
      agentMeta: s.agentMeta || null,
    };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /**
   * 当天序号：扫描 stories 目录已存在文件，取最大 + 1（独立于 briefs 计数）
   */
  private nextSeq(dateDir: string): string {
    const dir = path.join(this.storiesDir, dateDir);
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
    return String(max + 1).padStart(2, '0');
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
