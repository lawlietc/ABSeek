import * as fs from 'fs';
import * as path from 'path';
import { Brief, SortRule } from './types';

/** 读取模板配置 */
export function loadTemplateConfig(templatesRoot: string, templateId: string) {
  const cfgPath = path.join(templatesRoot, templateId, 'config.json');
  const raw = fs.readFileSync(cfgPath, 'utf8');
  return JSON.parse(raw);
}

/** 列出所有可用模板 ID */
export function listTemplates(templatesRoot: string): string[] {
  if (!fs.existsSync(templatesRoot)) return [];
  return fs
    .readdirSync(templatesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 读取默认绑定 */
export function loadDefaultBindings(configDir: string) {
  const p = path.join(configDir, 'default-bindings.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw).bindings;
}

/** 保存默认绑定（覆盖写） */
export function saveDefaultBindings(configDir: string, bindings: { aspect: string; templateId: string }[]) {
  const p = path.join(configDir, 'default-bindings.json');
  const data = { bindings };
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return true;
}

/**
 * 按模板 sort 规则排序，末尾按 title 兜底保证稳定
 */
export function sortByRules(briefs: Brief[], rules: SortRule[]): Brief[] {
  const importanceWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const sorted = [...briefs];
  sorted.sort((a, b) => {
    for (const rule of rules) {
      const { field, order } = rule;
      let va: any;
      let vb: any;
      if (field === 'date') {
        va = new Date(a.date).getTime();
        vb = new Date(b.date).getTime();
      } else if (field.startsWith('customAttrs.')) {
        const key = field.substring('customAttrs.'.length);
        if (key === 'importance') {
          va = importanceWeight[a.customAttrs[key]] || 0;
          vb = importanceWeight[b.customAttrs[key]] || 0;
        } else {
          va = a.customAttrs[key] || '';
          vb = b.customAttrs[key] || '';
        }
      } else {
        va = (a as any)[field] || '';
        vb = (b as any)[field] || '';
      }
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
    }
    const ta = a.title.zh || a.title.en || Object.values(a.title)[0] || '';
    const tb = b.title.zh || b.title.en || Object.values(b.title)[0] || '';
    return ta.localeCompare(tb);
  });
  return sorted;
}

/** 分页 */
export function paginate<T>(items: T[], maxPerPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += maxPerPage) {
    pages.push(items.slice(i, i + maxPerPage));
  }
  if (pages.length === 0) pages.push([]);
  return pages;
}
