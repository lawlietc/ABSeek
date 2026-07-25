// 统一 API 入口：浏览器直接访问 5173（无 preload）时返回空结果，避免崩溃
const raw = typeof window !== 'undefined' ? (window as any).api : undefined;

export const api = {
  brief: {
    list: () => (raw ? raw.brief.list() : Promise.resolve([])),
    get: (id: string) => (raw ? raw.brief.get(id) : Promise.resolve(null)),
    save: (brief: any) => (raw ? raw.brief.save(brief) : Promise.resolve(false)),
    // 订阅文件变化事件，返回取消订阅函数
    onChanged: (cb: () => void): (() => void) => {
      if (!raw?.brief?.onChanged) return () => {};
      return raw.brief.onChanged(cb);
    },
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
  // v0.8: 采集配置
  sources: {
    list: () => (raw ? raw.sources.list() : Promise.resolve(null)),
    save: (data: any) => (raw ? raw.sources.save(data) : Promise.resolve(false)),
    testProxy: () =>
      raw ? raw.sources.testProxy() : Promise.resolve({ success: false }),
    testSource: (source: any) =>
      raw
        ? raw.sources.testSource(source)
        : Promise.resolve({ success: false, fetched: 0, sample: [], error: 'no api' }),
    collectNow: (sourceId: string) =>
      raw
        ? raw.sources.collectNow(sourceId)
        : Promise.resolve({ success: false, newCount: 0, error: 'no api' }),
    collectAll: () => (raw ? raw.sources.collectAll() : Promise.resolve([])),
  },
};

export const hasApi = !!raw;

declare global {
  interface Window {
    api: any;
  }
}
