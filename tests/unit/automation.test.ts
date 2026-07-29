import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadAutomation,
  saveAutomation,
} from '../../electron/main/store/configRepo';
import {
  AutomationConfig,
  DEFAULT_AUTOMATION_CONFIG,
} from '../../electron/main/automation/types';
import { Automation } from '../../electron/main/automation/automation';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-auto-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadAutomation', () => {
  it('首次调用写入默认配置文件', () => {
    const data = loadAutomation(tmpDir);
    const file = path.join(tmpDir, 'automation.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(data.enabled).toBe(false);
    expect(data.collect.schedule).toBe('0 8 * * *');
    expect(data.export.schedule).toBe('0 10 * * *');
    expect(data.export.statusFilter).toEqual(['processed', 'reviewed']);
  });

  it('解析已存在的 automation.json', () => {
    const cfg: AutomationConfig = {
      ...DEFAULT_AUTOMATION_CONFIG,
      enabled: true,
      collect: { ...DEFAULT_AUTOMATION_CONFIG.collect, schedule: '30 7 * * *' },
    };
    saveAutomation(tmpDir, cfg);
    const loaded = loadAutomation(tmpDir);
    expect(loaded.enabled).toBe(true);
    expect(loaded.collect.schedule).toBe('30 7 * * *');
  });

  it('解析失败时回退默认', () => {
    fs.writeFileSync(path.join(tmpDir, 'automation.json'), 'not json', 'utf8');
    const loaded = loadAutomation(tmpDir);
    expect(loaded.enabled).toBe(false);
    expect(loaded.collect.schedule).toBe('0 8 * * *');
  });

  it('补齐缺失的字段', () => {
    // 故意只写一部分字段
    fs.writeFileSync(
      path.join(tmpDir, 'automation.json'),
      JSON.stringify({ enabled: true }),
      'utf8'
    );
    const loaded = loadAutomation(tmpDir);
    expect(loaded.enabled).toBe(true);
    expect(loaded.collect).toBeDefined();
    expect(loaded.export).toBeDefined();
    expect(loaded.runtime).toBeDefined();
    expect(loaded.export.statusFilter).toEqual(['processed', 'reviewed']);
  });
});

describe('Automation.shouldSkipToday', () => {
  const base: AutomationConfig = {
    ...DEFAULT_AUTOMATION_CONFIG,
    enabled: true,
  };

  it('从未运行过 → 不跳过', () => {
    expect(Automation.shouldSkipToday(base, 'collect')).toBe(false);
    expect(Automation.shouldSkipToday(base, 'export')).toBe(false);
  });

  it('今天已成功 → 跳过', () => {
    const now = new Date().toISOString();
    const cfg: AutomationConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        lastCollectAt: now,
        lastCollectStatus: 'success',
        lastExportAt: now,
        lastExportStatus: 'success',
      },
    };
    expect(Automation.shouldSkipToday(cfg, 'collect')).toBe(true);
    expect(Automation.shouldSkipToday(cfg, 'export')).toBe(true);
  });

  it('今天失败过 → 不跳过（可重试）', () => {
    const now = new Date().toISOString();
    const cfg: AutomationConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        lastCollectAt: now,
        lastCollectStatus: 'failed',
      },
    };
    expect(Automation.shouldSkipToday(cfg, 'collect')).toBe(false);
  });

  it('昨天成功 → 不跳过', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cfg: AutomationConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        lastCollectAt: yesterday,
        lastCollectStatus: 'success',
      },
    };
    expect(Automation.shouldSkipToday(cfg, 'collect')).toBe(false);
  });

  it('collect 与 export 独立判定', () => {
    const now = new Date().toISOString();
    const cfg: AutomationConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        lastCollectAt: now,
        lastCollectStatus: 'success',
        lastExportAt: null,
        lastExportStatus: null,
      },
    };
    expect(Automation.shouldSkipToday(cfg, 'collect')).toBe(true);
    expect(Automation.shouldSkipToday(cfg, 'export')).toBe(false);
  });
});
