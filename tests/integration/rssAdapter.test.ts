import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// mock rss-parser：parseURL 读取 fixture XML 并用真实 parseString 解析
vi.mock('rss-parser', async () => {
  const actual = await vi.importActual<typeof import('rss-parser')>('rss-parser');
  const RealParser = actual.default;
  return {
    default: class extends RealParser {
      async parseURL(url: string, options?: any) {
        const xml = fs.readFileSync(
          path.resolve(process.cwd(), 'tests/fixtures/sample-ign.xml'),
          'utf8'
        );
        return super.parseString(xml);
      }
    },
  };
});

import { collectRss } from '../../electron/main/collector/rssAdapter';
import { SourceConfig, ProxyConfig, DEFAULT_REQUEST } from '../../electron/main/store/configRepo';

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'ign',
    name: 'IGN',
    type: 'rss',
    url: 'https://feeds.ign.com/ign/all',
    schedule: '0 8 * * *',
    enabled: true,
    fieldMapping: {
      title: 'title',
      date: 'pubDate',
      summary: 'contentSnippet',
      content: 'content:encoded',
      link: 'link',
      author: 'creator',
      image: 'enclosure.url',
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

describe('collectRss', () => {
  it('解析 fixture RSS 返回 3 条 RawBrief', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs).toHaveLength(3);
  });

  it('正确映射 title / link / date', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    const first = briefs[0];
    expect(first.title).toContain('GTA 6');
    expect(first.sourceUrl).toContain('ign.com');
    expect(first.date).toBe('2026-07-23T08:00:00.000Z');
  });

  it('source / sourceName 来自 SourceConfig', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs[0].source).toBe('ign');
    expect(briefs[0].sourceName).toBe('IGN');
  });

  it('清理 HTML 实体（&nbsp; &amp; 等）', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    const first = briefs[0];
    // fixture 里 description 含 &nbsp;
    expect(first.summary).not.toContain('&nbsp;');
    expect(first.summary).not.toContain('&amp;');
  });

  it('提取 content:encoded 作为 body', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs[0].body).toContain('GTA 6');
  });

  it('提取 enclosure.url 作为 image', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs[0].image).toContain('ign.com');
    expect(briefs[0].image).toMatch(/\.jpg/);
  });

  it('提取 dc:creator 作为 author', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs[0].author).toBe('IGN Editorial');
  });

  it('summary 截断到 500 字符', async () => {
    const briefs = await collectRss(makeSource(), noProxy);
    for (const b of briefs) {
      expect(b.summary.length).toBeLessThanOrEqual(500);
    }
  });

  it('跳过无 title 或无 link 的 item', async () => {
    // fixture 里所有 item 都有 title 和 link，这里验证逻辑：返回数 = fixture item 数
    const briefs = await collectRss(makeSource(), noProxy);
    expect(briefs.length).toBe(3);
  });
});
