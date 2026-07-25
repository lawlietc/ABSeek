import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BriefRepo } from '../../electron/main/store/briefRepo';
import { createLogger } from '../../electron/main/logger/logger';
import { RawBrief } from '../../electron/main/collector/types';
import { SourceConfig, DEFAULT_REQUEST } from '../../electron/main/store/configRepo';

let tmpRoot: string;
let briefsDir: string;
let invalidDir: string;
let repo: BriefRepo;

const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'ign',
    name: 'IGN',
    type: 'rss',
    url: '',
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

function makeRaw(overrides: Partial<RawBrief> = {}): RawBrief {
  return {
    title: 'GTA 6 Release Window',
    summary: 'Rockstar confirms GTA 6 for spring 2027',
    date: '2026-07-23T08:00:00.000Z',
    source: 'ign',
    sourceName: 'IGN',
    sourceUrl: 'https://www.ign.com/articles/gta6',
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-brief-'));
  briefsDir = path.join(tmpRoot, 'briefs');
  invalidDir = path.join(tmpRoot, '_invalid');
  repo = new BriefRepo(briefsDir, invalidDir, log);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('BriefRepo.saveCollected', () => {
  it('按日期子目录 + 规定命名格式写入', () => {
    const raw = makeRaw();
    const res = repo.saveCollected(raw, makeSource(), new Set());
    expect(res.saved).toBe(true);

    const dateDir = raw.date.substring(0, 10);
    const filePath = path.join(briefsDir, dateDir, res.filename);
    expect(fs.existsSync(filePath)).toBe(true);
    // 文件名格式：{YYYYMMDD}-{seq}-{hash6}-{source}-{slug}.md
    expect(res.filename).toMatch(/^20260723-01-[a-f0-9]{6}-ign-gta-6-release-window\.md$/);
  });

  it('同日期多条递增序号', () => {
    const s = makeSource();
    const ids = new Set<string>();
    const r1 = repo.saveCollected(makeRaw({ title: 'A' }), s, ids);
    if (r1.saved) ids.add(r1.id);
    const r2 = repo.saveCollected(makeRaw({ title: 'B' }), s, ids);
    if (r2.saved) ids.add(r2.id);

    expect(r1.filename).toMatch(/-01-/);
    expect(r2.filename).toMatch(/-02-/);
  });

  it('saveCollected 通过 seq 递增避免文件名冲突', () => {
    // 说明：saveCollected 不做内容去重（那是 Collector 职责），
    // 它只保证文件名不冲突：扫描磁盘已存在文件 + 内存 ids，序号递增
    const s = makeSource();
    const r1 = repo.saveCollected(makeRaw(), s, new Set());
    expect(r1.saved).toBe(true);
    expect(r1.filename).toMatch(/-01-/);
    // 第二次写入：磁盘已有 01，nextSeq 返回 02，文件名不同，写入成功
    const r2 = repo.saveCollected(makeRaw(), s, new Set());
    expect(r2.saved).toBe(true);
    expect(r2.filename).toMatch(/-02-/);
  });

  it('写入的文件可被 parseFile 解析回', () => {
    const raw = makeRaw();
    const res = repo.saveCollected(raw, makeSource(), new Set());
    const dateDir = raw.date.substring(0, 10);
    const filePath = path.join(briefsDir, dateDir, res.filename);
    const brief = repo.parseFile(filePath);
    expect(brief).not.toBeNull();
    expect(brief!.id).toBe(res.id);
    expect(brief!.source).toBe('IGN');
    expect(brief!.title.en).toBe(raw.title);
    expect(brief!.status).toBe('raw');
    expect(brief!.tags).toContain('游戏');
  });
});

describe('BriefRepo.list / getById', () => {
  it('递归读取所有简讯', () => {
    const s = makeSource();
    repo.saveCollected(makeRaw({ title: 'A', date: '2026-07-23T08:00:00Z' }), s, new Set());
    repo.saveCollected(makeRaw({ title: 'B', date: '2026-07-24T08:00:00Z' }), s, new Set());

    const list = repo.list();
    expect(list).toHaveLength(2);
  });

  it('getById 命中', () => {
    const res = repo.saveCollected(makeRaw(), makeSource(), new Set());
    const brief = repo.getById(res.id);
    expect(brief).not.toBeNull();
    expect(brief!.id).toBe(res.id);
  });

  it('getById 未命中返回 null', () => {
    expect(repo.getById('not-exist')).toBeNull();
  });
});

describe('BriefRepo.save', () => {
  it('更新 aspect 字段', () => {
    const res = repo.saveCollected(makeRaw(), makeSource(), new Set());
    const brief = repo.getById(res.id)!;
    const ok = repo.save({ ...brief, aspect: 'A' });
    expect(ok).toBe(true);

    const reread = repo.getById(res.id);
    expect(reread!.aspect).toBe('A');
  });

  it('更新 tags 与 customAttrs', () => {
    const res = repo.saveCollected(makeRaw(), makeSource(), new Set());
    const brief = repo.getById(res.id)!;
    repo.save({
      ...brief,
      tags: ['游戏', 'DLC'],
      customAttrs: { importance: 'high' },
    });
    const reread = repo.getById(res.id)!;
    expect(reread.tags).toEqual(['游戏', 'DLC']);
    expect(reread.customAttrs.importance).toBe('high');
  });
});

describe('BriefRepo.parseFile 异常处理', () => {
  it('解析失败移入 _invalid', () => {
    const dateDir = '2026-07-23';
    fs.mkdirSync(path.join(briefsDir, dateDir), { recursive: true });
    const badFile = path.join(briefsDir, dateDir, 'broken.md');
    fs.writeFileSync(badFile, '---\nnot: valid: frontmatter\n---\nbody', 'utf8');

    const result = repo.parseFile(badFile);
    expect(result).toBeNull();
    // 应被移到 _invalid
    const invalidFiles = fs.readdirSync(invalidDir);
    expect(invalidFiles.length).toBe(1);
    expect(invalidFiles[0]).toContain('broken.md');
    expect(fs.existsSync(badFile)).toBe(false);
  });
});

describe('BriefRepo.buildDedupIndex', () => {
  it('返回 url / hash / titles 索引', () => {
    const s = makeSource();
    const raw = makeRaw();
    repo.saveCollected(raw, s, new Set());

    const idx = repo.buildDedupIndex(30);
    expect(idx.urls.size).toBeGreaterThan(0);
    expect(idx.hashes.size).toBeGreaterThan(0);
    expect(idx.titles.length).toBeGreaterThan(0);
  });

  it('超过 ttlDays 的不纳入索引', () => {
    const s = makeSource();
    // 60 天前的数据
    const oldDate = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    repo.saveCollected(makeRaw({ date: oldDate }), s, new Set());

    const idx = repo.buildDedupIndex(30);
    expect(idx.urls.size).toBe(0);
  });
});
