import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadSources,
  saveSources,
  loadSettings,
  saveSettings,
  DEFAULT_SOURCES_FILE,
  DEFAULT_SETTINGS,
} from '../../electron/main/store/configRepo';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-config-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadSources', () => {
  it('首次调用写入默认配置文件', () => {
    const data = loadSources(tmpDir);
    const file = path.join(tmpDir, 'sources.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(data.sources).toHaveLength(3);
    expect(data.sources.map((s) => s.id)).toEqual(['ign', 'eurogamer', 'polygon']);
  });

  it('默认源含 IGN/Eurogamer/Polygon', () => {
    const data = loadSources(tmpDir);
    for (const s of data.sources) {
      expect(s.type).toBe('rss');
      expect(s.enabled).toBe(true);
      expect(s.schedule).toBe('0 8 * * *');
      expect(s.defaultTags).toContain('游戏');
      expect(s.runtime).toBeDefined();
      expect(s.request).toBeDefined();
    }
  });

  it('proxy 默认 none', () => {
    const data = loadSources(tmpDir);
    expect(data.global.proxy.mode).toBe('none');
  });

  it('去重配置含三级策略', () => {
    const data = loadSources(tmpDir);
    expect(data.global.dedup.primary).toBe('normalizedSourceUrl');
    expect(data.global.dedup.secondary).toContain('contentHash');
    expect(data.global.dedup.secondary).toContain('titleSimilarity');
    expect(data.global.dedup.ttlDays).toBe(30);
  });

  it('兼容性：补齐缺失的 runtime 字段', () => {
    // 写入一个缺 runtime 的旧格式
    const broken = {
      sources: [{ id: 'x', name: 'X', type: 'rss', url: '', schedule: '0 8 * * *', enabled: true }],
      global: DEFAULT_SOURCES_FILE.global,
    };
    fs.writeFileSync(path.join(tmpDir, 'sources.json'), JSON.stringify(broken));
    const data = loadSources(tmpDir);
    expect(data.sources[0].runtime).toBeDefined();
    expect(data.sources[0].runtime.consecutiveFailures).toBe(0);
    expect(data.sources[0].request).toBeDefined();
    expect(data.sources[0].fieldMapping).toBeDefined();
  });

  it('解析失败返回默认', () => {
    fs.writeFileSync(path.join(tmpDir, 'sources.json'), '{ not valid json');
    const data = loadSources(tmpDir);
    expect(data.sources).toHaveLength(3);
  });
});

describe('saveSources', () => {
  it('保存后可读回相同数据', () => {
    const original = loadSources(tmpDir);
    original.sources[0].enabled = false;
    saveSources(tmpDir, original);
    const reread = loadSources(tmpDir);
    expect(reread.sources[0].enabled).toBe(false);
  });

  it('自动创建目录', () => {
    const nested = path.join(tmpDir, 'nested', 'deep');
    saveSources(nested, DEFAULT_SOURCES_FILE);
    expect(fs.existsSync(path.join(nested, 'sources.json'))).toBe(true);
  });
});

describe('loadSettings / saveSettings', () => {
  it('首次写入默认 settings', () => {
    const data = loadSettings(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'settings.json'))).toBe(true);
    expect(data.customAttrSchema).toHaveLength(1);
    expect(data.customAttrSchema[0].key).toBe('importance');
  });

  it('保存后读回', () => {
    const data = loadSettings(tmpDir);
    data.customAttrSchema.push({
      key: 'priority',
      label: '优先级',
      type: 'enum',
      values: ['p0', 'p1'],
      required: false,
    });
    saveSettings(tmpDir, data);
    const reread = loadSettings(tmpDir);
    expect(reread.customAttrSchema).toHaveLength(2);
  });

  it('解析失败返回默认', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{ broken');
    const data = loadSettings(tmpDir);
    expect(data).toEqual(DEFAULT_SETTINGS);
  });
});
