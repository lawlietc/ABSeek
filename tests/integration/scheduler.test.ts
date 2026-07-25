import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 用 vi.hoisted 让 mock 函数在 hoisted 阶段可用
const { mockSchedule, mockValidate } = vi.hoisted(() => ({
  mockSchedule: vi.fn(() => ({ stop: vi.fn() })),
  mockValidate: vi.fn(() => true),
}));

vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule, validate: mockValidate },
  schedule: mockSchedule,
  validate: mockValidate,
}));

import { Scheduler } from '../../electron/main/collector/scheduler';
import { Collector } from '../../electron/main/collector/collector';
import { BriefRepo } from '../../electron/main/store/briefRepo';
import { createLogger } from '../../electron/main/logger/logger';
import {
  loadSources,
  saveSources,
  DEFAULT_SOURCES_FILE,
  SourceConfig,
} from '../../electron/main/store/configRepo';

let tmpRoot: string;
let configDir: string;
let briefsDir: string;
let invalidDir: string;
let scheduler: Scheduler;
const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'ign',
    name: 'IGN',
    type: 'rss',
    url: '',
    schedule: '0 8 * * *',
    enabled: true,
    request: { ...DEFAULT_SOURCES_FILE.sources[0].request! },
    runtime: DEFAULT_SOURCES_FILE.sources[0].runtime,
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-sched-'));
  configDir = path.join(tmpRoot, 'config');
  briefsDir = path.join(tmpRoot, 'briefs');
  invalidDir = path.join(tmpRoot, '_invalid');
  fs.mkdirSync(configDir, { recursive: true });

  const repo = new BriefRepo(briefsDir, invalidDir, log);
  const collector = new Collector(repo, log);
  scheduler = new Scheduler(collector, configDir, log);

  // 用 mockReset 清掉上个测试的 mockReturnValue，再恢复默认行为
  mockSchedule.mockReset();
  mockSchedule.mockReturnValue({ stop: vi.fn() });
  mockValidate.mockReset();
  mockValidate.mockReturnValue(true);
});

afterEach(() => {
  scheduler.stop();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Scheduler', () => {
  it('start 注册所有 enabled source', () => {
    saveSources(configDir, {
      sources: [
        makeSource({ id: 'a', enabled: true }),
        makeSource({ id: 'b', enabled: true }),
        makeSource({ id: 'c', enabled: false }),
      ],
      global: DEFAULT_SOURCES_FILE.global,
    });

    scheduler.start();
    expect(mockSchedule).toHaveBeenCalledTimes(2); // 只注册 enabled
  });

  it('start 跳过 disabled source', () => {
    saveSources(configDir, {
      sources: [makeSource({ id: 'a', enabled: false })],
      global: DEFAULT_SOURCES_FILE.global,
    });

    scheduler.start();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('非法 cron 不注册', () => {
    mockValidate.mockReturnValue(false);
    saveSources(configDir, {
      sources: [makeSource({ id: 'a', schedule: 'invalid cron' })],
      global: DEFAULT_SOURCES_FILE.global,
    });

    scheduler.start();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('register 单个 source', () => {
    saveSources(configDir, { sources: [], global: DEFAULT_SOURCES_FILE.global });
    scheduler.start();

    const sf = { sources: [makeSource({ id: 'x' })], global: DEFAULT_SOURCES_FILE.global };
    scheduler.register(makeSource({ id: 'x' }), sf);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('unregister 停止任务', () => {
    const stopFn = vi.fn();
    mockSchedule.mockReturnValue({ stop: stopFn });
    saveSources(configDir, {
      sources: [makeSource({ id: 'a' })],
      global: DEFAULT_SOURCES_FILE.global,
    });
    scheduler.start();

    scheduler.unregister('a');
    expect(stopFn).toHaveBeenCalled();
  });

  it('reloadAll 清空后重新注册', () => {
    saveSources(configDir, {
      sources: [makeSource({ id: 'a' }), makeSource({ id: 'b' })],
      global: DEFAULT_SOURCES_FILE.global,
    });
    scheduler.start();
    expect(mockSchedule).toHaveBeenCalledTimes(2);

    mockSchedule.mockClear();
    scheduler.reloadAll();
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('runCollect 成功更新 runtime', async () => {
    const sf = { sources: [makeSource({ id: 'a' })], global: DEFAULT_SOURCES_FILE.global };
    saveSources(configDir, sf);

    // mock collector.collect 返回成功结果
    const repo = new BriefRepo(briefsDir, invalidDir, log);
    const collector = new Collector(repo, log);
    vi.spyOn(collector, 'collect').mockResolvedValue({
      source: makeSource({ id: 'a' }),
      fetched: 5,
      rawBriefs: [{ title: 't' } as any],
    });
    scheduler = new Scheduler(collector, configDir, log);

    const r = await scheduler.runCollect('a');
    expect(r.success).toBe(true);
    expect(r.newCount).toBe(1);

    const reread = loadSources(configDir);
    expect(reread.sources[0].runtime.lastRunAt).not.toBeNull();
    expect(reread.sources[0].runtime.lastSuccessAt).not.toBeNull();
    expect(reread.sources[0].runtime.lastCollectedCount).toBe(5);
    expect(reread.sources[0].runtime.lastNewCount).toBe(1);
    expect(reread.sources[0].runtime.consecutiveFailures).toBe(0);
  });

  it('runCollect 失败更新 runtime 错误状态', async () => {
    saveSources(configDir, {
      sources: [makeSource({ id: 'a' })],
      global: DEFAULT_SOURCES_FILE.global,
    });

    const repo = new BriefRepo(briefsDir, invalidDir, log);
    const collector = new Collector(repo, log);
    vi.spyOn(collector, 'collect').mockRejectedValue(new Error('network down'));
    scheduler = new Scheduler(collector, configDir, log);

    const r = await scheduler.runCollect('a');
    expect(r.success).toBe(false);
    expect(r.error).toBe('network down');

    const reread = loadSources(configDir);
    expect(reread.sources[0].runtime.lastError).toBe('network down');
    expect(reread.sources[0].runtime.consecutiveFailures).toBe(1);
  });

  it('runCollect 不存在的 source 返回失败', async () => {
    saveSources(configDir, { sources: [], global: DEFAULT_SOURCES_FILE.global });
    const r = await scheduler.runCollect('not-exist');
    expect(r.success).toBe(false);
    expect(r.error).toBe('source not found');
  });
});
