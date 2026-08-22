import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  loadTemplateConfig,
  listTemplates,
  paginate,
  loadDefaultBindings,
  saveDefaultBindings,
} from './core/router';
import { renderHtml, flattenForLang, flattenStoryForLang } from './core/render';
import { loadPlaylist, listPlaylists, getOrderedBriefsForBinding } from './core/playlist';
import { screenshot, closeBrowser } from './core/screenshot';
import { createLogger } from './logger/logger';
import {
  loadSources,
  saveSources,
  loadAutomation,
  saveAutomation,
  SourcesFile,
  SourceConfig,
} from './store/configRepo';
import { BriefRepo } from './store/briefRepo';
import { StoryRepo } from './store/storyRepo';
import { BriefWatcher } from './store/watcher';
import { loadProfiles, resolveProfileDataDir, ProfileInfo } from './store/profile';
import { ensureAgentGuide } from './store/agentGuide';
import { Collector } from './collector/collector';
import { Scheduler } from './collector/scheduler';
import { testProxy } from './collector/proxy';
import { Automation } from './automation/automation';
import { AutomationConfig } from './automation/types';
import { Logger } from './logger/logger';

// 沙箱环境下 GPU 缓存写入失败会导致渲染进程崩溃白屏，禁用硬件规避
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

// 全局（跨 profile 共享）路径
const ROOT = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : process.cwd();
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const OUTPUT_DIR = path.join(ROOT, 'output', 'images');
const PROFILES_JSON = path.join(ROOT, 'data', 'profiles.json');

// ============ 当前 profile 上下文（可运行期重建） ============

interface AppContext {
  profileId: string;
  profileName: string;
  dataDir: string;
  briefsDir: string;
  storiesDir: string;
  invalidDir: string;
  logsDir: string;
  configDir: string;
  briefRepo: BriefRepo;
  storyRepo: StoryRepo;
  briefWatcher: BriefWatcher;
  storyWatcher: BriefWatcher;
  collector: Collector;
  scheduler: Scheduler;
  automation: Automation;
  log: Logger;
}

let ctx: AppContext | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * 按 profile 构建完整上下文（不启动调度/监听，仅建实例）。
 * 纯重构目标：所有 profile 相关实例都从 DATA_DIR 派生。
 */
function buildContext(profileId: string, profileName: string): AppContext {
  const dataDir = resolveProfileDataDir(ROOT, profileId);
  const briefsDir = path.join(dataDir, 'briefs');
  const storiesDir = path.join(dataDir, 'stories');
  const invalidDir = path.join(dataDir, '_invalid');
  const logsDir = path.join(dataDir, 'logs');
  const configDir = path.join(dataDir, 'config');

  const log = createLogger('app', logsDir);
  const collectorLog = createLogger('collector', logsDir);
  const watcherLog = createLogger('watcher', logsDir);
  const automationLog = createLogger('automation', logsDir);

  const briefRepo = new BriefRepo(briefsDir, invalidDir, watcherLog);
  const storyRepo = new StoryRepo(storiesDir, invalidDir, watcherLog);
  const collector = new Collector(briefRepo, collectorLog);
  const scheduler = new Scheduler(collector, configDir, collectorLog);
  const automation = new Automation(
    scheduler,
    briefRepo,
    storyRepo,
    configDir,
    TEMPLATES_DIR,
    OUTPUT_DIR,
    automationLog
  );

  const briefWatcher = new BriefWatcher(briefsDir, briefRepo, watcherLog, {
    onBatchChanged: () => {
      mainWindow?.webContents.send('brief:changed', { type: 'batch' });
    },
  });
  const storyWatcher = new BriefWatcher(storiesDir, storyRepo, watcherLog, {
    onBatchChanged: () => {
      mainWindow?.webContents.send('story:changed', { type: 'batch' });
    },
  });

  return {
    profileId,
    profileName,
    dataDir,
    briefsDir,
    storiesDir,
    invalidDir,
    logsDir,
    configDir,
    briefRepo,
    storyRepo,
    briefWatcher,
    storyWatcher,
    collector,
    scheduler,
    automation,
    log,
  };
}

function startContext(c: AppContext): void {
  c.briefWatcher.start();
  c.storyWatcher.start();
  c.scheduler.start();
  c.automation.start();
}

function stopContext(c: AppContext): void {
  c.scheduler.stop();
  c.automation.stop();
  c.briefWatcher.stop();
  c.storyWatcher.stop();
}

/**
 * 切换到指定 profile：停旧 → 建新 → 启新 → 广播。
 * 首个 profile 由 ABSEEK_PROFILE 或默认 game 决定。
 */
