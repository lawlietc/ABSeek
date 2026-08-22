import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { Brief, Story, TemplateConfig, TemplateData, TemplateBrief, Pagination } from './types';

function registerHelpers() {
  Handlebars.registerHelper('inc', (value: number) => value + 1);
  Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
  Handlebars.registerHelper('formatDate', (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  Handlebars.registerHelper('formatTime', (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  });
}
registerHelpers();

/** 按目标 lang 展平多语言 Brief */
export function flattenForLang(
  brief: Brief,
  lang: string,
  onMissingLang: 'fallback' | 'skip'
): TemplateBrief | null {
  let title = brief.title[lang];
  let summary = brief.summary[lang];
  let isTranslated = true;

  if (!title) {
    if (onMissingLang === 'skip') return null;
    const langs = Object.keys(brief.title);
    if (langs.length > 0) {
      title = brief.title[langs[0]];
      isTranslated = false;
    } else {
      title = '';
      isTranslated = false;
    }
  }
  if (!summary) {
    if (onMissingLang === 'skip') return null;
    const langs = Object.keys(brief.summary);
    summary = langs.length > 0 ? brief.summary[langs[0]] : '';
    if (isTranslated) isTranslated = false;
  }
  return {
    id: brief.id,
    title,
    summary,
    source: brief.source,
    date: brief.date,
    tags: brief.tags,
    category: brief.category,
    aspect: brief.aspect,
    customAttrs: brief.customAttrs,
    isTranslated,
  };
}

/**
 * 按目标 lang 展平多语言展示简讯（story）。
 * 与 flattenForLang 的区别：source 取首个信源网站名，并附上完整信源列表 / 数量，
 * 供模板展示「N 家媒体报道」等。
 */
export function flattenStoryForLang(
  story: Story,
  lang: string,
  onMissingLang: 'fallback' | 'skip'
): TemplateBrief | null {
  let title = story.title[lang];
  let summary = story.summary[lang];
  let isTranslated = true;

  if (!title) {
    if (onMissingLang === 'skip') return null;
    const langs = Object.keys(story.title);
    if (langs.length > 0) {
      title = story.title[langs[0]];
      isTranslated = false;
    } else {
      title = '';
      isTranslated = false;
    }
  }
  if (!summary) {
    if (onMissingLang === 'skip') return null;
    const langs = Object.keys(story.summary);
    summary = langs.length > 0 ? story.summary[langs[0]] : '';
    if (isTranslated) isTranslated = false;
  }

  const sources = story.sources || [];
  const sourceName =
    (sources[0] && (sources[0].sourceName || sources[0].sourceId)) || '';
  return {
    id: story.id,
    title,
    summary,
    source: sourceName,
    date: story.date,
    tags: story.tags,
    category: story.category,
    aspect: story.aspect,
    customAttrs: story.customAttrs,
    isTranslated,
    sources: sources.map((s) => ({ sourceId: s.sourceId, sourceName: s.sourceName })),
    sourceCount: sources.length,
  };
}

/** 渲染单页 HTML（内联 CSS） */
export function renderHtml(
  templateDir: string,
  config: TemplateConfig,
  briefs: TemplateBrief[],
  pagination: Pagination,
  exportDate: string,
  lang: string
): string {
  const htmlPath = path.join(templateDir, 'index.html');
  const cssPath = path.join(templateDir, 'style.css');
  const htmlTpl = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  const data: TemplateData = {
    briefs,
    pagination,
    templateId: config.id,
    templateName: config.name,
    date: exportDate,
    lang,
  };

  const template = Handlebars.compile(htmlTpl);
  let html = template(data);
  html = html.replace(
    /<link rel="stylesheet" href="style\.css">/,
    `<style>\n${css}\n</style>`
  );
  return html;
}
