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
import { renderHtml, flattenForLang } from './core/render';
import { loadPlaylist, listPlaylists, getOrderedBriefsForBinding } from './core/playlist';
import { screenshot, closeBrowser } from './core/screenshot';
import { createLogger } from './logger/logger';
import {
  loadSources,
  saveSources,
  SourcesFile,
  SourceConfig,
} from './store/configRepo';
import { BriefRepo } from './store/briefRepo';
import { BriefWatcher } from './store/watcher';
import { ensureAgentGuide } from './store/agentGuide';
import { Collector } from './collector/collector';
import { Scheduler } from './collector/scheduler';
import { testProxy } from './collector/proxy';

// 沙箱环境下 GPU 缓存写入失败会导致渲染进程崩溃白屏，禁用硬件规避
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

// 数据路径（开发阶段用项目根；mock 数据在 data/mock/ 下）
const ROOT = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const BRIEFS_DIR = path.join(DATA_DIR, 'briefs'); // v0.8: 真实采集数据
const INVALID_DIR = path.join(DATA_DIR, '_invalid');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const PLAYLISTS_DIR = path.join(DATA_DIR, 'mock', 'playlists'); // playlist 仍用 mock
const OUTPUT_DIR = path.join(ROOT, 'output', 'images');

const log = createLogger('app', LOGS_DIR);
const collectorLog = createLogger('collector', LOGS_DIR);
const watcherLog = createLogger('watcher', LOGS_DIR);

const briefRepo = new BriefRepo(BRIEFS_DIR, INVALID_DIR, watcherLog);
const collector = new Collector(briefRepo, collectorLog);
const scheduler = new Scheduler(collector, CONFIG_DIR, collectorLog);

let mainWindow: BrowserWindow | null = null;

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
    log.error(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    log.info('[renderer] did-finish-load');
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log.info(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
}

// ============ 文件监听（外部 agent 改动 → 通知前端） ============
const watcher = new BriefWatcher(BRIEFS_DIR, briefRepo, watcherLog, {
  onBatchChanged: () => {
    // 增量通知：前端收到后自行重新拉列表
    mainWindow?.webContents.send('brief:changed', { type: 'batch' });
  },
});

// ============ IPC ============

// 简讯列表
ipcMain.handle('brief:list', async () => {
  const briefs = briefRepo.list();
  return briefs.map((b) => ({ ...b, _filePath: undefined }));
});

// 单条简讯（带路径，供编辑保存）
ipcMain.handle('brief:get', async (_e, id: string) => {
  return briefRepo.getById(id);
});

// 保存简讯
ipcMain.handle('brief:save', async (_e, brief: any) => {
  return briefRepo.save(brief);
});

// 模板列表
ipcMain.handle('template:list', async () => {
  return listTemplates(TEMPLATES_DIR);
});

// 模板预览 HTML
ipcMain.handle(
  'template:previewHtml',
  async (
    _e,
    args: { templateId: string; briefIds: string[]; lang: string; page?: number }
  ) => {
    const { templateId, briefIds, lang, page = 1 } = args;
    const allBriefs = briefRepo.list();
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

// playlist 列表
ipcMain.handle('playlist:list', async () => {
  return listPlaylists(PLAYLISTS_DIR);
});

// 渲染 playlist 出图
ipcMain.handle('playlist:render', async (_e, playlistId: string) => {
  const pl = loadPlaylist(PLAYLISTS_DIR, playlistId);
  const allBriefs = briefRepo.list();
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
    return loadDefaultBindings(CONFIG_DIR);
  } catch (e) {
    log.warn('读取 default-bindings 失败，返回空数组', e);
    return [];
  }
});

// 保存 default-bindings
ipcMain.handle(
  'bindings:save',
  async (_e, bindings: { aspect: string; templateId: string }[]) => {
    try {
      return saveDefaultBindings(CONFIG_DIR, bindings);
    } catch (e) {
      log.error('保存 default-bindings 失败', e);
      return false;
    }
  }
);

// 列出所有可用模板 ID（供前端配置下拉用）
ipcMain.handle('templates:listAll', async () => {
  return listTemplates(TEMPLATES_DIR);
});

// 按选中简讯 + default-bindings 直接导出图片（不依赖 playlist 文件）
ipcMain.handle(
  'export:current',
  async (_e, args: { briefIds: string[]; lang: string }) => {
    const { briefIds, lang } = args;
    const allBriefs = briefRepo.list();
    const selected = briefIds
      .map((id) => allBriefs.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    const bindings = loadDefaultBindings(CONFIG_DIR);
    const exportDate = new Date().toISOString().substring(0, 10);
    // 按日期建子文件夹，避免覆盖历史导出
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

// ============ v0.8 新增 IPC：采集配置 ============

// 读取 sources.json（不存在则按默认初始化）
ipcMain.handle('sources:list', async () => {
  return loadSources(CONFIG_DIR);
});

// 保存 sources.json（全量覆盖）
ipcMain.handle('sources:save', async (_e, data: SourcesFile) => {
  try {
    saveSources(CONFIG_DIR, data);
    // 配置变更后重新加载调度任务
    scheduler.reloadAll();
    return true;
  } catch (e) {
    log.error('保存 sources.json 失败', e);
    return false;
  }
});

// 测试代理连通性
ipcMain.handle('proxy:test', async (_e) => {
  const sf = loadSources(CONFIG_DIR);
  const ok = await testProxy(sf.global.proxy);
  return { success: ok };
});

// 测试单个采集源连接（不写入正式库）
ipcMain.handle('source:test', async (_e, source: SourceConfig) => {
  const sf = loadSources(CONFIG_DIR);
  return collector.testConnection(source, sf);
});

// 立即采集单个 source（手动触发）
ipcMain.handle('source:collectNow', async (_e, sourceId: string) => {
  return scheduler.runCollect(sourceId);
});

// 立即采集所有 enabled source
ipcMain.handle('sources:collectAll', async () => {
  const sf = loadSources(CONFIG_DIR);
  const results: { sourceId: string; success: boolean; newCount: number; error?: string }[] = [];
  for (const s of sf.sources) {
    if (!s.enabled) continue;
    const r = await scheduler.runCollect(s.id);
    results.push({ sourceId: s.id, ...r });
  }
  return results;
});

app.whenReady().then(() => {
  // 启动初始化：生成 AGENT_GUIDE、首次写入默认 sources.json、启动调度与监听
  ensureAgentGuide(DATA_DIR);
  // 触发首次 sources.json 落盘（loadSources 内部会写入默认配置）
  loadSources(CONFIG_DIR);
  scheduler.start();
  watcher.start();

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  scheduler.stop();
  watcher.stop();
  closeBrowser();
  if (process.platform !== 'darwin') app.quit();
});
