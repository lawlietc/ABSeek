import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// mock runStoryAutoExport：避免真的调用 puppeteer 出图
const { mockRunStoryAutoExport } = vi.hoisted(() => ({
  mockRunStoryAutoExport: vi.fn(),
}));
vi.mock('../../electron/main/core/autoExport', () => ({
  runStoryAutoExport: mockRunStoryAutoExport,
  runAutoExport: vi.fn(),
  filterStoriesForAutoExport: vi.fn((stories: any[]) => stories), // 直通
}));

import { Automation } from '../../electron/main/automation/automation';
import { BriefRepo } from '../../electron/main/store/briefRepo';
import { StoryRepo } from '../../electron/main/store/storyRepo';
import { createLogger } from '../../electron/main/logger/logger';
import { saveAutomation } from '../../electron/main/store/configRepo';
import { saveSources, DEFAULT_SOURCES_FILE } from '../../electron/main/store/configRepo';
import { AutomationConfig, DEFAULT_AUTOMATION_CONFIG } from '../../electron/main/automation/types';
import { Scheduler } from '../../electron/main/collector/scheduler';

let tmpRoot: string;
let configDir: string;
let templatesDir: string;
let outputDir: string;
let briefsDir: string;
let storiesDir: string;
let invalidDir: string;
let logsDir: string;
let briefRepo: BriefRepo;
let storyRepo: StoryRepo;
let log: ReturnType<typeof createLogger>;

