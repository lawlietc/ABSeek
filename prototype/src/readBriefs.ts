import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Brief } from './shared/types';

/**
 * 读取 mock 目录下所有简讯文件并解析为 Brief[]
 * 目录结构：data/mock/briefs/{date}/*.md
 * 文件名：{YYYYMMDD}-{seq}-{hash6}-{source}-{slug}.md
 */
export function readBriefs(briefsRoot: string): Brief[] {
  const briefs: Brief[] = [];

  if (!fs.existsSync(briefsRoot)) {
    console.warn(`[readBriefs] 目录不存在: ${briefsRoot}`);
    return briefs;
  }

  // 遍历日期目录
  const dateDirs = fs
    .readdirSync(briefsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dateDir of dateDirs) {
    const dirPath = path.join(briefsRoot, dateDir);
    const files = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = matter(raw);
        const data = parsed.data as Partial<Brief>;

        // 基础校验：必须有 id / date / source
        if (!data.id || !data.date || !data.source) {
          console.warn(`[readBriefs] 跳过无效文件（缺字段）: ${file}`);
          continue;
        }

        // title / summary 容错：支持嵌套对象或旧版字符串
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
          date: data.date,
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
        };

        briefs.push(brief);
      } catch (err) {
        console.error(`[readBriefs] 解析失败: ${file}`, err);
      }
    }
  }

  console.log(`[readBriefs] 共读取 ${briefs.length} 条简讯`);
  return briefs;
}
