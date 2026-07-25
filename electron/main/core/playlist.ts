import * as fs from 'fs';
import * as path from 'path';
import { Brief, Playlist, TemplateBrief } from './types';
import { flattenForLang } from './render';

/** 读取 playlist */
export function loadPlaylist(playlistsDir: string, playlistId: string): Playlist {
  const filePath = path.join(playlistsDir, `${playlistId}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as Playlist;
}

/** 列出所有 playlist id */
export function listPlaylists(playlistsDir: string): string[] {
  if (!fs.existsSync(playlistsDir)) return [];
  return fs
    .readdirSync(playlistsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** 按 briefIds 顺序取简讯 */
export function getOrderedBriefsForBinding(
  allBriefs: Brief[],
  binding: { templateId: string; forAspect: string; briefIds: string[] }
): Brief[] {
  const result: Brief[] = [];
  for (const id of binding.briefIds) {
    const b = allBriefs.find((x) => x.id === id);
    if (b) {
      if (b.aspect !== binding.forAspect) {
        console.warn(
          `[playlist] 警告: brief ${id} 的 aspect=${b.aspect} 与 forAspect=${binding.forAspect} 不一致`
        );
      }
      result.push(b);
    } else {
      console.warn(`[playlist] 警告: 找不到 brief ${id}`);
    }
  }
  return result;
}

/** 按 lang 展平 */
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
