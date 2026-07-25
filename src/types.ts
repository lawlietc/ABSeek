// 前端共享类型定义

export interface Brief {
  id: string;
  date: string;
  source: string;
  sourceUrl: string;
  author?: string;
  image?: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  originalTitle?: string;
  originalSummary?: string;
  tags: string[];
  category: string;
  aspect: string;
  customAttrs: Record<string, string>;
  status: string;
  _filePath?: string;
}

export interface DefaultBinding {
  aspect: string;
  templateId: string;
}

export interface PreviewResult {
  html: string;
  totalPages: number;
  briefCount: number;
}

export interface ExportResult {
  success: boolean;
  files: string[];
  outputDir: string;
}

// ============ v0.8 采集配置 ============

export type SourceType = 'rss' | 'crawler-static';
export type ProxyMode = 'none' | 'system' | 'manual';

export interface ProxyConfig {
  mode: ProxyMode;
  server?: string;
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
  schedule: string;
  enabled: boolean;
  defaultTags?: string[];
  defaultCategory?: string;
  selectors?: Record<string, string>;
  request?: RequestConfig;
  runtime: SourceRuntime;
}

export interface SourcesFile {
  sources: SourceConfig[];
  global: {
    proxy: ProxyConfig;
    dedup: { primary: string; secondary: string[]; ttlDays: number };
  };
}

export interface TestConnectionResult {
  success: boolean;
  fetched: number;
  sample: { title: string; link: string; date?: string }[];
  error?: string;
}

export interface CollectResult {
  success: boolean;
  newCount: number;
  error?: string;
}
