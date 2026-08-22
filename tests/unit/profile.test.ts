import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadProfiles, resolveProfileDataDir } from '../../electron/main/store/profile';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-profile-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveProfileDataDir', () => {
  it('默认 game profile 使用根 data/', () => {
    expect(resolveProfileDataDir(tmpRoot, undefined)).toBe(path.join(tmpRoot, 'data'));
    expect(resolveProfileDataDir(tmpRoot, 'game')).toBe(path.join(tmpRoot, 'data'));
    expect(resolveProfileDataDir(tmpRoot, '')).toBe(path.join(tmpRoot, 'data'));
  });

  it('其他 profile 使用 data/profiles/<id>/', () => {
    expect(resolveProfileDataDir(tmpRoot, 'ai')).toBe(path.join(tmpRoot, 'data', 'profiles', 'ai'));
  });
});

describe('loadProfiles', () => {
  it('profiles.json 不存在时返回默认 game', () => {
    const p = loadProfiles(path.join(tmpRoot, 'profiles.json'));
    expect(p).toEqual([{ id: 'game', name: '游戏' }]);
  });

  it('读取注册表', () => {
    const file = path.join(tmpRoot, 'profiles.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        profiles: [
          { id: 'game', name: '游戏' },
          { id: 'ai', name: 'AI 资讯' },
        ],
      }),
      'utf8'
    );
    const p = loadProfiles(file);
    expect(p).toHaveLength(2);
    expect(p[1].id).toBe('ai');
  });

  it('注册表解析失败时回退默认', () => {
    const file = path.join(tmpRoot, 'profiles.json');
    fs.writeFileSync(file, 'not json', 'utf8');
    expect(loadProfiles(file)).toEqual([{ id: 'game', name: '游戏' }]);
  });
});
