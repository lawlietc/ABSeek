import * as cron from 'node-cron';
import { SourceConfig, SourcesFile, loadSources, saveSources } from '../store/configRepo';
import { Collector } from './collector';
import { Logger } from '../logger/logger';

export interface SchedulerCallbacks {
  onSourceUpdated: (source: SourceConfig) => void;
}

export class Scheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  private running = new Map<string, Promise<{ success: boolean; newCount: number; error?: string }>>();
  private collector: Collector;
  private configDir: string;
  private log: Logger;

  constructor(collector: Collector, configDir: string, log: Logger) {
    this.collector = collector;
    this.configDir = configDir;
    this.log = log;
  }

  /**
   * 启动时加载所有 enabled source 并注册定时任务
   */
  start(): void {
    const sourcesFile = loadSources(this.configDir);
    for (const s of sourcesFile.sources) {
      if (s.enabled) this.register(s, sourcesFile);
    }
    this.log.info(`[scheduler] 已注册 ${this.tasks.size} 个定时任务`);
  }

  /**
   * 注册单个 source 的定时任务
   */
  register(source: SourceConfig, sourcesFile: SourcesFile): void {
    this.unregister(source.id);
    if (!source.enabled) return;
    if (!cron.validate(source.schedule)) {
      this.log.warn(`[scheduler] 非法 cron: ${source.id} = ${source.schedule}`);
      return;
    }
    const task = cron.schedule(source.schedule, async () => {
      await this.runCollect(source.id);
    });
    this.tasks.set(source.id, task);
    this.log.info(`[scheduler] 注册: ${source.id} (${source.schedule})`);
  }

  unregister(sourceId: string): void {
    const t = this.tasks.get(sourceId);
    if (t) {
      t.stop();
      this.tasks.delete(sourceId);
    }
  }

  /**
   * 全部停止
   */
  stop(): void {
    for (const [, t] of this.tasks) t.stop();
    this.tasks.clear();
  }

  /**
   * 立即采集单个 source（更新 runtime）
   *
   * 并发保护：同一 source 同时只允许一个采集任务，第二个调用直接跳过返回。
   * 防止 per-source cron 与 automation 全局 cron / 手动触发同时跑同一 source，
   * 导致两个 collect() 基于同一份磁盘快照做去重判定，双双通过后写入 -01/-02 重复文件。
   */
  async runCollect(sourceId: string): Promise<{ success: boolean; newCount: number; error?: string }> {
    if (this.running.has(sourceId)) {
      this.log.info(`[scheduler] ${sourceId} 正在采集，跳过本次触发`);
      return { success: false, newCount: 0, error: 'already running' };
    }
    const p = this._runCollect(sourceId);
    this.running.set(sourceId, p);
    try {
      return await p;
    } finally {
      this.running.delete(sourceId);
    }
  }

  private async _runCollect(sourceId: string): Promise<{ success: boolean; newCount: number; error?: string }> {
    const sourcesFile = loadSources(this.configDir);
    const source = sourcesFile.sources.find((s) => s.id === sourceId);
    if (!source) return { success: false, newCount: 0, error: 'source not found' };

    const now = new Date().toISOString();
    source.runtime.lastRunAt = now;

    try {
      const result = await this.collector.collect(source, sourcesFile);
      source.runtime.lastSuccessAt = now;
      source.runtime.lastError = null;
      source.runtime.consecutiveFailures = 0;
      source.runtime.lastCollectedCount = result.fetched;
      source.runtime.lastNewCount = result.rawBriefs.length;
      this.persist(sourcesFile);
      return { success: true, newCount: result.rawBriefs.length };
    } catch (e: any) {
      source.runtime.lastError = e?.message || String(e);
      source.runtime.consecutiveFailures += 1;
      source.runtime.lastCollectedCount = 0;
      source.runtime.lastNewCount = 0;
      this.persist(sourcesFile);
      this.log.error(`[scheduler] 采集失败: ${sourceId}`, e);
      return { success: false, newCount: 0, error: source.runtime.lastError || undefined };
    }
  }

  /**
   * 重新加载所有任务（配置变更后调用）
   */
  reloadAll(): void {
    this.stop();
    this.start();
  }

  private persist(sourcesFile: SourcesFile): void {
    try {
      saveSources(this.configDir, sourcesFile);
    } catch (e) {
      this.log.error(`[scheduler] 保存 sources.json 失败`, e);
    }
  }
}
