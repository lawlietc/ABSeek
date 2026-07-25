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
