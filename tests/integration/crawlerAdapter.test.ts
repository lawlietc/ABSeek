import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

const fixtureHtml = fs.readFileSync(
  path.resolve(process.cwd(), 'tests/fixtures/sample-static.html'),
  'utf8'
);

// mock https.get：返回 fixture HTML
vi.mock('https', () => {
  const get = vi.fn((url: string, options: any, cb: (res: any) => void) => {
    const res = new Readable({ read() {} }) as any;
    res.statusCode = 200;
    cb(res);
    process.nextTick(() => {
      res.push(fixtureHtml);
      res.push(null);
    });
    return { on: vi.fn(), destroy: vi.fn() };
  });
  return { default: { get }, get };
});

import { collectStatic } from '../../electron/main/collector/crawlerAdapter';
import { SourceConfig, ProxyConfig, DEFAULT_REQUEST } from '../../electron/main/store/configRepo';

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'static-src',
    name: 'MockStatic',
    type: 'crawler-static',
    url: 'https://example.com/news',
    schedule: '0 8 * * *',
    enabled: true,
    selectors: {
      item: 'article.post',
      title: 'h2',
      link: 'a',
      summary: 'p',
      date: 'time',
      image: 'img',
    },
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

const noProxy: ProxyConfig = { mode: 'none' };

describe('collectStatic', () => {
  it('解析 fixture HTML 返回 2 条（排除非 article 元素）', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    // fixture 含 2 个 article.post + 1 个 div.not-an-article（应被排除）
    expect(briefs).toHaveLength(2);
  });

  it('正确提取标题', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[0].title).toBe('Indie Game Spotlight: Hollow Sands');
    expect(briefs[1].title).toBe('Esports Tournament 2026 Announced');
  });

  it('相对链接转绝对', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[0].sourceUrl).toBe('https://example.com/articles/hollow-sands');
  });

  it('保留已是绝对的链接', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[1].sourceUrl).toBe('https://example.com/articles/esports-2026');
  });

  it('提取 datetime 属性作为日期', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[0].date).toBe('2026-07-23T12:00:00.000Z');
  });

  it('提取 img src', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[0].image).toBe('/images/hollow-sands.jpg');
  });

  it('source / sourceName 来自 SourceConfig', async () => {
    const briefs = await collectStatic(makeSource(), noProxy);
    expect(briefs[0].source).toBe('static-src');
    expect(briefs[0].sourceName).toBe('MockStatic');
  });
});
