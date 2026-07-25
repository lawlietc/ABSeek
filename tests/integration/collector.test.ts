import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// mock rssAdapter 模块本身：让 collectRss 成为可控 mock 函数
vi.mock('../../electron/main/collector/rssAdapter', () => ({
  collectRss: vi.fn(),
}));

import { Collector } from '../../electron/main/collector/collector';
import { BriefRepo } from '../../electron/main/store/briefRepo';
import { createLogger } from '../../electron/main/logger/logger';
import { collectRss } from '../../electron/main/collector/rssAdapter';
import { RawBrief } from '../../electron/main/collector/types';
import {
  SourcesFile,
  SourceConfig,
  DEFAULT_REQUEST,
  DEFAULT_SOURCES_FILE,
} from '../../electron/main/store/configRepo';

let tmpRoot: string;
let briefsDir: string;
let invalidDir: string;
let repo: BriefRepo;
let collector: Collector;

const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'ign',
    name: 'IGN',
    type: 'rss',
    url: 'https://feeds.ign.com/ign/all',
    schedule: '0 8 * * *',
    enabled: true,
    defaultTags: ['游戏'],
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

function makeSourcesFile(source: SourceConfig): SourcesFile {
  return {
    sources: [source],
    global: DEFAULT_SOURCES_FILE.global,
  };
}

function makeRaw(overrides: Partial<RawBrief> = {}): RawBrief {
  return {
    title: 'GTA 6 Release',
    summary: 'Rockstar confirms',
    date: '2026-07-23T08:00:00.000Z',
    source: 'ign',
    sourceName: 'IGN',
    sourceUrl: 'https://www.ign.com/articles/gta6',
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-collector-'));
  briefsDir = path.join(tmpRoot, 'briefs');
  invalidDir = path.join(tmpRoot, '_invalid');
  repo = new BriefRepo(briefsDir, invalidDir, log);
  collector = new Collector(repo, log);
  // 重置 collectRss mock
  vi.mocked(collectRss).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Collector.collect 去重入库闭环', () => {
  it('首次采集：全部入库', async () => {
    const rawBriefs = [
      makeRaw({ title: 'A', sourceUrl: 'https://ign.com/a' }),
      makeRaw({ title: 'B', sourceUrl: 'https://ign.com/b' }),
    ];
    vi.mocked(collectRss).mockResolvedValue(rawBriefs);

    const result = await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    expect(result.fetched).toBe(2);
    expect(result.rawBriefs).toHaveLength(2);
    expect(repo.list()).toHaveLength(2);
  });

  it('URL 去重：相同 URL 不重复入库', async () => {
    const first = [makeRaw({ title: 'A', sourceUrl: 'https://ign.com/a' })];
    const second = [makeRaw({ title: 'A diff title', sourceUrl: 'https://ign.com/a' })];
    vi.mocked(collectRss).mockResolvedValueOnce(first);

    await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    // 第二次采集相同 URL
    vi.mocked(collectRss).mockResolvedValueOnce(second);
    const r2 = await collector.collect(makeSource(), makeSourcesFile(makeSource()));

    expect(r2.fetched).toBe(1);
    expect(r2.rawBriefs).toHaveLength(0); // 去重后无新增
    expect(repo.list()).toHaveLength(1);
  });

  it('tracking 参数不影响 URL 去重', async () => {
    const first = [makeRaw({ sourceUrl: 'https://ign.com/a' })];
    const second = [makeRaw({ sourceUrl: 'https://ign.com/a?utm_source=feed&fbclid=xyz' })];
    vi.mocked(collectRss).mockResolvedValueOnce(first);
    await collector.collect(makeSource(), makeSourcesFile(makeSource()));

    vi.mocked(collectRss).mockResolvedValueOnce(second);
    const r2 = await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    expect(r2.rawBriefs).toHaveLength(0);
  });

  it('内容哈希去重：相同 title+summary+source 不入库', async () => {
    const raw = makeRaw({ title: 'Same', summary: 'Same summary', sourceUrl: 'https://ign.com/1' });
    vi.mocked(collectRss).mockResolvedValueOnce([raw]);
    await collector.collect(makeSource(), makeSourcesFile(makeSource()));

    // 不同 URL 但相同内容
    const dup = makeRaw({ title: 'Same', summary: 'Same summary', sourceUrl: 'https://ign.com/2' });
    vi.mocked(collectRss).mockResolvedValueOnce([dup]);
    const r2 = await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    expect(r2.rawBriefs).toHaveLength(0);
  });

  it('标题相似度去重：高度相似标题不入库', async () => {
    const first = [makeRaw({ title: 'GTA 6 Release Window Confirmed', sourceUrl: 'https://ign.com/1' })];
    vi.mocked(collectRss).mockResolvedValueOnce(first);
    await collector.collect(makeSource(), makeSourcesFile(makeSource()));

    const similar = [makeRaw({ title: 'GTA 6 Release Window Confirmed!', sourceUrl: 'https://ign.com/2' })];
    vi.mocked(collectRss).mockResolvedValueOnce(similar);
    const r2 = await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    expect(r2.rawBriefs).toHaveLength(0);
  });

  it('拉取失败抛错且不入库', async () => {
    vi.mocked(collectRss).mockRejectedValue(new Error('network error'));
    const source = makeSource();
    await expect(collector.collect(source, makeSourcesFile(source))).rejects.toThrow('network error');
    expect(repo.list()).toHaveLength(0);
  });

  it('应用规则引擎后入库（defaultTags）', async () => {
    const raw = [makeRaw({ title: 'New AAA game', summary: '' })];
    vi.mocked(collectRss).mockResolvedValue(raw);
    await collector.collect(makeSource(), makeSourcesFile(makeSource()));
    const list = repo.list();
    expect(list[0].tags).toContain('游戏');
    expect(list[0].tags).toContain('3A');
  });
});

describe('Collector.testConnection', () => {
  it('成功返回样本数据', async () => {
    vi.mocked(collectRss).mockResolvedValue([
      makeRaw({ title: 'Sample 1' }),
      makeRaw({ title: 'Sample 2' }),
    ]);
    const r = await collector.testConnection(makeSource(), makeSourcesFile(makeSource()));
    expect(r.success).toBe(true);
    expect(r.fetched).toBe(2);
    expect(r.sample).toHaveLength(2);
  });

  it('失败返回 error', async () => {
    vi.mocked(collectRss).mockRejectedValue(new Error('conn refused'));
    const r = await collector.testConnection(makeSource(), makeSourcesFile(makeSource()));
    expect(r.success).toBe(false);
    expect(r.error).toBe('conn refused');
  });
});
