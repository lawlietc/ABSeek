import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import {
  Brief,
  TemplateConfig,
  TemplateData,
  TemplateBrief,
  Pagination,
} from './shared/types';

// 注册 Handlebars helpers
function registerHelpers() {
  // 序号从 1 起
  Handlebars.registerHelper('inc', (value: number) => value + 1);

  // 相等比较
  Handlebars.registerHelper('eq', (a: any, b: any) => a === b);

  // 格式化日期：YYYY-MM-DD
  Handlebars.registerHelper('formatDate', (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  // 格式化时间：HH:mm
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

/**
 * 把多语言 Brief 按目标 lang 展平为 TemplateBrief
 * - 优先取 title[lang] / summary[lang]
 * - 缺失时按 onMissingLang 策略处理：
 *   - fallback：用任意存在的语言顶替，isTranslated=false
 *   - skip：返回 null，由调用方过滤
 */
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
    // fallback：取任意存在的语言
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
 * 渲染单页 HTML（按指定 lang）
 */
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

  // 将 <link rel="stylesheet" href="style.css"> 替换为内联 <style>
  html = html.replace(
    /<link rel="stylesheet" href="style\.css">/,
    `<style>\n${css}\n</style>`
  );

  return html;
}
