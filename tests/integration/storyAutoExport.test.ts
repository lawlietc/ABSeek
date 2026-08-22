import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StoryRepo } from '../../electron/main/store/storyRepo';
import { createLogger } from '../../electron/main/logger/logger';
import {
  runStoryAutoExport,
  filterStoriesForAutoExport,
} from '../../electron/main/core/autoExport';
import { flattenStoryForLang } from '../../electron/main/core/render';
import { Story } from '../../electron/main/core/types';

// mock screenshot：避免真的调用 puppeteer，但写入文件以验证落盘
const { mockScreenshot } = vi.hoisted(() => ({ mockScreenshot: vi.fn() }));
vi.mock('../../electron/main/core/screenshot', () => ({
  screenshot: mockScreenshot,
  closeBrowser: vi.fn(),
}));

let tmpRoot: string;
let storiesDir: string;
let invalidDir: string;
let templatesDir: string;
let configDir: string;
let outputRoot: string;
let storyRepo: StoryRepo;

const log = createLogger('test', path.join(os.tmpdir(), 'abseek-test-logs'));

beforeEach(() => {
  mockScreenshot.mockReset();
  mockScreenshot.mockImplementation(async (_html: string, _config: unknown, outputPath: string) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'fake', 'utf8');
  });

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-story-exp-'));
  storiesDir = path.join(tmpRoot, 'stories');
  invalidDir = path.join(tmpRoot, '_invalid');
  templatesDir = path.join(tmpRoot, 'templates');
  configDir = path.join(tmpRoot, 'config');
  outputRoot = path.join(tmpRoot, 'output');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  storyRepo = new StoryRepo(storiesDir, invalidDir, log);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeTemplate(id: string, maxBriefs = 4) {
  const dir = path.join(templatesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      id,
      name: 'test',
      version: '1.0.0',
      layout: { aspectRatio: '9:16', width: 1080, height: 1920, scale: 2 },
      limit: { maxBriefs, overflowStrategy: 'paginate' },
      sort: [],
      output: {
        format: 'jpg',
        quality: 90,
        filename: '{{date}}-{{templateId}}-{{aspect}}-{{page}}-{{lang}}.jpg',
        lang: ['zh', 'en'],
        onMissingLang: 'fallback',
      },
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>{{#each briefs}}<h1>{{this.title}}</h1>{{/each}}</body></html>', 'utf8');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}', 'utf8');
}

function writeBindings(bindings: { aspect: string; templateId: string }[]) {
  fs.writeFileSync(path.join(configDir, 'default-bindings.json'), JSON.stringify({ bindings }), 'utf8');
}

function makeStory(overrides: Partial<Parameters<StoryRepo['create']>[0]> = {}) {
  return storyRepo.create({
    date: '2026-08-09T08:00:00.000Z',
    title: { zh: 'AI 模型发布', en: 'New AI Model Released' },
    summary: { zh: '摘要', en: 'summary' },
    aspect: 'topic-a',
    status: 'processed' as const,
    sources: [
      { briefId: '20260809-01-aaaaaa-x', sourceId: 'arxiv', sourceName: 'arXiv' },
      { briefId: '20260809-02-bbbbbb-y', sourceId: 'technews', sourceName: 'TechNews' },
    ],
    ...overrides,
  });
}

describe('filterStoriesForAutoExport', () => {
  it('按日期 + status 白名单筛选', () => {
    const s1 = { date: '2026-08-09T00:00:00Z', status: 'processed' } as Story;
    const s2 = { date: '2026-08-09T00:00:00Z', status: 'reviewed' } as Story;
    const s3 = { date: '2026-08-10T00:00:00Z', status: 'processed' } as Story;
    const s4 = { date: '2026-08-09T00:00:00Z', status: 'raw' } as Story;

    const result = filterStoriesForAutoExport([s1, s2, s3, s4], '2026-08-09', ['processed', 'reviewed']);
    expect(result.map((s) => s.id ?? '')).toHaveLength(2);
  });
});

describe('flattenStoryForLang', () => {
  it('source 取首个信源名，附 sources 列表与 sourceCount', () => {
    const res = makeStory();
    const story = storyRepo.getById(res.id)!;
    const flat = flattenStoryForLang(story, 'zh', 'fallback');
    expect(flat).not.toBeNull();
    expect(flat!.title).toBe('AI 模型发布');
    expect(flat!.source).toBe('arXiv');
    expect(flat!.sourceCount).toBe(2);
    expect(flat!.sources).toHaveLength(2);
    expect(flat!.sources![1].sourceName).toBe('TechNews');
  });
});

describe('runStoryAutoExport', () => {
  it('按 aspect 分组出图，输出文件命名正确', async () => {
    writeTemplate('template-a');
    writeBindings([{ aspect: 'topic-a', templateId: 'template-a' }]);
    makeStory();
    makeStory();

    const result = await runStoryAutoExport(
      storyRepo,
      templatesDir,
      configDir,
      outputRoot,
      { date: '2026-08-09', statusFilter: ['processed'], langs: ['zh'] },
      log
    );

    expect(result.success).toBe(true);
    // 2 条，每页 4 条 → 1 页
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe('2026-08-09-template-a-topic-a-1-zh.jpg');
    expect(fs.existsSync(path.join(outputRoot, '2026-08-09', result.files[0]))).toBe(true);
    expect(mockScreenshot).toHaveBeenCalledTimes(1);
  });

  it('无匹配展示简讯时返回 0 张图且成功', async () => {
    writeTemplate('template-a');
    writeBindings([{ aspect: 'topic-a', templateId: 'template-a' }]);
    // 状态 raw 不入 statusFilter
    makeStory({ status: 'raw' as const });

    const result = await runStoryAutoExport(
      storyRepo,
      templatesDir,
      configDir,
      outputRoot,
      { date: '2026-08-09', statusFilter: ['processed'], langs: ['zh'] },
      log
    );

    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(0);
    expect(mockScreenshot).not.toHaveBeenCalled();
  });

  it('超过每页上限时分页', async () => {
    writeTemplate('template-a', 2);
    writeBindings([{ aspect: 'topic-a', templateId: 'template-a' }]);
    for (let i = 0; i < 5; i++) makeStory({ title: { zh: `标题${i}`, en: `t${i}` } });

    const result = await runStoryAutoExport(
      storyRepo,
      templatesDir,
      configDir,
      outputRoot,
      { date: '2026-08-09', statusFilter: ['processed'], langs: ['zh'] },
      log
    );

    expect(result.success).toBe(true);
    // 5 条 / 每页 2 → 3 页
    expect(result.files).toHaveLength(3);
  });
});
