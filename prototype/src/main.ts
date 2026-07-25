import * as fs from 'fs';
import * as path from 'path';
import { readBriefs } from './readBriefs';
import { loadTemplateConfig, paginate } from './router';
import { renderHtml } from './render';
import { screenshot, closeBrowser } from './screenshot';
import {
  loadPlaylist,
  getOrderedBriefsForBinding,
  flattenBriefsForLang,
} from './playlist';
import { createDefaultPlaylist } from './createPlaylist';
import { loadDefaultBindings } from './router';
import { Brief, TemplateConfig, Playlist } from './shared/types';

// 路径常量
const ROOT = path.resolve(__dirname, '..');
const MOCK_BRIEFS_DIR = path.join(ROOT, 'data', 'mock', 'briefs');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const CONFIG_DIR = path.join(ROOT, 'data', 'config');
const PLAYLISTS_DIR = path.join(ROOT, 'data', 'mock', 'playlists');
const OUTPUT_DIR = path.join(ROOT, 'output', 'images');

/** 生成文件名（按 config.output.filename 模板替换） */
function buildFilename(
  template: TemplateConfig,
  page: number,
  exportDate: string,
  lang: string,
  aspect: string
): string {
  return template.output.filename
    .replace('{{date}}', exportDate)
    .replace('{{templateId}}', template.id)
    .replace('{{page}}', String(page))
    .replace('{{lang}}', lang)
    .replace('{{aspect}}', aspect);
}

/**
 * 渲染一个 playlist
 * - 遍历 playlist.templates 的每个 binding
 * - 按 briefIds 顺序取简讯（顺序已由 playlist 决定，不再 sort）
 * - 按 playlist.output.lang 多语言渲染
 */
async function renderPlaylist(
  playlist: Playlist,
  allBriefs: Brief[],
  exportDate: string
): Promise<number> {
  let totalImages = 0;

  console.log(`\n=== Playlist: ${playlist.name} ===`);
  console.log(`ID: ${playlist.id}`);
  console.log(`绑定数: ${playlist.templates.length}`);

  for (const binding of playlist.templates) {
    const { templateId, forAspect, briefIds } = binding;
    console.log(`\n--- 绑定: ${templateId} (aspect=${forAspect}) ---`);

    const templateDir = path.join(TEMPLATES_DIR, templateId);
    if (!fs.existsSync(templateDir)) {
      console.warn(`模板目录不存在，跳过: ${templateDir}`);
      continue;
    }

    const config = loadTemplateConfig(TEMPLATES_DIR, templateId);
    console.log(`模板名: ${config.name}, 容量: ${config.limit.maxBriefs}/页`);

    // 按 briefIds 顺序取简讯
    const orderedBriefs = getOrderedBriefsForBinding(allBriefs, binding);
    console.log(`简讯数: ${orderedBriefs.length}`);

    if (orderedBriefs.length === 0) {
      console.log(`无简讯，跳过`);
      continue;
    }

    // 按 playlist.output.lang 渲染（覆盖模板默认）
    const langs = playlist.output.lang;
    for (const lang of langs) {
      console.log(`\n  [语言: ${lang}]`);

      const { items, fallbackCount } = flattenBriefsForLang(
        orderedBriefs,
        lang,
        config.output.onMissingLang
      );

      console.log(
        `  展平后: ${items.length} 条` +
          (fallbackCount > 0 ? ` (fallback ${fallbackCount} 条)` : '')
      );

      if (items.length === 0) {
        console.log(`  无可用简讯，跳过`);
        continue;
      }

      // 分页
      const pages = paginate(items, config.limit.maxBriefs);
      console.log(`  分页: ${pages.length} 页`);

      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pageBriefs = pages[i];
        const pagination = { page, total: pages.length };

        const html = renderHtml(
          templateDir,
          config,
          pageBriefs,
          pagination,
          exportDate,
          lang
        );

        const filename = buildFilename(config, page, exportDate, lang, forAspect);
        const outputPath = path.join(OUTPUT_DIR, filename);

        await screenshot(html, config, outputPath);
        totalImages++;
      }
    }
  }

  return totalImages;
}

async function main() {
  console.log('=== ABSeek v0.3 出图验证（playlist 驱动版）===\n');

  // 1. 读取所有 mock 简讯
  const allBriefs = readBriefs(MOCK_BRIEFS_DIR);
  console.log(`读取到 ${allBriefs.length} 条简讯`);

  // 按 aspect 统计
  const statByAspect: Record<string, number> = {};
  for (const b of allBriefs) {
    statByAspect[b.aspect] = (statByAspect[b.aspect] || 0) + 1;
  }
  console.log('按 aspect 统计:', statByAspect, '\n');

  // 2. 确保输出目录存在
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(PLAYLISTS_DIR, { recursive: true });

  // 导出日期
  const exportDate = new Date().toISOString().substring(0, 10);

  // 3. 若无 playlist，按 default-bindings 自动创建一个默认的
  const existing = fs
    .readdirSync(PLAYLISTS_DIR)
    .filter((f) => f.endsWith('.json'));

  let playlistsToRender: Playlist[] = [];

  if (existing.length === 0) {
    console.log('未发现 playlist，按 default-bindings 自动创建...');
    const bindings = loadDefaultBindings(CONFIG_DIR);
    const defaultPlaylist = createDefaultPlaylist(
      allBriefs,
      bindings,
      TEMPLATES_DIR,
      path.join(PLAYLISTS_DIR, `${exportDate}-01-default.json`),
      `${exportDate} 默认合集`,
      `${exportDate}-01-default`
    );
    playlistsToRender.push(defaultPlaylist);
  } else {
    console.log(`发现 ${existing.length} 个 playlist:`);
    for (const f of existing) {
      const id = f.replace(/\.json$/, '');
      console.log(`  - ${id}`);
      playlistsToRender.push(loadPlaylist(PLAYLISTS_DIR, id));
    }
  }

  // 4. 逐个 playlist 渲染
  let totalImages = 0;
  for (const pl of playlistsToRender) {
    totalImages += await renderPlaylist(pl, allBriefs, exportDate);
  }

  // 5. 关闭浏览器
  await closeBrowser();

  console.log(`\n=== 完成 ===`);
  console.log(`共处理 ${playlistsToRender.length} 个 playlist, 生成 ${totalImages} 张图片`);
  console.log(`输出目录: ${OUTPUT_DIR}`);

  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => /\.(jpg|png)$/i.test(f));
  console.log(`\n文件清单:`);
  files.forEach((f) => {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f}  (${(stat.size / 1024).toFixed(1)} KB)`);
  });
}

main().catch((err) => {
  console.error('运行失败:', err);
  process.exit(1);
});
