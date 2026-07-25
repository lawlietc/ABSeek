import { useState, useEffect, useCallback, useMemo } from 'react';
import { Brief, ExportResult } from './types';
import { api, hasApi } from './api';
import DatePicker from './components/DatePicker';
import MultiTemplatePanel from './components/MultiTemplatePanel';
import EditDrawer from './components/EditDrawer';
import CollectorPanel from './components/CollectorPanel';

type Filter = 'all' | 'A' | 'B';
type Tab = 'studio' | 'collector';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('studio');
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: todayStr(),
    end: todayStr(),
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lang, setLang] = useState('zh');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const loadList = useCallback(async () => {
    const list = await api.brief.list();
    setBriefs(list);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // 订阅文件变化事件（外部 agent 改 md 或采集入库 → 自动刷新列表）
  useEffect(() => {
    const unsub = api.brief.onChanged(() => {
      loadList();
    });
    return unsub;
  }, [loadList]);

  // 日期范围 + aspect 筛选
  const filtered = useMemo(() => {
    const startTs = new Date(dateRange.start + 'T00:00:00').getTime();
    const endTs = new Date(dateRange.end + 'T23:59:59').getTime();
    return briefs.filter((b) => {
      const ts = new Date(b.date).getTime();
      if (ts < startTs || ts > endTs) return false;
      if (filter !== 'all' && b.aspect !== filter) return false;
      return true;
    });
  }, [briefs, dateRange, filter]);

  // 选中的简讯对象
  const selectedBriefs = useMemo(
    () => selectedIds.map((id) => briefs.find((b) => b.id === id)).filter(Boolean) as Brief[],
    [selectedIds, briefs]
  );

  // 多选
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedIds(filtered.map((b) => b.id));
  const clearAll = () => setSelectedIds([]);

  // 移到模板（改 aspect）
  const moveToAspect = async (targetAspect: 'A' | 'B') => {
    const targets = selectedBriefs.filter((b) => b.aspect !== targetAspect);
    if (targets.length === 0) return;
    for (const b of targets) {
      await api.brief.save({ ...b, aspect: targetAspect });
    }
    await loadList();
  };

  // 导出
  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExporting(true);
    setExportMsg('');
    try {
      const res: ExportResult = await api.export.current({
        briefIds: selectedIds,
        lang,
      });
      if (res.success) {
        setExportMsg(`已导出 ${res.files.length} 张图到：${res.outputDir}`);
      } else {
        setExportMsg('导出失败，请查看日志');
      }
    } catch (e: any) {
      setExportMsg('导出异常：' + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <nav className="topnav">
        <button
          className={`nav-tab ${tab === 'studio' ? 'active' : ''}`}
          onClick={() => setTab('studio')}
        >
          简讯工作室
        </button>
        <button
          className={`nav-tab ${tab === 'collector' ? 'active' : ''}`}
          onClick={() => setTab('collector')}
        >
          采集配置
        </button>
      </nav>

      {tab === 'collector' ? (
        <CollectorPanel />
      ) : (
        <div className="studio-row">
          <div className="sidebar">
            <header>
              <h1>ABSeek</h1>
              <span className="header-count">{briefs.length} 条</span>
            </header>

            {!hasApi && (
              <div className="warn-banner">
                浏览器访问模式：IPC 不可用，请在 Electron 窗口内查看完整数据
              </div>
            )}

            <DatePicker value={dateRange} onChange={setDateRange} />

            <div className="filter-row">
              <button
                className={`chip ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                全部
              </button>
              <button
                className={`chip ${filter === 'A' ? 'active' : ''}`}
                onClick={() => setFilter('A')}
              >
                A 面
              </button>
          <button
            className={`chip ${filter === 'B' ? 'active' : ''}`}
            onClick={() => setFilter('B')}
          >
            B 面
          </button>
        </div>

        <div className="list-toolbar">
          <span className="list-count">
            列表 {filtered.length} · 选中 {selectedIds.length}
          </span>
          <div className="list-actions">
            <button className="btn-sm btn-secondary" onClick={selectAll}>
            全选
            </button>
            <button
              className="btn-sm btn-secondary"
              onClick={clearAll}
              disabled={selectedIds.length === 0}
            >
            清空
            </button>
          </div>
        </div>

        <div className="brief-list">
          {filtered.map((b) => {
            const checked = selectedIds.includes(b.id);
            const title = b.title.zh || b.title.en || b.id;
            return (
              <div
                key={b.id}
                className={`brief-item ${checked ? 'selected' : ''}`}
                onClick={() => toggleSelect(b.id)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="bi-checkbox"
                />
                <div className="bi-content">
                  <div className="bi-title">{title}</div>
                  <div className="bi-meta">
                    <span className={`badge ${b.aspect}`}>{b.aspect}</span>
                    <span>{b.source}</span>
                    <span>{b.date.substring(0, 10)}</span>
                  </div>
                </div>
                <button
                  className="bi-edit-btn"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(b.id);
                  }}
                >
                  ✎
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="empty">该范围暂无简讯</div>}
        </div>

        <div className="sidebar-footer">
          <button
            className="btn-sm btn-secondary"
            onClick={() => moveToAspect('A')}
            disabled={selectedBriefs.every((b) => b.aspect === 'A')}
          >
            移到 A 面
          </button>
          <button
            className="btn-sm btn-secondary"
            onClick={() => moveToAspect('B')}
            disabled={selectedBriefs.every((b) => b.aspect === 'B')}
          >
            移到 B 面
          </button>
          <button
            className="btn-sm btn-secondary"
            onClick={() => {
              if (selectedBriefs.length === 1) setEditingId(selectedBriefs[0].id);
            }}
            disabled={selectedBriefs.length !== 1}
          >
            编辑
          </button>
        </div>
      </div>

      <div className="main">
        <MultiTemplatePanel
          briefs={selectedBriefs}
          lang={lang}
          onLangChange={setLang}
          onExport={handleExport}
          exporting={exporting}
        />
        {exportMsg && <div className="export-msg">{exportMsg}</div>}
      </div>

      <EditDrawer
        briefId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={loadList}
      />
        </div>
      )}
    </div>
  );
}
