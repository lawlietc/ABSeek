import * as fs from 'fs';
import * as path from 'path';
import { Brief, Playlist, TemplateBrief } from './shared/types';
import { sortByRules } from './router';
import { flattenForLang } from './render';

/**
 * 读取 playlist 文件
 */
export function loadPlaylist(playlistsDir: string, playlistId: string): Playlist {
  const filePath = path.join(playlistsDir, `${playlistId}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as Playlist;
}

/**
 * 列出所有 playlist
 */
export function listPlaylists(playlistsDir: string): string[] {
  if (!fs.existsSync(playlistsDir)) return [];
  return fs
    .readdirSync(playlistsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * 根据 briefId 从全部简讯里取 brief
 */
function getBriefById(briefs: Brief[], id: string): Brief | undefined {
  return briefs.find((b) => b.id === id);
}

/**
 * 按 playlist 渲染数据准备：
 * 对每个 template binding，按 briefIds 顺序取简讯
 * （顺序由 playlist 决定，不再用 template.sort）
 */
export function getOrderedBriefsForBinding(
  allBriefs: Brief[],
  binding: { templateId: string; forAspect: string; briefIds: string[] }
): Brief[] {
  const result: Brief[] = [];
  for (const id of binding.briefIds) {
    const b = getBriefById(allBriefs, id);
    if (b) {
      // 校验 aspect 是否匹配（不匹配给出警告但不阻断）
      if (b.aspect !== binding.forAspect) {
        console.warn(
          `[playlist] 警告: brief ${id} 的 aspect=${b.aspect} 与 binding 的 forAspect=${binding.forAspect} 不一致`
        );
      }
      result.push(b);
    } else {
      console.warn(`[playlist] 警告: 找不到 brief ${id}`);
    }
  }
  return result;
}

/**
 * 按 lang 展平（处理 fallback / skip）
 */
export function flattenBriefsForLang(
  briefs: Brief[],
  lang: string,
  onMissingLang: 'fallback' | 'skip'
): { items: TemplateBrief[]; fallbackCount: number } {
  const items = briefs
    .map((b) => flattenForLang(b, lang, onMissingLang))
    .filter((x): x is TemplateBrief => x !== null);
  const fallbackCount = items.filter((x) => !x.isTranslated).length;
  return { items, fallbackCount };
}
