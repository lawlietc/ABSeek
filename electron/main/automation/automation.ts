// v0.9 自动化编排器：注册双 cron（采集 + 出图），跳过当日已成功，记录历史

import * as cron from 'node-cron';
import { loadAutomation, saveAutomation } from '../store/configRepo';
import { loadSources } from '../store/configRepo';
import { BriefRepo } from '../store/briefRepo';
import { Scheduler } from '../collector/scheduler';
import { runAutoExport } from '../core/autoExport';
import { Logger } from '../logger/logger';
import {
  AutomationConfig,
  TaskType,
  TaskStatus,
  TaskRunResult,
  TaskHistoryItem,
} from './types';

const MAX_HISTORY = 50;

export class Automation {
  private collectTask: cron.ScheduledTask | null = null;
  private exportTask: cron.ScheduledTask | null = null;
  private scheduler: Scheduler;
  private briefRepo: BriefRepo;
  private configDir: string;
  private templatesDir: string;
  private outputDir: string;
  private log: Logger;
  /** 防止任务并发执行 */
  private collectRunning = false;
  private exportRunning = false;

  constructor(
    scheduler: Scheduler,
    briefRepo: BriefRepo,
    configDir: string,
    templatesDir: string,
    outputDir: string,
    log: Logger
  ) {
    this.scheduler = scheduler;
    this.briefRepo = briefRepo;
    this.configDir = configDir;
    this.templatesDir = templatesDir;
    this.outputDir = outputDir;
    this.log = log;
  }

  /**
   * 启动：读取配置并注册 cron 任务
   */
  start(): void {
    const cfg = loadAutomation(this.configDir);
    if (!cfg.enabled) {
      this.log.info('[automation] 总开关关闭，不注册定时任务');
      return;
    }
    this.registerCollect(cfg);
    this.registerExport(cfg);
  }

  /**
   * 重新加载（配置变更后调用）
   */
  reload(): void {
    this.stop();
    this.start();
  }

  stop(): void {
    this.collectTask?.stop();
    this.exportTask?.stop();
    this.collectTask = null;
    this.exportTask = null;
  }

  /**
   * 判定当天是否已成功执行某任务（手动触发会跳过此判定）
   */
  static shouldSkipToday(cfg: AutomationConfig, type: TaskType): boolean {
    const lastAt = type === 'collect' ? cfg.runtime.lastCollectAt : cfg.runtime.lastExportAt;
    const lastStatus = type === 'collect' ? cfg.runtime.lastCollectStatus : cfg.runtime.lastExportStatus;
    if (!lastAt || lastStatus !== 'success') return false;
    const last = new Date(lastAt);
    const today = new Date();
    return last.toDateString() === today.toDateString();
  }

  /**
   * 立即采集（手动触发，强制重跑）
   */
  async runCollectNow(): Promise<TaskRunResult> {
    return this.runCollect(true);
  }

  /**
   * 立即出图（手动触发，强制重跑）
   */
  async runExportNow(): Promise<TaskRunResult> {
    return this.runExport(true);
  }

  // ============ 内部实现 ============

  private registerCollect(cfg: AutomationConfig): void {
    if (!cfg.collect.enabled) return;
    if (!cron.validate(cfg.collect.schedule)) {
      this.log.warn(`[automation] 采集 cron 非法: ${cfg.collect.schedule}`);
      return;
    }
    this.collectTask = cron.schedule(cfg.collect.schedule, async () => {
      await this.runCollect(false);
    });
    this.log.info(`[automation] 注册采集任务: ${cfg.collect.schedule}`);
  }

  private registerExport(cfg: AutomationConfig): void {
    if (!cfg.export.enabled) return;
    if (!cron.validate(cfg.export.schedule)) {
      this.log.warn(`[automation] 出图 cron 非法: ${cfg.export.schedule}`);
      return;
    }
    this.exportTask = cron.schedule(cfg.export.schedule, async () => {
      await this.runExport(false);
    });
    this.log.info(`[automation] 注册出图任务: ${cfg.export.schedule}`);
  }

