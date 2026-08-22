// v0.9 自动化出图：按 status 筛选当日简讯 → 按 default-bindings 渲染多模板 → 落盘

import * as fs from 'fs';
import * as path from 'path';
import { Brief, Story, TemplateBrief } from './types';
import { loadTemplateConfig, paginate, loadDefaultBindings } from './router';
import { renderHtml, flattenForLang, flattenStoryForLang } from './render';
import { screenshot } from './screenshot';
import { BriefRepo } from '../store/briefRepo';
import { StoryRepo } from '../store/storyRepo';
import { Logger } from '../logger/logger';

export interface AutoExportOptions {
  /** ISO 日期字符串 YYYY-MM-DD，默认今天 */
  date?: string;
  /** 简讯状态白名单 */
  statusFilter: string[];
  /** 出图语言列表 */
  langs: string[];
}

export interface AutoExportResult {
  success: boolean;
  files: string[];
  outputDir: string;
  /** 筛选后的简讯数量 */
  briefCount: number;
  error?: string;
}

/**
 * 筛选当日符合 status 白名单的简讯
 */
export function filterBriefsForAutoExport(
  briefs: Brief[],
  dateStr: string,
  statusFilter: string[]
): Brief[] {
  return briefs.filter((b) => {
    // 日期匹配（按 YYYY-MM-DD 比较）
    const briefDate = b.date?.substring(0, 10);
    if (briefDate !== dateStr) return false;
    // status 白名单（空数组视为不放行任何简讯）
    if (!statusFilter.includes(b.status)) return false;
    return true;
  });
}

/**
 * 筛选当日符合 status 白名单的展示简讯（与 brief 版同规则）
 */
export function filterStoriesForAutoExport(
  stories: Story[],
  dateStr: string,
  statusFilter: string[]
): Story[] {
  return stories.filter((s) => {
    const storyDate = s.date?.substring(0, 10);
    if (storyDate !== dateStr) return false;
    if (!statusFilter.includes(s.status)) return false;
    return true;
  });
}

/**
 * 通用渲染循环：按 aspect 分组 → default-bindings 渲染多模板 → 截图落盘。
 * @param flatten (item, lang, onMissingLang) 展平函数，brief 与 story 各自传入
 */
async function renderBindings(
  items: Array<{ aspect: string; date: string }>,
  templatesDir: string,
  configDir: string,
  outputRootDir: string,
  exportDate: string,
  langs: string[],
  flatten: (
    item: any,
    lang: string,
    onMissingLang: 'fallback' | 'skip'
  ) => TemplateBrief | null,
  log?: Logger
): Promise<{ success: boolean; files: string[]; outputDir: string; briefCount: number; error?: string }> {
  if (items.length === 0) {
    return { success: true, files: [], outputDir: '', briefCount: 0 };
  }

  let bindings: { aspect: string; templateId: string }[] = [];
  try {
    bindings = loadDefaultBindings(configDir);
  } catch (e) {
    log?.warn('[autoExport] 读取 default-bindings 失败，跳过出图', e);
    return { success: false, files: [], outputDir: '', briefCount: items.length, error: 'no bindings' };
  }

  const datedOutputDir = path.join(outputRootDir, exportDate);
  fs.mkdirSync(datedOutputDir, { recursive: true });
  const files: string[] = [];

  for (const binding of bindings) {
    const aspectItems = items.filter((b) => b.aspect === binding.aspect);
    if (aspectItems.length === 0) continue;

    const config = loadTemplateConfig(templatesDir, binding.templateId);
    for (const lang of langs) {
      const flat = aspectItems
        .map((b) => flatten(b, lang, config.output.onMissingLang))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pages = paginate(flat, config.limit.maxBriefs);

      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pagination = { page, total: pages.length };
        const html = renderHtml(
          path.join(templatesDir, binding.templateId),
          config,
          pages[i],
          pagination,
          exportDate,
          lang
        );
        const filename = config.output.filename
          .replace('{{date}}', exportDate)
          .replace('{{templateId}}', config.id)
          .replace('{{aspect}}', binding.aspect)
          .replace('{{page}}', String(page))
          .replace('{{lang}}', lang);
        const outPath = path.join(datedOutputDir, filename);
        await screenshot(html, config, outPath);
        files.push(filename);
      }
    }
  }

  log?.info(`[autoExport] 完成，导出 ${files.length} 张图到 ${datedOutputDir}`);
  return { success: true, files, outputDir: datedOutputDir, briefCount: items.length };
}

/**
 * 自动化出图：筛选 → 按 aspect 分组 → default-bindings 渲染多模板 → 落盘
 *
 * 注意：本函数复用 main/index.ts 的 export:current 逻辑，按日期子目录输出，
 * 文件名与手动导出保持一致，便于复用历史导出目录。
 */
export async function runAutoExport(
  briefRepo: BriefRepo,
  templatesDir: string,
  configDir: string,
  outputRootDir: string,
  options: AutoExportOptions,
  log?: Logger
): Promise<AutoExportResult> {
  const exportDate = options.date || new Date().toISOString().substring(0, 10);
  const langs = options.langs.length > 0 ? options.langs : ['zh'];
  const statusFilter = options.statusFilter.length > 0
    ? options.statusFilter
    : ['processed', 'reviewed'];

  try {
    const allBriefs = briefRepo.list();
    const selected = filterBriefsForAutoExport(allBriefs, exportDate, statusFilter);
    log?.info(`[autoExport] 日期=${exportDate} status=${statusFilter.join(',')} 筛选到 ${selected.length} 条`);

    if (selected.length === 0) {
      // 没有符合的简讯也视为成功（仅产出 0 张图），避免触发重试
      return { success: true, files: [], outputDir: '', briefCount: 0 };
    }

    return await renderBindings(
      selected,
      templatesDir,
      configDir,
      outputRootDir,
      exportDate,
      langs,
      flattenForLang,
      log
    );
  } catch (e: any) {
    log?.error('[autoExport] 出图失败', e);
    return {
      success: false,
      files: [],
      outputDir: '',
      briefCount: 0,
      error: e?.message || String(e),
    };
  }
}

/**
 * 展示简讯出图：筛选 story → 按 aspect 分组 → default-bindings 渲染多模板 → 落盘。
 * 出图数据源为 stories（展示简讯），与信源简报（briefs）分离。
 */
export async function runStoryAutoExport(
  storyRepo: StoryRepo,
  templatesDir: string,
  configDir: string,
  outputRootDir: string,
  options: AutoExportOptions,
  log?: Logger
): Promise<AutoExportResult> {
  const exportDate = options.date || new Date().toISOString().substring(0, 10);
  const langs = options.langs.length > 0 ? options.langs : ['zh'];
  const statusFilter = options.statusFilter.length > 0
    ? options.statusFilter
    : ['processed', 'reviewed'];

  try {
    const allStories = storyRepo.list();
    const selected = filterStoriesForAutoExport(allStories, exportDate, statusFilter);
    log?.info(`[storyExport] 日期=${exportDate} status=${statusFilter.join(',')} 筛选到 ${selected.length} 条`);

    return await renderBindings(
      selected,
      templatesDir,
      configDir,
      outputRootDir,
      exportDate,
      langs,
      flattenStoryForLang,
      log
    );
  } catch (e: any) {
    log?.error('[storyExport] 出图失败', e);
    return {
      success: false,
      files: [],
      outputDir: '',
      briefCount: 0,
      error: e?.message || String(e),
    };
  }
}
