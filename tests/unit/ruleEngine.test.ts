import { describe, it, expect } from 'vitest';
import { applyRules } from '../../electron/main/rules/ruleEngine';
import { RawBrief } from '../../electron/main/collector/types';
import { SourceConfig, DEFAULT_REQUEST } from '../../electron/main/store/configRepo';

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'ign',
    name: 'IGN',
    type: 'rss',
    url: '',
    schedule: '0 8 * * *',
    enabled: true,
    defaultTags: ['游戏', '海外'],
    defaultCategory: '游戏',
    request: { ...DEFAULT_REQUEST },
    runtime: {
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      lastCollectedCount: 0,
      lastNewCount: 0,
    },
    ...overrides,
  };
}

function makeRaw(overrides: Partial<RawBrief> = {}): RawBrief {
  return {
    title: 'GTA 6 Release Window Confirmed',
    summary: 'Rockstar confirms GTA 6 for spring 2027',
    date: '2026-07-23T08:00:00.000Z',
    source: 'ign',
    sourceName: 'IGN',
    sourceUrl: 'https://www.ign.com/articles/gta6',
    ...overrides,
  };
}

describe('applyRules', () => {
  it('清理 HTML 标签与实体', () => {
    const raw = makeRaw({
      title: '<b>GTA 6</b> &amp; Rockstar',
      summary: '<p>Rockstar&nbsp;confirms</p>',
    });
    const out = applyRules(raw, makeSource());
    expect(out.title).toBe('GTA 6 & Rockstar');
    expect(out.summary).toBe('Rockstar confirms');
  });

  it('应用 defaultTags', () => {
    const out = applyRules(makeRaw(), makeSource());
    expect(out.tags).toContain('游戏');
    expect(out.tags).toContain('海外');
  });

  it('关键词打标：AAA → 3A', () => {
    const raw = makeRaw({ title: 'New AAA game announced', summary: '' });
    const out = applyRules(raw, makeSource());
    expect(out.tags).toContain('3A');
  });

  it('关键词打标：DLC', () => {
    const raw = makeRaw({ title: 'New DLC expansion coming', summary: '' });
    const out = applyRules(raw, makeSource());
    expect(out.tags).toContain('DLC');
  });

  it('关键词打标：手游', () => {
    const raw = makeRaw({ title: 'New mobile game for iOS', summary: '' });
    const out = applyRules(raw, makeSource());
    expect(out.tags).toContain('手游');
  });

  it('summary 截断到 500 字符', () => {
    const long = 'a'.repeat(800);
    const out = applyRules(makeRaw({ summary: long }), makeSource());
    expect(out.summary.length).toBe(500);
  });

  it('非法日期降级为当前时间', () => {
    const out = applyRules(makeRaw({ date: 'not-a-date' }), makeSource());
    const d = new Date(out.date);
    expect(d.getTime()).not.toBeNaN();
  });

  it('保留已有 tags 并合并 defaultTags', () => {
    const raw = makeRaw({ tags: ['独家'] });
    const out = applyRules(raw, makeSource());
    expect(out.tags).toContain('独家');
    expect(out.tags).toContain('游戏');
  });
});
