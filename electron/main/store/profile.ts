import * as fs from 'fs';
import * as path from 'path';

export interface ProfileInfo {
  id: string;
  name: string;
}

/**
 * 加载 profile 注册表（data/profiles.json）。
 * 不存在时返回默认 game profile。
 */
export function loadProfiles(profilesJsonPath: string): ProfileInfo[] {
  if (!fs.existsSync(profilesJsonPath)) {
    return [{ id: 'game', name: '游戏' }];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(profilesJsonPath, 'utf8'));
    if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
      return parsed.profiles;
    }
    return [{ id: 'game', name: '游戏' }];
  } catch {
    return [{ id: 'game', name: '游戏' }];
  }
}

/**
 * 解析某 profile 的数据目录。
 * - 默认 game profile 使用根 data/（向后兼容，不迁移现有数据）。
 * - 其他 profile 使用 data/profiles/{id}/。
 */
export function resolveProfileDataDir(root: string, profileId?: string): string {
  if (!profileId || profileId === 'game') {
    return path.join(root, 'data');
  }
  return path.join(root, 'data', 'profiles', profileId);
}

/**
 * 解析某 profile 的输出根目录：output/{id}/。
 * id 必须是 ASCII slug（字母/数字/连字符），避免中文等字符在
 * Windows 路径、脚本引用、URL 场景下的编码问题。
 */
export function isValidProfileId(profileId: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(profileId);
}

/**
 * 解析某 profile 的出图目录：output/{id}/images/。
 */
export function resolveProfileOutputDir(root: string, profileId?: string): string {
  const id = profileId || 'game';
  return path.join(root, 'output', id, 'images');
}
