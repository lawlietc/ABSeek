import { describe, it, expect } from 'vitest';
import { validateBrief } from '../../electron/main/store/validator';
import { Brief } from '../../electron/main/core/types';

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: '20260723-01-abc123-ign-gta6',
    date: '2026-07-23T08:00:00+08:00',
    source: 'IGN',
    sourceUrl: 'https://www.ign.com/articles/gta6',
    title: { en: 'GTA 6' },
    summary: { en: 'Rockstar confirms' },
    tags: ['游戏'],
    category: '游戏',
    aspect: 'A',
    customAttrs: { importance: 'high' },
    status: 'raw',
    ...overrides,
  };
}

describe('validateBrief', () => {
  it('合法简讯通过', () => {
    const r = validateBrief(makeBrief());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('id 缺失失败', () => {
    const r = validateBrief(makeBrief({ id: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('date 缺失失败', () => {
    const r = validateBrief(makeBrief({ date: undefined as any }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('date'))).toBe(true);
  });

  it('date 非法时间失败', () => {
    const r = validateBrief(makeBrief({ date: 'not-a-date' }));
    expect(r.ok).toBe(false);
  });

  it('source 缺失失败', () => {
    const r = validateBrief(makeBrief({ source: '' }));
    expect(r.ok).toBe(false);
  });

  it('非法 status 失败', () => {
    const r = validateBrief(makeBrief({ status: 'invalid' as any }));
    expect(r.ok).toBe(false);
  });

  it('tags 非数组失败', () => {
    const r = validateBrief(makeBrief({ tags: 'not-array' as any }));
    expect(r.ok).toBe(false);
  });

  it('customAttrs 非对象失败', () => {
    const r = validateBrief(makeBrief({ customAttrs: [] as any }));
    expect(r.ok).toBe(false);
  });

  it('customAttrs 值非字符串失败', () => {
    const r = validateBrief(makeBrief({ customAttrs: { importance: 123 as any } }));
    expect(r.ok).toBe(false);
  });

  it('title 非对象失败', () => {
    const r = validateBrief(makeBrief({ title: 'string' as any }));
    expect(r.ok).toBe(false);
  });

  it('合法 status 列表通过', () => {
    for (const s of ['raw', 'processed', 'reviewed', 'exported', 'archived', 'ignored']) {
      const r = validateBrief(makeBrief({ status: s as any }));
      expect(r.ok).toBe(true);
    }
  });
});
