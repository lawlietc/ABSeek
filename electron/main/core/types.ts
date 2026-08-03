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
}