/** fake scheduler：可控的 runCollect */
function makeFakeScheduler() {
  const calls: string[] = [];
  const impl: Partial<Scheduler> = {
    runCollect: vi.fn(async (sourceId: string) => {
      calls.push(sourceId);
      return { success: true, newCount: 5 };
    }),
    start: vi.fn(),
    stop: vi.fn(),
    reloadAll: vi.fn(),
  };
  return { impl: impl as Scheduler, calls };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-auto-it-'));
  configDir = path.join(tmpRoot, 'config');
  templatesDir = path.join(tmpRoot, 'templates');
  outputDir = path.join(tmpRoot, 'output');
  briefsDir = path.join(tmpRoot, 'briefs');
  invalidDir = path.join(tmpRoot, '_invalid');
  logsDir = path.join(tmpRoot, 'logs');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(briefsDir, { recursive: true });
  fs.mkdirSync(invalidDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  briefRepo = new BriefRepo(briefsDir, invalidDir, createLogger('test', logsDir));
  storiesDir = path.join(tmpRoot, 'stories');
  fs.mkdirSync(storiesDir, { recursive: true });
  storyRepo = new StoryRepo(storiesDir, invalidDir, createLogger('test', logsDir));
  log = createLogger('test-auto', logsDir);

  mockRunStoryAutoExport.mockReset();
  mockRunStoryAutoExport.mockResolvedValue({
    success: true,
    files: ['2026-07-25-template-a-A-1-zh.jpg'],
    outputDir: path.join(outputDir, '2026-07-25'),
    briefCount: 3,
  });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeAutomationConfig(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    ...DEFAULT_AUTOMATION_CONFIG,
    enabled: true,
    ...overrides,
  };
}

describe('Automation 集成测试', () => {
  it('runCollectNow 强制重跑：忽略"今日已成功"判定', async () => {
    // 预置今日已成功的 runtime
    const cfg = makeAutomationConfig({
      runtime: {
        ...DEFAULT_AUTOMATION_CONFIG.runtime,
        lastCollectAt: new Date().toISOString(),
        lastCollectStatus: 'success',
        lastCollectCount: 100,
      },
    });
    saveAutomation(configDir, cfg);
    // 预置 sources
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const { impl, calls } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);

    const r = await automation.runCollectNow();
    expect(r.status).toBe('success');
    expect(r.count).toBe(15); // 3 个源 × 5 条
    expect(calls).toHaveLength(3); // 三个默认 enabled 源都被调用
  });

  it('runExportNow 强制重跑：调用 runAutoExport', async () => {
    const cfg = makeAutomationConfig();
    saveAutomation(configDir, cfg);

    const { impl } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);

    const r = await automation.runExportNow();
    expect(r.status).toBe('success');
    expect(r.count).toBe(1);
    expect(mockRunStoryAutoExport).toHaveBeenCalledOnce();
    // 验证传递的参数
    const args = mockRunStoryAutoExport.mock.calls[0];
    expect(args[4]).toMatchObject({
      statusFilter: ['processed', 'reviewed'],
      langs: ['zh'],
    });
  });

  it('runtime 持久化到 automation.json', async () => {
    const cfg = makeAutomationConfig();
    saveAutomation(configDir, cfg);
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const { impl } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);

    await automation.runCollectNow();

    const saved = JSON.parse(fs.readFileSync(path.join(configDir, 'automation.json'), 'utf8'));
    expect(saved.runtime.lastCollectAt).toBeTruthy();
    expect(saved.runtime.lastCollectStatus).toBe('success');
    expect(saved.runtime.lastCollectCount).toBe(15);
    expect(saved.runtime.history).toHaveLength(1);
    expect(saved.runtime.history[0]).toMatchObject({
      type: 'collect',
      status: 'success',
      count: 15,
    });
  });

  it('部分源采集失败时整体仍视为成功（只要有源成功）', async () => {
    saveAutomation(configDir, makeAutomationConfig());
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const calls: string[] = [];
    const impl = {
      runCollect: vi.fn(async (sourceId: string) => {
        calls.push(sourceId);
        // 第一个源失败，其余成功
        if (calls.length === 1) {
          return { success: false, newCount: 0, error: 'network error' };
        }
        return { success: true, newCount: 3 };
      }),
      start: vi.fn(),
      stop: vi.fn(),
      reloadAll: vi.fn(),
    } as unknown as Scheduler;

    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);
    const r = await automation.runCollectNow();

    expect(r.status).toBe('success');
    expect(r.count).toBe(6); // 2 个成功源 × 3 条（共 3 个源，第一个失败）
    expect(r.error).toBe('network error'); // 保留首个错误
  });

  it('全部源失败时整体视为 failed', async () => {
    saveAutomation(configDir, makeAutomationConfig());
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const impl = {
      runCollect: vi.fn(async () => ({ success: false, newCount: 0, error: 'all failed' })),
      start: vi.fn(),
      stop: vi.fn(),
      reloadAll: vi.fn(),
    } as unknown as Scheduler;

    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);
    const r = await automation.runCollectNow();

    expect(r.status).toBe('failed');
    expect(r.count).toBe(0);
  });

  it('出图返回 success=false 时整体 failed', async () => {
    saveAutomation(configDir, makeAutomationConfig());
    mockRunStoryAutoExport.mockResolvedValue({
      success: false,
      files: [],
      outputDir: '',
      briefCount: 0,
      error: 'no bindings',
    });

    const { impl } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);
    const r = await automation.runExportNow();

    expect(r.status).toBe('failed');
    expect(r.error).toBe('no bindings');
  });

  it('历史记录最多保留 50 条', async () => {
    saveAutomation(configDir, makeAutomationConfig());
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const { impl } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);

    // 跑 55 次出图
    for (let i = 0; i < 55; i++) {
      await automation.runExportNow();
    }
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, 'automation.json'), 'utf8'));
    expect(saved.runtime.history.length).toBe(50);
  });

  it('start 时若总开关关闭，不注册任何 cron', async () => {
    saveAutomation(configDir, makeAutomationConfig({ enabled: false }));
    saveSources(configDir, DEFAULT_SOURCES_FILE);

    const { impl } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);
    // start 不应抛错
    automation.start();
    // 没有运行任何任务
    expect((impl.runCollect as any).mock.calls).toHaveLength(0);
  });

  it('disabled 源不被采集', async () => {
    const sf: typeof DEFAULT_SOURCES_FILE = {
      ...DEFAULT_SOURCES_FILE,
      sources: DEFAULT_SOURCES_FILE.sources.map((s, i) => ({
        ...s,
        enabled: i === 0, // 只第一个启用
      })),
    };
    saveSources(configDir, sf);
    saveAutomation(configDir, makeAutomationConfig());

    const { impl, calls } = makeFakeScheduler();
    const automation = new Automation(impl, briefRepo, storyRepo, configDir, templatesDir, outputDir, log);
    await automation.runCollectNow();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(DEFAULT_SOURCES_FILE.sources[0].id);
  });
});
