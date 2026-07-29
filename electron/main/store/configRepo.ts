import * as fs from 'fs';
import * as path from 'path';
import {
  AutomationConfig,
  DEFAULT_AUTOMATION_CONFIG,
} from '../automation/types';

// ============ 采集源配置 ============

export type SourceType = 'rss' | 'crawler-static';
export type ProxyMode = 'none' | 'system' | 'manual';

export interface ProxyConfig {
  mode: ProxyMode;
  server?: string; // http://127.0.0.1:7890 或 socks5://...
  bypass?: string[];
  testUrl?: string;
}

export interface RequestConfig {
  timeoutMs: number;
  retry: number;
  retryDelayMs: number;
  userAgent: string;
  useProxy: boolean;
}

export interface FieldMapping {
  title: string;
  date: string;
  summary: string;
  content?: string;
  link: string;
  author?: string;
  image?: string;
}

export interface SourceRuntime {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastCollectedCount: number;
  lastNewCount: number;
}

export interface SourceConfig {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  schedule: string; // cron 表达式
  enabled: boolean;
  fieldMapping?: FieldMapping;
  defaultTags?: string[];
  defaultCategory?: string;
  selectors?: Record<string, string>; // 静态爬虫选择器
  request?: RequestConfig;
  runtime: SourceRuntime;
}

export interface DedupConfig {
  primary: 'normalizedSourceUrl';
  secondary: string[];
  ttlDays: number;
}

export interface SourcesFile {
  sources: SourceConfig[];
  global: {
    proxy: ProxyConfig;
    dedup: DedupConfig;
  };
}

export const DEFAULT_FIELD_MAPPING: FieldMapping = {
  title: 'title',
  date: 'pubDate',
  summary: 'contentSnippet',
  content: 'content:encoded',
  link: 'link',
  author: 'creator',
  image: 'enclosure.url',
};

export const DEFAULT_REQUEST: RequestConfig = {
  timeoutMs: 15000,
  retry: 2,
  retryDelayMs: 3000,
  userAgent: 'ABSeek/1.0 (+https://github.com/abseek)',
  useProxy: false,
};

export const DEFAULT_SOURCES_FILE: SourcesFile = {
  sources: [
    {
      id: 'ign',
      name: 'IGN',
      type: 'rss',
      url: 'https://feeds.ign.com/ign/all',
      schedule: '0 8 * * *',
      enabled: true,
      fieldMapping: DEFAULT_FIELD_MAPPING,
      defaultTags: ['游戏', '海外'],
      defaultCategory: '游戏',
      request: { ...DEFAULT_REQUEST, useProxy: true },
      runtime: emptyRuntime(),
    },
    {
      id: 'eurogamer',
      name: 'Eurogamer',
      type: 'rss',
      url: 'https://www.eurogamer.net/feed',
      schedule: '0 8 * * *',
      enabled: true,
      fieldMapping: DEFAULT_FIELD_MAPPING,
      defaultTags: ['游戏', '海外'],
      defaultCategory: '游戏',
      request: { ...DEFAULT_REQUEST, useProxy: true },
      runtime: emptyRuntime(),
    },
    {
      id: 'polygon',
      name: 'Polygon',
      type: 'rss',
      url: 'https://www.polygon.com/rss/index.xml',
      schedule: '0 8 * * *',
      enabled: true,
      fieldMapping: DEFAULT_FIELD_MAPPING,
      defaultTags: ['游戏', '海外'],
      defaultCategory: '游戏',
      request: { ...DEFAULT_REQUEST, useProxy: true },
      runtime: emptyRuntime(),
    },
  ],
  global: {
    proxy: {
      mode: 'none',
      server: 'http://127.0.0.1:7890',
      bypass: ['localhost', '127.0.0.1'],
      testUrl: 'https://www.google.com/generate_204',
    },
    dedup: {
      primary: 'normalizedSourceUrl',
      secondary: ['contentHash', 'titleSimilarity'],
      ttlDays: 30,
    },
  },
};

function emptyRuntime(): SourceRuntime {
  return {
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastCollectedCount: 0,
    lastNewCount: 0,
  };
}

// ============ settings.json（customAttrSchema 等） ============

export interface CustomAttrSchemaItem {
  key: string;
  label: string;
  type: 'enum';
  values: string[];
  required: boolean;
}

export interface SettingsFile {
  customAttrSchema: CustomAttrSchemaItem[];
}

export const DEFAULT_SETTINGS: SettingsFile = {
  customAttrSchema: [
    {
      key: 'importance',
      label: '重要性',
      type: 'enum',
      values: ['high', 'medium', 'low'],
      required: false,
    },
  ],
};

// ============ 读写 ============

export function loadSources(configDir: string): SourcesFile {
  const file = path.join(configDir, 'sources.json');
  if (!fs.existsSync(file)) {
    // 首次初始化：写入默认配置
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_SOURCES_FILE, null, 2), 'utf8');
    return DEFAULT_SOURCES_FILE;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as SourcesFile;
    // 兼容性：补齐缺失的 runtime 字段
    for (const s of parsed.sources || []) {
      if (!s.runtime) s.runtime = emptyRuntime();
      if (!s.request) s.request = { ...DEFAULT_REQUEST };
      if (!s.fieldMapping) s.fieldMapping = { ...DEFAULT_FIELD_MAPPING };
    }
    if (!parsed.global) {
      parsed.global = DEFAULT_SOURCES_FILE.global;
    }
    return parsed;
  } catch (e) {
    console.warn('[configRepo] sources.json 解析失败，使用默认', e);
    return DEFAULT_SOURCES_FILE;
  }
}

export function saveSources(configDir: string, data: SourcesFile): void {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'sources.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

export function loadSettings(configDir: string): SettingsFile {
  const file = path.join(configDir, 'settings.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsFile>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(configDir: string, data: SettingsFile): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify(data, null, 2), 'utf8');
}

// ============ automation.json（v0.9 每日自动化） ============

export function loadAutomation(configDir: string): AutomationConfig {
  const file = path.join(configDir, 'automation.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_AUTOMATION_CONFIG, null, 2), 'utf8');
    return DEFAULT_AUTOMATION_CONFIG;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AutomationConfig>;
    // 合并默认值，兼容缺失字段
    return {
      ...DEFAULT_AUTOMATION_CONFIG,
      ...parsed,
      collect: { ...DEFAULT_AUTOMATION_CONFIG.collect, ...(parsed.collect || {}) },
      export: { ...DEFAULT_AUTOMATION_CONFIG.export, ...(parsed.export || {}) },
      runtime: { ...DEFAULT_AUTOMATION_CONFIG.runtime, ...(parsed.runtime || {}) },
    };
  } catch (e) {
    console.warn('[configRepo] automation.json 解析失败，使用默认', e);
    return DEFAULT_AUTOMATION_CONFIG;
  }
}

export function saveAutomation(configDir: string, data: AutomationConfig): void {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'automation.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