function activateProfile(profileId: string): AppContext {
  if (ctx) stopContext(ctx);
  const profiles = loadProfiles(PROFILES_JSON);
  const info = profiles.find((p) => p.id === profileId) || profiles[0];
  ctx = buildContext(info.id, info.name);
  // 初始化协作规范与默认配置落盘
  ensureAgentGuide(ctx.dataDir);
  loadSources(ctx.configDir);
  loadAutomation(ctx.configDir);
  startContext(ctx);
  ctx.log.info(`[profile] 已激活 ${info.id}（${info.name}）`);
  return ctx;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'ABSeek',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // dev: 加载 vite dev server；prod: 加载打包后的 html
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // dev 模式自动打开 DevTools 便于排查渲染问题
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  // 渲染进程加载事件日志
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    ctx?.log.error(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    ctx?.log.info('[renderer] did-finish-load');
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    ctx?.log.info(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
}

// ============ IPC ============
// 注意：所有 handler 都读取运行期 ctx，保证切 profile 后指向新数据层。

// ---- 简讯源数据（brief） ----

// 简讯列表
ipcMain.handle('brief:list', async (_e, includeExcluded?: boolean) => {
  const c = ctx!;
  const briefs = c.briefRepo.list(includeExcluded === true);
  return briefs.map((b) => ({ ...b, _filePath: undefined }));
});

// 单条简讯（带路径，供编辑保存）
ipcMain.handle('brief:get', async (_e, id: string) => {
  return ctx!.briefRepo.getById(id);
});

// 保存简讯
ipcMain.handle('brief:save', async (_e, brief: any) => {
  if (!brief._filePath) {
    const full = ctx!.briefRepo.getById(brief.id);
    if (full) brief._filePath = full._filePath;
  }
  return ctx!.briefRepo.save(brief);
});

// ---- 展示简讯（story） ----

ipcMain.handle('story:list', async (_e, includeExcluded?: boolean) => {
  const stories = ctx!.storyRepo.list(includeExcluded === true);
  return stories.map((s) => ({ ...s, _filePath: undefined }));
});

ipcMain.handle('story:get', async (_e, id: string) => {
  return ctx!.storyRepo.getById(id);
});

ipcMain.handle('story:save', async (_e, story: any) => {
  if (!story._filePath) {
    const full = ctx!.storyRepo.getById(story.id);
    if (full) story._filePath = full._filePath;
  }
  return ctx!.storyRepo.save(story);
});

// ---- profile ----

ipcMain.handle('profile:list', async (): Promise<ProfileInfo[]> => {
  return loadProfiles(PROFILES_JSON);
});

ipcMain.handle('profile:getCurrent', async (): Promise<ProfileInfo> => {
  return { id: ctx!.profileId, name: ctx!.profileName };
});

// 切换 profile：停旧 → 建新 → 启新 → 广播 → 返回新 profile
ipcMain.handle('profile:switch', async (_e, profileId: string): Promise<ProfileInfo> => {
  const profiles = loadProfiles(PROFILES_JSON);
  const info = profiles.find((p) => p.id === profileId) || profiles[0];
  activateProfile(info.id);
  mainWindow?.webContents.send('profile:changed', info);
  return info;
});

// ---- 模板 ----

ipcMain.handle('template:list', async () => {
  return listTemplates(TEMPLATES_DIR);
});

// 模板预览 HTML（brief 数据源）
ipcMain.handle(
  'template:previewHtml',
  async (
    _e,
    args: { templateId: string; briefIds: string[]; lang: string; page?: number }
  ) => {
    const { templateId, briefIds, lang, page = 1 } = args;
    const allBriefs = ctx!.briefRepo.list();
    const config = loadTemplateConfig(TEMPLATES_DIR, templateId);
    const briefs = briefIds
      .map((id) => allBriefs.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    const flat = briefs
      .map((b) => flattenForLang(b, lang, config.output.onMissingLang))
      .filter((x): x is NonNullable<typeof x> => !!x);

    const pages = paginate(flat, config.limit.maxBriefs);
    const pageBriefs = pages[Math.min(page - 1, pages.length - 1)] || [];
    const pagination = { page, total: pages.length };
    const exportDate = new Date().toISOString().substring(0, 10);
    const html = renderHtml(
      path.join(TEMPLATES_DIR, templateId),
      config,
      pageBriefs,
      pagination,
      exportDate,
      lang
    );
    return { html, totalPages: pages.length, briefCount: briefs.length };
  }
);

// 模板预览 HTML（story 数据源）
ipcMain.handle(
  'story:previewHtml',
  async (
    _e,
    args: { templateId: string; storyIds: string[]; lang: string; page?: number }
  ) => {
    const { templateId, storyIds, lang, page = 1 } = args;
    const allStories = ctx!.storyRepo.list();
    const config = loadTemplateConfig(TEMPLATES_DIR, templateId);
    const stories = storyIds
      .map((id) => allStories.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    const flat = stories
      .map((s) => flattenStoryForLang(s, lang, config.output.onMissingLang))
      .filter((x): x is NonNullable<typeof x> => !!x);

    const pages = paginate(flat, config.limit.maxBriefs);
    const pageBriefs = pages[Math.min(page - 1, pages.length - 1)] || [];
    const pagination = { page, total: pages.length };
    const exportDate = new Date().toISOString().substring(0, 10);
    const html = renderHtml(
      path.join(TEMPLATES_DIR, templateId),
      config,
      pageBriefs,
      pagination,
      exportDate,
      lang
    );
    return { html, totalPages: pages.length, briefCount: stories.length };
  }
);

// playlist 列表
ipcMain.handle('playlist:list', async () => {
  return listPlaylists(path.join(ctx!.dataDir, 'mock', 'playlists'));
});

// 渲染 playlist 出图
ipcMain.handle('playlist:render', async (_e, playlistId: string) => {
  const pl = loadPlaylist(path.join(ctx!.dataDir, 'mock', 'playlists'), playlistId);
  const allBriefs = ctx!.briefRepo.list();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const exportDate = new Date().toISOString().substring(0, 10);
  const files: string[] = [];

  for (const binding of pl.templates) {
    const config = loadTemplateConfig(TEMPLATES_DIR, binding.templateId);
    const ordered = getOrderedBriefsForBinding(allBriefs, binding);
    for (const lang of pl.output.lang) {
      const flat = ordered
        .map((b) => flattenForLang(b, lang, config.output.onMissingLang))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pages = paginate(flat, config.limit.maxBriefs);
      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pagination = { page, total: pages.length };
        const html = renderHtml(
          path.join(TEMPLATES_DIR, binding.templateId),
          config,
          pages[i],
          pagination,
          exportDate,
          lang
        );
        const filename = config.output.filename
          .replace('{{date}}', exportDate)
          .replace('{{templateId}}', config.id)
          .replace('{{aspect}}', binding.forAspect)
          .replace('{{page}}', String(page))
          .replace('{{lang}}', lang);
        const outPath = path.join(OUTPUT_DIR, filename);
        await screenshot(html, config, outPath);
        files.push(filename);
      }
    }
  }
  return files;
});

// 选取输出目录（后续可扩展）
ipcMain.handle('app:getOutputDir', async () => OUTPUT_DIR);

// 读取 default-bindings（aspect → templateId）
ipcMain.handle('bindings:list', async () => {
  try {
    return loadDefaultBindings(ctx!.configDir);
  } catch (e) {
    ctx?.log.warn('读取 default-bindings 失败，返回空数组', e);
    return [];
  }
});

// 保存 default-bindings
ipcMain.handle(
  'bindings:save',
  async (_e, bindings: { aspect: string; templateId: string }[]) => {
    try {
      return saveDefaultBindings(ctx!.configDir, bindings);
    } catch (e) {
      ctx?.log.error('保存 default-bindings 失败', e);
      return false;
    }
  }
);

// 列出所有可用模板 ID（供前端配置下拉用）
ipcMain.handle('templates:listAll', async () => {
  return listTemplates(TEMPLATES_DIR);
});

// 按选中简讯 + default-bindings 直接导出图片（brief 数据源）
ipcMain.handle(
  'export:current',
  async (_e, args: { briefIds: string[]; lang: string }) => {
    const { briefIds, lang } = args;
    const allBriefs = ctx!.briefRepo.list();
    const selected = briefIds
      .map((id) => allBriefs.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    const bindings = loadDefaultBindings(ctx!.configDir);
    const exportDate = new Date().toISOString().substring(0, 10);
    const datedOutputDir = path.join(OUTPUT_DIR, exportDate);
    fs.mkdirSync(datedOutputDir, { recursive: true });
    const files: string[] = [];

    for (const binding of bindings) {
      const aspectBriefs = selected.filter((b) => b.aspect === binding.aspect);
      if (aspectBriefs.length === 0) continue;

      const config = loadTemplateConfig(TEMPLATES_DIR, binding.templateId);
      const flat = aspectBriefs
        .map((b) => flattenForLang(b, lang, config.output.onMissingLang))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pages = paginate(flat, config.limit.maxBriefs);

      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pagination = { page, total: pages.length };
        const html = renderHtml(
          path.join(TEMPLATES_DIR, binding.templateId),
          config,
          pages[i],
          pagination,
          exportDate,
          lang
        );
        const filename = config.output.filename
          .replace('{{date}}', exportDate)
          .replace('{{templateId}}', config.id)
          .replace('{{aspect}}', binding.aspect)
          .replace('{{page}}', String(page))
          .replace('{{lang}}', lang);
        const outPath = path.join(datedOutputDir, filename);
        await screenshot(html, config, outPath);
        files.push(filename);
      }
    }
    return { success: true, files, outputDir: datedOutputDir };
  }
);

// 按选中展示简讯 + default-bindings 直接导出图片（story 数据源）
ipcMain.handle(
  'story:export',
  async (_e, args: { storyIds: string[]; lang: string }) => {
    const { storyIds, lang } = args;
    const allStories = ctx!.storyRepo.list();
    const selected = storyIds
      .map((id) => allStories.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    const bindings = loadDefaultBindings(ctx!.configDir);
    const exportDate = new Date().toISOString().substring(0, 10);
    const datedOutputDir = path.join(OUTPUT_DIR, exportDate);
    fs.mkdirSync(datedOutputDir, { recursive: true });
    const files: string[] = [];

    for (const binding of bindings) {
      const aspectStories = selected.filter((s) => s.aspect === binding.aspect);
      if (aspectStories.length === 0) continue;

      const config = loadTemplateConfig(TEMPLATES_DIR, binding.templateId);
      const flat = aspectStories
        .map((s) => flattenStoryForLang(s, lang, config.output.onMissingLang))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pages = paginate(flat, config.limit.maxBriefs);

      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pagination = { page, total: pages.length };
        const html = renderHtml(
          path.join(TEMPLATES_DIR, binding.templateId),
          config,
          pages[i],
          pagination,
          exportDate,
          lang
        );
        const filename = config.output.filename
          .replace('{{date}}', exportDate)
          .replace('{{templateId}}', config.id)
          .replace('{{aspect}}', binding.aspect)
          .replace('{{page}}', String(page))
          .replace('{{lang}}', lang);
        const outPath = path.join(datedOutputDir, filename);
        await screenshot(html, config, outPath);
        files.push(filename);
      }
    }
    return { success: true, files, outputDir: datedOutputDir };
  }
);

// ============ v0.8 采集配置 ============

// 读取 sources.json（不存在则按默认初始化）
ipcMain.handle('sources:list', async () => {
  return loadSources(ctx!.configDir);
});

// 保存 sources.json（全量覆盖）
ipcMain.handle('sources:save', async (_e, data: SourcesFile) => {
  try {
    saveSources(ctx!.configDir, data);
    ctx!.scheduler.reloadAll();
    return true;
  } catch (e) {
    ctx?.log.error('保存 sources.json 失败', e);
    return false;
  }
});

// 测试代理连通性
ipcMain.handle('proxy:test', async () => {
  const sf = loadSources(ctx!.configDir);
  const ok = await testProxy(sf.global.proxy);
  return { success: ok };
});

// 测试单个采集源连接（不写入正式库）
ipcMain.handle('source:test', async (_e, source: SourceConfig) => {
  const sf = loadSources(ctx!.configDir);
  return ctx!.collector.testConnection(source, sf);
});

// 立即采集单个 source（手动触发）
ipcMain.handle('source:collectNow', async (_e, sourceId: string) => {
  return ctx!.scheduler.runCollect(sourceId);
});

// 立即采集所有 enabled source
ipcMain.handle('sources:collectAll', async () => {
  const sf = loadSources(ctx!.configDir);
  const results: { sourceId: string; success: boolean; newCount: number; error?: string }[] = [];
  for (const s of sf.sources) {
    if (!s.enabled) continue;
    const r = await ctx!.scheduler.runCollect(s.id);
    results.push({ sourceId: s.id, ...r });
  }
  return results;
});

// ============ v0.9 每日自动化 ============

// 读取 automation.json
ipcMain.handle('automation:get', async () => {
  return loadAutomation(ctx!.configDir);
});

// 保存 automation.json（全量覆盖，配置变更后重新注册 cron）
ipcMain.handle('automation:save', async (_e, data: AutomationConfig) => {
  try {
    saveAutomation(ctx!.configDir, data);
    ctx!.automation.reload();
    return true;
  } catch (e) {
    ctx?.log.error('保存 automation.json 失败', e);
    return false;
  }
});

// 立即采集（强制重跑，无视"今日已成功"判定）
ipcMain.handle('automation:runCollectNow', async () => {
  return ctx!.automation.runCollectNow();
});

// 立即出图（强制重跑）
ipcMain.handle('automation:runExportNow', async () => {
  return ctx!.automation.runExportNow();
});

app.whenReady().then(() => {
  // 首个 profile：ABSEEK_PROFILE 或默认 game
  const profiles = loadProfiles(PROFILES_JSON);
  const initial = profiles.find((p) => p.id === (process.env.ABSEEK_PROFILE || 'game')) || profiles[0];
  activateProfile(initial.id);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (ctx) stopContext(ctx);
  closeBrowser();
  if (process.platform !== 'darwin') app.quit();
});
