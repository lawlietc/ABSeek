// 统一 API 入口：浏览器直接访问 5173（无 preload）时返回空结果，避免崩溃
const raw = typeof window !== 'undefined' ? (window as any).api : undefined;

export const api = {
  brief: {
    list: () => (raw ? raw.brief.list() : Promise.resolve([])),
    get: (id: string) => (raw ? raw.brief.get(id) : Promise.resolve(null)),
    save: (brief: any) => (raw ? raw.brief.save(brief) : Promise.resolve(false)),
  },
  template: {
    list: () => (raw ? raw.template.list() : Promise.resolve([])),
    previewHtml: (args: any) =>
      raw
        ? raw.template.previewHtml(args)
        : Promise.resolve({ html: '', totalPages: 0, briefCount: 0 }),
  },
  playlist: {
    list: () => (raw ? raw.playlist.list() : Promise.resolve([])),
    render: (id: string) => (raw ? raw.playlist.render(id) : Promise.resolve([])),
  },
  bindings: {
    list: () => (raw ? raw.bindings.list() : Promise.resolve([])),
    save: (bindings: { aspect: string; templateId: string }[]) =>
      raw ? raw.bindings.save(bindings) : Promise.resolve(false),
  },
  templates: {
    listAll: () => (raw ? raw.templates.listAll() : Promise.resolve([])),
  },
  export: {
    current: (args: { briefIds: string[]; lang: string }) =>
      raw
        ? raw.export.current(args)
        : Promise.resolve({ success: false, files: [], outputDir: '' }),
  },
  app: {
    getOutputDir: () => (raw ? raw.app.getOutputDir() : Promise.resolve('')),
  },
};

export const hasApi = !!raw;

declare global {
  interface Window {
    api: any;
  }
}
