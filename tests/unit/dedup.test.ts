import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  contentHash,
  titleSimilarity,
  TITLE_SIMILARITY_THRESHOLD,
} from '../../electron/main/collector/dedup';

describe('normalizeUrl', () => {
  it('去 tracking 参数（utm_* / fbclid / gclid）', () => {
    const input = 'https://www.ign.com/articles/gta6?utm_source=feed&utm_medium=rss&fbclid=abc123&id=123';
    const out = normalizeUrl(input);
    expect(out).toBe('https://www.ign.com/articles/gta6?id=123');
  });

  it('http 升级为 https', () => {
    expect(normalizeUrl('http://example.com/path')).toBe('https://example.com/path');
  });

  it('去末尾斜杠（path 非 /）', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('保留根 path 的斜杠', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('空字符串原样返回', () => {
    expect(normalizeUrl('')).toBe('');
  });

  it('非法 URL 原样返回', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('contentHash', () => {
  it('相同内容返回相同哈希', () => {
    const h1 = contentHash('GTA 6', 'Rockstar confirms', 'ign');
    const h2 = contentHash('GTA 6', 'Rockstar confirms', 'ign');
    expect(h1).toBe(h2);
  });

  it('大小写不敏感', () => {
    const h1 = contentHash('Title', 'Sum', 'ign');
    const h2 = contentHash('TITLE', 'SUM', 'IGN');
    expect(h1).toBe(h2);
  });

  it('不同内容返回不同哈希', () => {
    const h1 = contentHash('Title A', 'Sum', 'ign');
    const h2 = contentHash('Title B', 'Sum', 'ign');
    expect(h1).not.toBe(h2);
  });

  it('返回 12 位 sha1 截断', () => {
    const h = contentHash('a', 'b', 'c');
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });
});

describe('titleSimilarity', () => {
  it('完全相同返回 1', () => {
    expect(titleSimilarity('GTA 6 Release', 'GTA 6 Release')).toBe(1);
  });

  it('空字符串返回 0', () => {
    expect(titleSimilarity('', 'something')).toBe(0);
    expect(titleSimilarity('something', '')).toBe(0);
  });

  it('忽略大小写与标点', () => {
    const s = titleSimilarity('GTA 6: Release!', 'gta 6 release');
    expect(s).toBeGreaterThanOrEqual(TITLE_SIMILARITY_THRESHOLD);
  });

  it('完全不同返回较低值', () => {
    const s = titleSimilarity('GTA 6 Release', 'Nintendo Switch Sales');
    expect(s).toBeLessThan(0.3);
  });
});
