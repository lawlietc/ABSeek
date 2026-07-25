// ABSeek 共享类型定义（v0.3 验证原型 - playlist 驱动版）

/** 多语言字段（嵌套对象） */
export type LocalizedText = Record<string, string>;

/** 简讯自定义属性（扁平键值） */
export type CustomAttrs = Record<string, string>;

/** 外部 Agent 处理元信息 */
export interface AgentMeta {
  processedAt?: string;
  tool?: string;
  model?: string;
  version?: number;
  changes?: string[];
  notes?: string;
}

/** 简讯状态机 */
export type BriefStatus =
  | 'raw'
  | 'processed'
  | 'reviewed'
  | 'exported'
  | 'archived'
  | 'ignored';

/**
 * 简讯核心数据结构（对应 md frontmatter）
 * - title / summary 多语言嵌套
 * - aspect 独立顶层字段（分类属性，用于默认绑定）
 */
export interface Brief {
  id: string;
  date: string; // ISO 8601
  source: string;
  sourceUrl: string;
  author?: string;
  image?: string;
  /** 多语言标题 */
  title: LocalizedText;
  /** 多语言摘要 */
  summary: LocalizedText;
  /** 采集原文标题（溯源，单语言字符串） */
  originalTitle?: string;
  /** 采集原文摘要（溯源，单语言字符串） */
  originalSummary?: string;
  tags: string[];
  category: string;
  /** 分类属性（如 "A" / "B"），用于默认绑定到模板 */
  aspect: string;
  customAttrs: CustomAttrs;
  status: BriefStatus;
  agentMeta?: AgentMeta;
  body?: string;
}

/** 模板布局 */
export interface TemplateLayout {
  aspectRatio: string;
  width: number;
  height: number;
  scale: number;
}

/** 模板容量与超限策略 */
export interface TemplateLimit {
  maxBriefs: number;
  overflowStrategy: 'truncate' | 'paginate' | 'shrink';
}

/** 排序规则 */
export interface SortRule {
  field: string;
  order: 'asc' | 'desc';
}

/** 模板输出配置 */
export interface TemplateOutput {
  format: 'jpg' | 'png';
  quality?: number;
  filename: string;
  lang: string[];
  onMissingLang: 'fallback' | 'skip';
}

/**
 * 模板配置（纯视觉资源，不含 match）
 * aspect 与 template 的绑定关系由 default-bindings.json 和 playlist 决定
 */
export interface TemplateConfig {
  id: string;
  name: string;
  version: string;
  layout: TemplateLayout;
  limit: TemplateLimit;
  sort: SortRule[];
  output: TemplateOutput;
}

/** 默认绑定规则（default-bindings.json） */
export interface DefaultBinding {
  aspect: string;
  templateId: string;
}

/** 分页信息 */
export interface Pagination {
  page: number;
  total: number;
}

/**
 * Playlist 内的模板绑定
 * - templateId: 用哪个模板渲染
 * - forAspect: 渲染哪个 aspect 的简讯
 * - briefIds: 显式顺序的简讯 ID 列表
 */
export interface PlaylistTemplateBinding {
  templateId: string;
  forAspect: string;
  briefIds: string[];
}

/**
 * 出图方案（Playlist）
 * 承载一次出图任务的完整状态：哪些简讯、哪个模板、什么顺序、什么语言
 */
export interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  templates: PlaylistTemplateBinding[];
  output: {
    lang: string[];
    format: 'jpg' | 'png';
    quality?: number;
  };
}

/** 注入模板的数据（按 lang 预处理后的扁平结构） */
export interface TemplateData {
  briefs: TemplateBrief[];
  pagination: Pagination;
  templateId: string;
  templateName: string;
  date: string;
  lang: string;
}

/** 注入模板的简讯（已按 lang 展平） */
export interface TemplateBrief {
  id: string;
  title: string;
  summary: string;
  source: string;
  date: string;
  tags: string[];
  category: string;
  aspect: string;
  customAttrs: CustomAttrs;
  isTranslated: boolean;
}
