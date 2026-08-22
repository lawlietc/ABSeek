import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StoryRepo } from '../../electron/main/store/storyRepo';
import { createLogger } from '../../electron/main/logger/logger';
import { Story } from '../../electron/main/core/types';

let tmpRoot: string;
let storiesDir: string;
let invalidDir: string;
let repo: StoryRepo;

const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

function makeStoryData(overrides: Partial<Parameters<StoryRepo['create']>[0]> = {}) {
  return {
    date: '2026-08-09T08:00:00.000Z',
    title: { zh: '测试展示简讯', en: 'Test Story' },
    summary: { zh: '摘要', en: 'summary' },
    tags: ['AI'],
    category: 'AI',
    aspect: 'topic-a',
    customAttrs: { importance: 'high' },
    status: 'raw' as const,
    sources: [
      { briefId: '20260809-01-aaaaaa-ign-x', sourceId: 'ign', sourceName: 'IGN' },
      { briefId: '20260809-02-bbbbbb-arxiv-y', sourceId: 'arxiv', sourceName: 'arXiv' },
    ],
    body: '正文内容',
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-story-'));
  storiesDir = path.join(tmpRoot, 'stories');
  invalidDir = path.join(tmpRoot, '_invalid');
  repo = new StoryRepo(storiesDir, invalidDir, log);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('StoryRepo.create', () => {
  it('按日期子目录 + {YYYYMMDD}-{seq}-{slug}.md 命名写入', () => {
    const res = repo.create(makeStoryData());
    expect(res.saved).toBe(true);

    const dateDir = '2026-08-09';
    const filePath = path.join(storiesDir, dateDir, res.filename);
    expect(fs.existsSync(filePath)).toBe(true);
    // 无 source 段，slug 取自 title
    expect(res.filename).toMatch(/^20260809-01-test-story\.md$/);
  });

  it('同日期多条递增序号，独立于 briefs 计数', () => {
    const r1 = repo.create(makeStoryData({ title: { en: 'One' } }));
    const r2 = repo.create(makeStoryData({ title: { en: 'Two' } }));
    expect(r1.filename).toMatch(/-01-/);
    expect(r2.filename).toMatch(/-02-/);
  });

  it('写入的文件可被 parseFile 解析回（含 sources）', () => {
    const res = repo.create(makeStoryData());
    const filePath = path.join(storiesDir, '2026-08-09', res.filename);
    const story = repo.parseFile(filePath);
    expect(story).not.toBeNull();
    expect(story!.id).toBe(res.id);
    expect(story!.title.zh).toBe('测试展示简讯');
    expect(story!.status).toBe('raw');
    expect(story!.sources).toHaveLength(2);
    expect(story!.sources[0].sourceId).toBe('ign');
    expect(story!.sources[0].briefId).toContain('ign');
    expect(story!.body).toBe('正文内容');
  });

  it('sourceCount 由 sources.length 推导（不落盘）', () => {
    const res = repo.create(makeStoryData());
    const story = repo.getById(res.id)!;
    // sources 落盘为数组；sourceCount 派生，不写入 frontmatter
    expect(story.sources.length).toBe(2);
    const raw = fs.readFileSync(path.join(storiesDir, '2026-08-09', res.filename), 'utf8');
    expect(raw).not.toContain('sourceCount');
  });
});

describe('StoryRepo.list / getById', () => {
  it('递归读取所有展示简讯', () => {
    repo.create(makeStoryData({ title: { en: 'A' }, date: '2026-08-09T00:00:00Z' }));
    repo.create(makeStoryData({ title: { en: 'B' }, date: '2026-08-10T00:00:00Z' }));
    expect(repo.list()).toHaveLength(2);
  });

  it('getById 命中 / 未命中返回 null', () => {
    const res = repo.create(makeStoryData());
    expect(repo.getById(res.id)).not.toBeNull();
    expect(repo.getById('nope')).toBeNull();
  });
});

describe('StoryRepo.save', () => {
  it('更新 aspect / status / sources', () => {
    const res = repo.create(makeStoryData());
    const story = repo.getById(res.id)!;
    const ok = repo.save({
      ...story,
      aspect: 'topic-b',
      status: 'processed',
      sources: [...story.sources, { briefId: '20260809-03-cccccc-x', sourceId: 'tech' }],
    });
    expect(ok).toBe(true);

    const reread = repo.getById(res.id)!;
    expect(reread.aspect).toBe('topic-b');
    expect(reread.status).toBe('processed');
    expect(reread.sources).toHaveLength(3);
  });
});

describe('StoryRepo.parseFile 异常处理', () => {
  it('解析失败移入 _invalid', () => {
    const dateDir = '2026-08-09';
    fs.mkdirSync(path.join(storiesDir, dateDir), { recursive: true });
    const badFile = path.join(storiesDir, dateDir, 'broken.md');
    fs.writeFileSync(badFile, '---\nnot: valid: frontmatter\n---\nbody', 'utf8');

    const result = repo.parseFile(badFile);
    expect(result).toBeNull();
    const invalidFiles = fs.readdirSync(invalidDir);
    expect(invalidFiles.length).toBe(1);
    expect(fs.existsSync(badFile)).toBe(false);
  });
});

describe('StoryRepo.list 过滤 excluded', () => {
  it('list() 默认不返回 status=excluded/duplicate', () => {
    const r1 = repo.create(makeStoryData({ title: { en: 'Normal' } }));
    const r2 = repo.create(makeStoryData({ title: { en: 'Excluded' } }));
    const b2 = repo.getById(r2.id)!;
    repo.save({ ...b2, status: 'excluded' });
    const r3 = repo.create(makeStoryData({ title: { en: 'Dup' } }));
    const b3 = repo.getById(r3.id)!;
    repo.save({ ...b3, status: 'duplicate' });

    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(r1.id);
    expect(repo.listAll()).toHaveLength(3);
  });
});
