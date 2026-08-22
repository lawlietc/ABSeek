import { useState, useEffect, useCallback, useMemo } from 'react';
import { Story, ExportResult } from '../types';
import { api } from '../api';
import DatePicker from './DatePicker';
import StoryTemplatePanel from './StoryTemplatePanel';
import StoryEditDrawer from './StoryEditDrawer';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function StoryStudio() {
  const [stories, setStories] = useState<Story[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: todayStr(),
    end: todayStr(),
  });
  const [showExcluded, setShowExcluded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lang, setLang] = useState('zh');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const loadList = useCallback(async () => {
    const list = await api.story.list(showExcluded);
    setStories(list);
  }, [showExcluded]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const unsub = api.story.onChanged(() => loadList());
    return unsub;
  }, [loadList]);

  const filtered = useMemo(() => {
    const startTs = new Date(dateRange.start + 'T00:00:00').getTime();
    const endTs = new Date(dateRange.end + 'T23:59:59').getTime();
    return stories.filter((s) => {
      const ts = new Date(s.date).getTime();
      if (ts < startTs || ts > endTs) return false;
      return true;
    });
  }, [stories, dateRange]);

  const selectedStories = useMemo(
    () => selectedIds.map((id) => stories.find((s) => s.id === id)).filter(Boolean) as Story[],
    [selectedIds, stories]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedIds(filtered.map((s) => s.id));
  const clearAll = () => setSelectedIds([]);

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExporting(true);
    setExportMsg('');
    try {
      const res: ExportResult = await api.export.story({
        storyIds: selectedIds,
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
    <div className="studio-row">
      <div className="sidebar">
        <header>
          <h1>简讯工作室</h1>
          <span className="header-count">{stories.length} 条</span>
        </header>

        <DatePicker value={dateRange} onChange={setDateRange} />

        <label
          className="excluded-toggle"
          title="显示被排除的展示简讯"
        >
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
          />
          <span>显示已排除</span>
        </label>

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
          {filtered.map((s) => {
            const checked = selectedIds.includes(s.id);
            const title = s.title.zh || s.title.en || s.id;
            const isExcluded = s.status === 'excluded';
            return (
              <div
                key={s.id}
                className={`brief-item ${checked ? 'selected' : ''} ${isExcluded ? 'excluded' : ''}`}
                onClick={() => toggleSelect(s.id)}
              >
                <input type="checkbox" checked={checked} readOnly className="bi-checkbox" />
                <div className="bi-content">
                  <div className="bi-title">{title}</div>
                  <div className="bi-meta">
                    {s.aspect ? (
                      <span className={`badge ${s.aspect}`}>{s.aspect}</span>
                    ) : (
                      <span className="badge unassigned">未分面</span>
                    )}
                    <span>{s.sources.length ? `${s.sources.length} 信源` : '无信源'}</span>
                    <span>{s.date.substring(0, 10)}</span>
                  </div>
                </div>
                <button
                  className="bi-edit-btn"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(s.id);
                  }}
                >
                  ✎
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="empty">该范围暂无展示简讯</div>}
        </div>
      </div>

      <div className="main">
        <StoryTemplatePanel
          stories={selectedStories}
          lang={lang}
          onLangChange={setLang}
          onExport={handleExport}
          exporting={exporting}
        />
        {exportMsg && <div className="export-msg">{exportMsg}</div>}
      </div>

      <StoryEditDrawer
        storyId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={loadList}
      />
    </div>
  );
}
