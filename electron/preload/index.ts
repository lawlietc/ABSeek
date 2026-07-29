import { contextBridge, ipcRenderer } from 'electron';

const api = {
  brief: {
    list: (includeExcluded?: boolean) =>
      ipcRenderer.invoke('brief:list', includeExcluded),
    get: (id: string) => ipcRenderer.invoke('brief:get', id),
    save: (brief: any) => ipcRenderer.invoke('brief:save', brief),
    // 监听文件变化事件（外部 agent 改动 → 增量刷新）
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('brief:changed', handler);
      return () => ipcRenderer.removeListener('brief:changed', handler);
    },
  },
  template: {
    list: () => ipcRenderer.invoke('template:list'),
    previewHtml: (args: {
      templateId: string;
      briefIds: string[];
      lang: string;
      page?: number;
    }) => ipcRenderer.invoke('template:previewHtml', args),
  },
  playlist: {
    list: () => ipcRenderer.invoke('playlist:list'),
    render: (id: string) => ipcRenderer.invoke('playlist:render', id),
  },
  bindings: {
    list: () => ipcRenderer.invoke('bindings:list'),
    save: (bindings: { aspect: string; templateId: string }[]) =>
      ipcRenderer.invoke('bindings:save', bindings),
  },
  templates: {
    listAll: () => ipcRenderer.invoke('templates:listAll'),
  },
  export: {
    current: (args: { briefIds: string[]; lang: string }) =>
      ipcRenderer.invoke('export:current', args),
  },
  app: {
    getOutputDir: () => ipcRenderer.invoke('app:getOutputDir'),
  },
  // v0.8: 采集配置
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    save: (data: any) => ipcRenderer.invoke('sources:save', data),
    testProxy: () => ipcRenderer.invoke('proxy:test'),
    testSource: (source: any) => ipcRenderer.invoke('source:test', source),
    collectNow: (sourceId: string) => ipcRenderer.invoke('source:collectNow', sourceId),
    collectAll: () => ipcRenderer.invoke('sources:collectAll'),
  },
  // v0.9: 每日自动化
  automation: {
    get: () => ipcRenderer.invoke('automation:get'),
    save: (data: any) => ipcRenderer.invoke('automation:save', data),
    runCollectNow: () => ipcRenderer.invoke('automation:runCollectNow'),
    runExportNow: () => ipcRenderer.invoke('automation:runExportNow'),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type AbseekApi = typeof api;
