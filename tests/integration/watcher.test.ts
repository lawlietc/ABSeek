import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BriefWatcher } from '../../electron/main/store/watcher';
import { BriefRepo } from '../../electron/main/store/briefRepo';
import { createLogger } from '../../electron/main/logger/logger';

let tmpRoot: string;
let briefsDir: string;
let invalidDir: string;
let repo: BriefRepo;
let watcher: BriefWatcher;
const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-watch-'));
  briefsDir = path.join(tmpRoot, 'briefs');
  invalidDir = path.join(tmpRoot, '_invalid');
  repo = new BriefRepo(briefsDir, invalidDir, log);
});

afterEach(() => {
  watcher?.stop();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 工具：等待指定毫秒
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 工具：等待条件成立或超时
async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await wait(100);
  }
  throw new Error('waitFor 超时');
}

function makeValidMd(id: string): string {
  return `---
id: ${id}
date: 2026-07-23T08:00:00+08:00
source: IGN
sourceUrl: https://ign.com/${id}
title:
  en: ${id}
summary:
  en: summary of ${id}
tags: [游戏]
category: 游戏
aspect: A
status: raw
---

body of ${id}
`;
}

describe('BriefWatcher', () => {
  it('新增 .md 文件触发 onBriefAdded', async () => {
    let added: any = null;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBriefAdded: (b) => { added = b; },
    });
    watcher.start();
    await wait(500); // 等 watcher ready

    const filePath = path.join(briefsDir, '2026-07-23', 'test-01.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, makeValidMd('test-01'), 'utf8');

    await waitFor(() => added !== null);
    expect(added).not.toBeNull();
    expect(added.id).toBe('test-01');
  });

  it('修改 .md 文件触发 onBriefUpdated', async () => {
    const filePath = path.join(briefsDir, '2026-07-23', 'test-02.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, makeValidMd('test-02'), 'utf8');

    let updated: any = null;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBriefUpdated: (_id, b) => { updated = b; },
    });
    watcher.start();
    await wait(500);

    fs.writeFileSync(filePath, makeValidMd('test-02').replace('aspect: A', 'aspect: B'), 'utf8');
    await waitFor(() => updated !== null);
    expect(updated).not.toBeNull();
  });

  it('删除 .md 文件触发 onBriefDeleted', async () => {
    const filePath = path.join(briefsDir, '2026-07-23', 'test-03.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, makeValidMd('test-03'), 'utf8');

    let deleted: string | null = null;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBriefDeleted: (id) => { deleted = id; },
    });
    watcher.start();
    await wait(500);

    fs.unlinkSync(filePath);
    await waitFor(() => deleted !== null);
    expect(deleted).toBe('test-03');
  });

  it('忽略 .tmp / .lock / .partial 文件', async () => {
    let added = false;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBriefAdded: () => { added = true; },
    });
    watcher.start();
    await wait(500);

    fs.writeFileSync(path.join(briefsDir, 'ignore.tmp'), 'tmp', 'utf8');
    fs.writeFileSync(path.join(briefsDir, 'ignore.lock'), 'lock', 'utf8');
    fs.writeFileSync(path.join(briefsDir, 'ignore.partial'), 'partial', 'utf8');

    await wait(1000);
    expect(added).toBe(false);
  });

  it('onBatchChanged 在任意事件后被调用', async () => {
    let batchCalled = false;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBatchChanged: () => { batchCalled = true; },
    });
    watcher.start();
    await wait(500);

    const filePath = path.join(briefsDir, '2026-07-23', 'test-04.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, makeValidMd('test-04'), 'utf8');

    await waitFor(() => batchCalled);
    expect(batchCalled).toBe(true);
  });

  it('非 .md 文件不触发事件', async () => {
    let added = false;
    watcher = new BriefWatcher(briefsDir, repo, log, {
      onBriefAdded: () => { added = true; },
    });
    watcher.start();
    await wait(500);

    fs.writeFileSync(path.join(briefsDir, 'readme.txt'), 'text', 'utf8');
    fs.writeFileSync(path.join(briefsDir, 'data.json'), '{}', 'utf8');

    await wait(1000);
    expect(added).toBe(false);
  });
});
