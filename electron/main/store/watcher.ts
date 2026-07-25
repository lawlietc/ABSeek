import * as chokidar from 'chokidar';
import * as path from 'path';
import { BriefRepo } from './briefRepo';
import { Logger } from '../logger/logger';
import { Brief } from '../core/types';

export interface WatcherCallbacks {
  onBriefAdded?: (brief: Brief) => void;
  onBriefUpdated?: (id: string, brief: Brief) => void;
  onBriefDeleted?: (id: string) => void;
  onBatchChanged?: () => void;
}

/**
 * 文件监听器
 * - debounce 400ms
 * - 忽略 *.tmp / *.lock / *.partial
 * - 外部 agent 改动 md 后触发回调
 */
export class BriefWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private pending = new Map<string, NodeJS.Timeout>();
  private debounceMs = 400;

  constructor(
    private briefsDir: string,
    private repo: BriefRepo,
    private log: Logger,
    private callbacks: WatcherCallbacks = {}
  ) {}

  start(): void {
    if (this.watcher) return;
    fs.mkdirSync(this.briefsDir, { recursive: true });
    this.watcher = chokidar.watch(this.briefsDir, {
      ignoreInitial: true,
      ignored: (p) => {
        const base = path.basename(p);
        return (
          base.endsWith('.tmp') ||
          base.endsWith('.lock') ||
          base.endsWith('.partial') ||
          base.startsWith('.')
        );
      },
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });

    this.watcher.on('add', (fp) => this.schedule(fp, 'add'));
    this.watcher.on('change', (fp) => this.schedule(fp, 'change'));
    this.watcher.on('unlink', (fp) => this.schedule(fp, 'unlink'));

    this.log.info(`[watcher] 已启动，监听 ${this.briefsDir}`);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const [, t] of this.pending) clearTimeout(t);
    this.pending.clear();
  }

  private schedule(filePath: string, event: 'add' | 'change' | 'unlink'): void {
    if (!filePath.endsWith('.md')) return;
    const existing = this.pending.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pending.delete(filePath);
      this.handle(filePath, event);
    }, this.debounceMs);
    this.pending.set(filePath, timer);
  }

  private handle(filePath: string, event: 'add' | 'change' | 'unlink'): void {
    if (event === 'unlink') {
      // 文件删除：从路径提取 id
      const name = path.basename(filePath, '.md');
      this.log.info(`[watcher] 删除: ${name}`);
      this.callbacks.onBriefDeleted?.(name);
      this.callbacks.onBatchChanged?.();
      return;
    }

    const brief = this.repo.parseFile(filePath);
    if (!brief) {
      this.log.warn(`[watcher] 解析失败，已移入 _invalid: ${filePath}`);
      this.callbacks.onBatchChanged?.();
      return;
    }

    if (event === 'add') {
      this.log.info(`[watcher] 新增: ${brief.id}`);
      this.callbacks.onBriefAdded?.(brief);
    } else {
      this.log.info(`[watcher] 更新: ${brief.id}`);
      this.callbacks.onBriefUpdated?.(brief.id, brief);
    }
    this.callbacks.onBatchChanged?.();
  }
}

// 引入 fs 仅用于 mkdirSync
import * as fs from 'fs';