  /**
   * 执行采集任务：遍历所有 enabled sources
   */
  private async runCollect(force: boolean): Promise<TaskRunResult> {
    if (this.collectRunning) {
      return { status: 'skipped', count: 0, durationMs: 0, error: 'already running' };
    }
    const cfg = loadAutomation(this.configDir);
    if (!force && Automation.shouldSkipToday(cfg, 'collect')) {
      this.log.info('[automation] 采集任务今日已成功，跳过');
      return { status: 'skipped', count: 0, durationMs: 0 };
    }

    this.collectRunning = true;
    const start = Date.now();
    let totalNew = 0;
    let firstError: string | undefined;
    let allFailed = true;

    try {
      const sf = loadSources(this.configDir);
      const enabledSources = sf.sources.filter((s) => s.enabled);
      this.log.info(`[automation] 开始采集 ${enabledSources.length} 个源`);

      for (const s of enabledSources) {
        const r = await this.scheduler.runCollect(s.id);
        if (r.success) {
          totalNew += r.newCount;
          allFailed = false;
        } else if (!firstError) {
          firstError = r.error;
        }
      }

      const durationMs = Date.now() - start;
      const status: TaskStatus = allFailed && enabledSources.length > 0 ? 'failed' : 'success';
      const result: TaskRunResult = {
        status,
        count: totalNew,
        durationMs,
        error: firstError,
      };
      this.updateRuntime(cfg, 'collect', result);
      this.log.info(
        `[automation] 采集完成 status=${status} new=${totalNew} 耗时=${durationMs}ms`
      );
      return result;
    } catch (e: any) {
      const durationMs = Date.now() - start;
      const result: TaskRunResult = {
        status: 'failed',
        count: totalNew,
        durationMs,
        error: e?.message || String(e),
      };
      this.updateRuntime(cfg, 'collect', result);
      this.log.error('[automation] 采集异常', e);
      return result;
    } finally {
      this.collectRunning = false;
    }
  }

  /**
   * 执行出图任务：筛选 → 渲染 → 落盘
   */
  private async runExport(force: boolean): Promise<TaskRunResult> {
    if (this.exportRunning) {
      return { status: 'skipped', count: 0, durationMs: 0, error: 'already running' };
    }
    const cfg = loadAutomation(this.configDir);
    if (!force && Automation.shouldSkipToday(cfg, 'export')) {
      this.log.info('[automation] 出图任务今日已成功，跳过');
      return { status: 'skipped', count: 0, durationMs: 0 };
    }

    this.exportRunning = true;
    const start = Date.now();

    try {
      const r = await runAutoExport(
        this.briefRepo,
        this.templatesDir,
        this.configDir,
        this.outputDir,
        {
          statusFilter: cfg.export.statusFilter,
          langs: cfg.export.langs,
        },
        this.log
      );

      const durationMs = Date.now() - start;
      const status: TaskStatus = r.success ? 'success' : 'failed';
      const result: TaskRunResult = {
        status,
        count: r.files.length,
        durationMs,
        error: r.error,
      };
      this.updateRuntime(cfg, 'export', result);
      this.log.info(
        `[automation] 出图完成 status=${status} files=${r.files.length} 耗时=${durationMs}ms`
      );
      return result;
    } catch (e: any) {
      const durationMs = Date.now() - start;
      const result: TaskRunResult = {
        status: 'failed',
        count: 0,
        durationMs,
        error: e?.message || String(e),
      };
      this.updateRuntime(cfg, 'export', result);
      this.log.error('[automation] 出图异常', e);
      return result;
    } finally {
      this.exportRunning = false;
    }
  }

  /**
   * 更新 runtime 并持久化
   */
  private updateRuntime(cfg: AutomationConfig, type: TaskType, result: TaskRunResult): void {
    const now = new Date().toISOString();
    if (type === 'collect') {
      cfg.runtime.lastCollectAt = now;
      cfg.runtime.lastCollectStatus = result.status;
      cfg.runtime.lastCollectCount = result.count;
    } else {
      cfg.runtime.lastExportAt = now;
      cfg.runtime.lastExportStatus = result.status;
      cfg.runtime.lastExportCount = result.count;
    }
    cfg.runtime.lastError = result.error || null;

    const item: TaskHistoryItem = {
      at: now,
      type,
      status: result.status,
      durationMs: result.durationMs,
      count: result.count,
      error: result.error,
    };
    cfg.runtime.history.unshift(item);
    if (cfg.runtime.history.length > MAX_HISTORY) {
      cfg.runtime.history = cfg.runtime.history.slice(0, MAX_HISTORY);
    }

    try {
      saveAutomation(this.configDir, cfg);
    } catch (e) {
      this.log.error('[automation] 保存 automation.json 失败', e);
    }
  }
}
