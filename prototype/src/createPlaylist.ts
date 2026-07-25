import * as fs from 'fs';
import * as path from 'path';
import { Brief, Playlist, DefaultBinding } from './shared/types';
import { sortByRules, loadTemplateConfig, loadDefaultBindings } from './router';

/**
 * 创建默认 playlist
 * - 按 default-bindings.json 把简讯按 aspect 分到对应模板
 * - 每个模板按其 sort 规则默认排序
 * - 生成 playlist 写入文件
 */
export function createDefaultPlaylist(
  allBriefs: Brief[],
  bindings: DefaultBinding[],
  templatesDir: string,
  outputPath: string,
  name: string,
  id: string
): Playlist {
  const now = new Date().toISOString();
  const templateBindings: Playlist['templates'] = [];

  for (const binding of bindings) {
    // 筛选该 aspect 的简讯
    const matched = allBriefs.filter((b) => b.aspect === binding.aspect);
    if (matched.length === 0) continue;

    // 读取模板的 sort 规则
    const tplCfg = loadTemplateConfig(templatesDir, binding.templateId);
    const sorted = sortByRules(matched, tplCfg.sort);

    templateBindings.push({
      templateId: binding.templateId,
      forAspect: binding.aspect,
      briefIds: sorted.map((b) => b.id),
    });
  }

  const playlist: Playlist = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    templates: templateBindings,
    output: {
      lang: ['zh', 'en'],
      format: 'jpg',
      quality: 90,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(playlist, null, 2), 'utf8');
  console.log(`[createPlaylist] 已创建: ${outputPath}`);
  return playlist;
}
