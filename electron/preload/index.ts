import { contextBridge, ipcRenderer } from 'electron';

const api = {
  brief: {
    list: () => ipcRenderer.invoke('brief:list'),
    get: (id: string) => ipcRenderer.invoke('brief:get', id),
    save: (brief: any) => ipcRenderer.invoke('brief:save', brief),
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
};

contextBridge.exposeInMainWorld('api', api);

export type AbseekApi = typeof api;
