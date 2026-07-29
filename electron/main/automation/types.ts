// v0.9 每日自动化配置类型

export type TaskType = 'collect' | 'export';
export type TaskStatus = 'success' | 'failed' | 'skipped' | 'running';

/** 采集任务配置 */
export interface CollectTaskConfig {
  /** cron 表达式，如 "0 8 * * *" */
  schedule: string;
  enabled: boolean;
}

/** 出图任务配置 */
export interface ExportTaskConfig {
  /** cron 表达式，如 "0 10 * * *" */
  schedule: string;
  enabled: boolean;
  /** 简讯状态白名单，默认 ["processed", "reviewed"] */
  statusFilter: string[];
  /** 出图语言列表 */
  langs: string[];
}

/** 单次任务执行记录 */
export interface TaskHistoryItem {
  /** ISO 时间 */
  at: string;
  type: TaskType;
  status: TaskStatus;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 采集条数 / 出图片数 */
  count?: number;
  error?: string;
}

export interface AutomationRuntime {
  lastCollectAt: string | null;
  lastCollectStatus: TaskStatus | null;
  lastCollectCount: number;
  lastExportAt: string | null;
  lastExportStatus: TaskStatus | null;
  lastExportCount: number;
  lastError: string | null;
  /** 历史记录，最多保留 50 条 */
  history: TaskHistoryItem[];
}

export interface AutomationConfig {
  enabled: boolean;
  collect: CollectTaskConfig;
  export: ExportTaskConfig;
  runtime: AutomationRuntime;
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  enabled: false,
  collect: {
    schedule: '0 8 * * *',
    enabled: true,
  },
  export: {
    schedule: '0 10 * * *',
    enabled: true,
    statusFilter: ['processed', 'reviewed'],
    langs: ['zh'],
  },
  runtime: {
    lastCollectAt: null,
    lastCollectStatus: null,
    lastCollectCount: 0,
    lastExportAt: null,
    lastExportStatus: null,
    lastExportCount: 0,
    lastError: null,
    history: [],
  },
};

export interface TaskRunResult {
  status: TaskStatus;
  count: number;
  error?: string;
  durationMs: number;
}
