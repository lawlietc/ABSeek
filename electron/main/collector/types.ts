import { SourceConfig } from '../store/configRepo';
import { Brief } from '../core/types';

/**
 * 采集适配器拉取到的原始简讯（未经过规则引擎处理）
 */
export interface RawBrief {
  title: string;
  summary: string;
  content?: string;
  date: string; // ISO 8601
  source: string; // 来源 ID（如 ign）
  sourceName: string; // 来源显示名（如 IGN）
  sourceUrl: string;
  author?: string;
  image?: string;
  body?: string;
  tags?: string[]; // 规则引擎处理后的标签
}

export interface CollectResult {
  source: SourceConfig;
  fetched: number;
  rawBriefs: RawBrief[];
}

export interface CollectContext {
  source: SourceConfig;
  /** 拉取单条原始简讯列表 */
  fetch: () => Promise<RawBrief[]>;
}

export interface TestConnectionResult {
  success: boolean;
  fetched: number;
  sample: { title: string; link: string; date?: string }[];
  error?: string;
}

/**
 * 采集后准备写入的简讯（已应用规则引擎、已生成 id / 文件名）
 */
export interface PreparedBrief {
  brief: Brief;
  filename: string; // {seq}-{source}-{slug}-{hash6}.md
  dateDir: string; // YYYY-MM-DD
}
