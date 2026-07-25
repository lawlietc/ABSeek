import { useState, useEffect, useCallback } from 'react';
import { SourcesFile, SourceConfig, TestConnectionResult, CollectResult } from '../types';
import { api } from '../api';

const emptyRuntime = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastCollectedCount: 0,
  lastNewCount: 0,
};

function newSource(): SourceConfig {
  return {
    id: `source-${Date.now()}`,
    name: '新采集源',
    type: 'rss',
    url: '',
    schedule: '0 8 * * *',
    enabled: true,
    defaultTags: [],
    defaultCategory: '',
    request: {
      timeoutMs: 15000,
      retry: 2,
      retryDelayMs: 3000,
      userAgent: 'ABSeek/1.0',
      useProxy: false,
    },
    runtime: { ...emptyRuntime },
  };
}

export default function CollectorPanel() {
  const [data, setData] = useState<SourcesFile | null>(null);
  const [editing, setEditing] = useState<SourceConfig | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // 正在操作的 sourceId

  const load = useCallback(async () => {
    const d = await api.sources.list();
    if (d) setData(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showMsg = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 4000);
  };

  const handleSaveAll = async () => {
    if (!data) return;
    const ok = await api.sources.save(data);
    showMsg(ok ? '已保存配置（调度已重载）' : '保存失败');
    if (ok) await load();
  };

  const handleToggle = (id: string) => {
    if (!data) return;
    setData({
      ...data,
      sources: data.sources.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    });
  };

  const handleDelete = (id: string) => {
    if (!data) return;
    if (!confirm('确认删除该采集源？')) return;
    setData({ ...data, sources: data.sources.filter((s) => s.id !== id) });
  };

  const handleAdd = () => {
    if (!data) return;
    const s = newSource();
    setEditing(s);
  };

  const handleSaveEditing = () => {
    if (!editing || !data) return;
    const exists = data.sources.some((s) => s.id === editing.id);
    setData({
      ...data,
      sources: exists
        ? data.sources.map((s) => (s.id === editing.id ? editing : s))
        : [...data.sources, editing],
    });
    setEditing(null);
  };

  const handleTest = async (s: SourceConfig) => {
    setBusy(s.id);
    const r: TestConnectionResult = await api.sources.testSource(s);
    setBusy(null);
    if (r.success) {
      showMsg(`✓ ${s.name} 连接成功，抓取 ${r.fetched} 条`);
    } else {
      showMsg(`✗ ${s.name} 失败：${r.error || '未知错误'}`);
    }
  };

  const handleCollect = async (s: SourceConfig) => {
    setBusy(s.id);
    const r: CollectResult = await api.sources.collectNow(s.id);
    setBusy(null);
    if (r.success) {
      showMsg(`✓ ${s.name} 采集成功，新增 ${r.newCount} 条`);
      await load();
    } else {
      showMsg(`✗ ${s.name} 采集失败：${r.error || '未知错误'}`);
      await load();
    }
  };

  const handleCollectAll = async () => {
    if (!data) return;
    setBusy('__all__');
    const results = await api.sources.collectAll();
    setBusy(null);
    const ok = results.filter((r: any) => r.success).length;
    const total = results.length;
    const newCount = results.reduce((sum: number, r: any) => sum + (r.newCount || 0), 0);
    showMsg(`采集完成：${ok}/${total} 成功，共新增 ${newCount} 条`);
    await load();
  };

  const handleTestProxy = async () => {
    setBusy('__proxy__');
    const r: any = await api.sources.testProxy();
    setBusy(null);
    showMsg(r.success ? '✓ 代理连通' : '✗ 代理不可达');
  };

  const handleProxyModeChange = (mode: 'none' | 'system' | 'manual') => {
    if (!data) return;
    setData({
      ...data,
      global: { ...data.global, proxy: { ...data.global.proxy, mode } },
    });
  };

  if (!data) return <div className="collector-panel">加载中...</div>;

  return (
    <div className="collector-panel">
      <header className="cp-header">
        <h2>采集配置</h2>
        <div className="cp-actions">
          <button className="btn-sm btn-secondary" onClick={handleAdd}>
            + 新增源
          </button>
          <button
            className="btn-sm btn-secondary"
            onClick={handleCollectAll}
            disabled={busy === '__all__'}
          >
            {busy === '__all__' ? '采集中...' : '立即采集全部'}
          </button>
          <button className="btn-sm btn-primary" onClick={handleSaveAll}>
            保存配置
          </button>
        </div>
      </header>

      {msg && <div className="cp-msg">{msg}</div>}

      {/* 代理配置 */}
      <section className="cp-section">
        <h3>网络代理</h3>
        <div className="cp-proxy-row">
          {(['none', 'system', 'manual'] as const).map((m) => (
            <label key={m} className="cp-radio">
              <input
                type="radio"
                checked={data.global.proxy.mode === m}
                onChange={() => handleProxyModeChange(m)}
              />
              <span>{m === 'none' ? '不使用代理' : m === 'system' ? '系统代理' : '手动配置'}</span>
            </label>
          ))}
          {data.global.proxy.mode === 'manual' && (
            <input
              className="cp-input cp-proxy-server"
              value={data.global.proxy.server || ''}
              onChange={(e) =>
                setData({
                  ...data,
                  global: {
                    ...data.global,
                    proxy: { ...data.global.proxy, server: e.target.value },
                  },
                })
              }
              placeholder="http://127.0.0.1:7890"
            />
          )}
          <button
            className="btn-sm btn-secondary"
            onClick={handleTestProxy}
            disabled={busy === '__proxy__'}
          >
            {busy === '__proxy__' ? '测试中...' : '测试代理'}
          </button>
        </div>
      </section>

      {/* 采集源列表 */}
      <section className="cp-section">
        <h3>采集源（{data.sources.length}）</h3>
        <div className="cp-source-list">
          {data.sources.map((s) => (
            <div key={s.id} className={`cp-source-card ${s.enabled ? '' : 'disabled'}`}>
              <div className="cp-source-head">
                <label className="cp-switch">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={() => handleToggle(s.id)}
                  />
                  <span className="cp-source-name">{s.name}</span>
                </label>
                <span className="cp-source-type">{s.type}</span>
                <span className="cp-source-schedule">⏰ {s.schedule}</span>
                <div className="cp-source-actions">
                  <button
                    className="btn-sm btn-secondary"
                    onClick={() => handleTest(s)}
                    disabled={busy === s.id}
                  >
                    测试
                  </button>
                  <button
                    className="btn-sm btn-secondary"
                    onClick={() => handleCollect(s)}
                    disabled={busy === s.id || !s.enabled}
                  >
                    {busy === s.id ? '采集中...' : '采集'}
                  </button>
                  <button className="btn-sm btn-secondary" onClick={() => setEditing(s)}>
                    编辑
                  </button>
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(s.id)}>
                    删除
                  </button>
                </div>
              </div>
              <div className="cp-source-url">{s.url}</div>
              <SourceRuntimeView runtime={s.runtime} />
            </div>
          ))}
          {data.sources.length === 0 && (
            <div className="empty">暂无采集源，点“+ 新增源”添加</div>
          )}
        </div>
      </section>

      {/* 编辑抽屉 */}
      {editing && (
        <SourceEditor
          source={editing}
          onChange={setEditing}
          onSave={handleSaveEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SourceRuntimeView({ runtime }: { runtime: SourceConfig['runtime'] }) {
  const fail = runtime.consecutiveFailures > 0;
  return (
    <div className={`cp-runtime ${fail ? 'fail' : ''}`}>
      <span>
        上次采集：{runtime.lastRunAt ? new Date(runtime.lastRunAt).toLocaleString() : '—'}
      </span>
      <span>
        拉取/新增：{runtime.lastCollectedCount}/{runtime.lastNewCount}
      </span>
      {fail && (
        <span className="cp-runtime-err" title={runtime.lastError || ''}>
          连续失败 {runtime.consecutiveFailures} 次
        </span>
      )}
      {runtime.lastError && !fail && (
        <span className="cp-runtime-err">最近错误：{runtime.lastError}</span>
      )}
    </div>
  );
}

function SourceEditor({
  source,
  onChange,
  onSave,
  onClose,
}: {
  source: SourceConfig;
  onChange: (s: SourceConfig) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<SourceConfig>) => onChange({ ...source, ...patch });
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer source-editor" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>编辑采集源</h3>
          <button className="btn-sm btn-secondary" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="drawer-body">
          <label className="cp-field">
            <span>名称</span>
            <input
              className="cp-input"
              value={source.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="cp-field">
            <span>ID</span>
            <input
              className="cp-input"
              value={source.id}
              onChange={(e) => set({ id: e.target.value })}
            />
          </label>
          <label className="cp-field">
            <span>类型</span>
            <select
              className="cp-input"
              value={source.type}
              onChange={(e) => set({ type: e.target.value as any })}
            >
              <option value="rss">RSS</option>
              <option value="crawler-static">静态爬虫</option>
            </select>
          </label>
          <label className="cp-field">
            <span>URL</span>
            <input
              className="cp-input"
              value={source.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://feeds.ign.com/ign/all"
            />
          </label>
          <label className="cp-field">
            <span>调度（cron）</span>
            <input
              className="cp-input"
              value={source.schedule}
              onChange={(e) => set({ schedule: e.target.value })}
              placeholder="0 8 * * *"
            />
          </label>
          <label className="cp-field">
            <span>默认标签（逗号分隔）</span>
            <input
              className="cp-input"
              value={(source.defaultTags || []).join(',')}
              onChange={(e) =>
                set({
                  defaultTags: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="cp-field">
            <span>默认分类</span>
            <input
              className="cp-input"
              value={source.defaultCategory || ''}
              onChange={(e) => set({ defaultCategory: e.target.value })}
            />
          </label>
          <label className="cp-field cp-checkbox">
            <input
              type="checkbox"
              checked={source.request?.useProxy ?? false}
              onChange={(e) =>
                set({
                  request: { ...source.request!, useProxy: e.target.checked },
                })
              }
            />
            <span>该源使用代理</span>
          </label>
        </div>
        <div className="drawer-foot">
          <button className="btn-sm btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn-sm btn-primary" onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
