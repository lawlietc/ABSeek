// ABSeek 核心类型定义（与 prototype 一致，供 electron main 进程使用）

export type LocalizedText = Record<string, string>;
export type CustomAttrs = Record<string, string>;

export interface AgentMeta {
  processedAt?: string;
  tool?: string;
  model?: string;
  version?: number;
  changes?: string[];
  notes?: string;
}

export type BriefStatus =
  | 'raw'
  | 'processed'
  | 'reviewed'
  | 'exported'
  | 'archived'
  | 'ignored'
  | 'excluded'
  | 'duplicate';

export interface Brief {
  id: string;
  date: string;
  source: string;
  sourceUrl: string;
  author?: string;
  image?: string;
  title: LocalizedText;
  summary: LocalizedText;
  originalTitle?: string;
  originalSummary?: string;
  tags: string[];
  category: string;
  aspect: string;
  customAttrs: CustomAttrs;
  status: BriefStatus;
  agentMeta?: AgentMeta;
  body?: string;
  /** 原始文件路径（便于回写） */
  _filePath?: string;
}

export interface TemplateLayout {
  aspectRatio: string;
  width: number;
  height: number;
  scale: number;
}

export interface TemplateLimit {
  maxBriefs: number;
  overflowStrategy: 'truncate' | 'paginate' | 'shrink';
}

export interface SortRule {
  field: string;
  order: 'asc' | 'desc';
}

export interface TemplateOutput {
  format: 'jpg' | 'png';
  quality?: number;
  filename: string;
  lang: string[];
  onMissingLang: 'fallback' | 'skip';
}

export interface TemplateConfig {
  id: string;
  name: string;
  version: string;
  layout: TemplateLayout;
  limit: TemplateLimit;
  sort: SortRule[];
  output: TemplateOutput;
}

export interface DefaultBinding {
  aspect: string;
  templateId: string;
}

export interface Pagination {
  page: number;
  total: number;
}

export interface PlaylistTemplateBinding {
  templateId: string;
  forAspect: string;
  briefIds: string[];
}

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

export interface TemplateData {
  briefs: TemplateBrief[];
  pagination: Pagination;
  templateId: string;
  templateName: string;
  date: string;
  lang: string;
}

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
  /** 展示简讯的信源列表（可选，模板可据此展示来源网站） */
  sources?: { sourceId: string; sourceName?: string }[];
  /** 展示简讯引用的信源数量（= sources.length，可选） */
  sourceCount?: number;
}

// ============ 展示简讯（story） ============

/**
 * 展示简讯引用的一个信源条目。
 * 主关联 briefId（可溯源到具体采集简报），附 sourceId/sourceName 便于展示来源网站。
 */
export interface StorySource {
  briefId: string;
  sourceId: string;
  sourceName?: string;
}

/**
 * 展示简讯（story）：由 agent 依据信源聚合/生成，是出图的唯一数据源。
 * 与采集的信源简报（Brief）分离：brief 只作引用，story 承担展示职责。
 */
export interface Story {
  id: string;
  date: string;
  title: LocalizedText;
  summary: LocalizedText;
  tags: string[];
  category: string;
  aspect: string;
  customAttrs: CustomAttrs;
  status: BriefStatus;
  /** 关联的信源简报列表；sourceCount 由 sources.length 推导，不落盘 */
  sources: StorySource[];
  agentMeta?: AgentMeta;
  body?: string;
  /** 原始文件路径（便于回写） */
  _filePath?: string;
}
