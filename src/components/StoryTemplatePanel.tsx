import { useState, useEffect } from 'react';
import { Story, DefaultBinding } from '../types';
import { api } from '../api';
import StoryTemplateCard from './StoryTemplateCard';

interface Props {
  stories: Story[];
  lang: string;
  onLangChange: (lang: string) => void;
  onExport: () => void;
  exporting: boolean;
}

export default function StoryTemplatePanel({
  stories,
  lang,
  onLangChange,
  onExport,
  exporting,
}: Props) {
  const [bindings, setBindings] = useState<DefaultBinding[]>([]);
  const [allTemplates, setAllTemplates] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [draftBindings, setDraftBindings] = useState<DefaultBinding[]>([]);
  const [savingBinding, setSavingBinding] = useState(false);
  const [bindingMsg, setBindingMsg] = useState('');

  const loadBindings = async () => {
    const list = await api.bindings.list();
    setBindings(list || []);
  };

  const loadAllTemplates = async () => {
    const list = await api.templates.listAll();
    setAllTemplates(list || []);
  };

  useEffect(() => {
    loadBindings();
    loadAllTemplates();
  }, []);

  const selectedCount = stories.length;

  const openConfig = () => {
    setDraftBindings(
      bindings.length > 0
        ? bindings.map((b) => ({ ...b }))
        : [
            { aspect: 'A', templateId: allTemplates[0] || '' },
            { aspect: 'B', templateId: allTemplates[0] || '' },
          ]
    );
    setBindingMsg('');
    setShowConfig(true);
  };

  const updateDraft = (idx: number, patch: Partial<DefaultBinding>) => {
    setDraftBindings((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b))
    );
  };

  const addDraftRow = () => {
    setDraftBindings((prev) => [
      ...prev,
      { aspect: 'A', templateId: allTemplates[0] || '' },
    ]);
  };

  const removeDraftRow = (idx: number) => {
    setDraftBindings((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveBindings = async () => {
    setSavingBinding(true);
    const ok = await api.bindings.save(draftBindings);
    setSavingBinding(false);
    if (ok) {
      setBindings(draftBindings);
      setShowConfig(false);
      setBindingMsg('');
    } else {
      setBindingMsg('保存失败，请查看日志');
    }
  };

  return (
    <div className="multi-panel">
      <div className="mp-toolbar">
        <span className="mp-info">
          已选 <strong>{selectedCount}</strong> 条
        </span>
        <div className="mp-field">
          <label>语言</label>
          <select
            className="select select-sm"
            value={lang}
            onChange={(e) => onLangChange(e.target.value)}
          >
            <option value="zh">中文</option>
            <option value="en">英文</option>
          </select>
        </div>
        <button
          className="btn-sm btn-secondary"
          onClick={openConfig}
          title="配置 aspect → 模板 绑定"
        >
          ⚙ 模板配置
        </button>
        <button
          className="btn btn-export"
          onClick={onExport}
          disabled={exporting || selectedCount === 0}
        >
          {exporting ? '导出中...' : '导出图片'}
        </button>
      </div>

      <div className="mp-cards">
        {bindings.length === 0 ? (
          <div className="empty">未配置 default-bindings，点右上"模板配置"</div>
        ) : selectedCount === 0 ? (
          <div className="empty">从左侧勾选展示简讯后，此处并排预览各模板</div>
        ) : (
          (() => {
            const hasAnyMatched = bindings.some(
              (b) => stories.filter((x) => x.aspect === b.aspect).length > 0
            );

            if (!hasAnyMatched) {
              return (
                <div className="empty">
                  <div style={{ marginBottom: 8 }}>
                    已选 {selectedCount} 条展示简讯，但都未匹配到已配置的 aspect
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                    请在简讯编辑里设置 aspect，或调整"模板配置"里的绑定
                  </div>
                </div>
              );
            }

            return bindings.map((b) => {
              const aspectStories = stories.filter((x) => x.aspect === b.aspect);
              return (
                <StoryTemplateCard
                  key={`${b.templateId}-${b.aspect}`}
                  templateId={b.templateId}
                  aspect={b.aspect}
                  stories={aspectStories}
                  lang={lang}
                />
              );
            });
          })()
        )}
      </div>

      {showConfig && <div className="drawer-mask" onClick={() => setShowConfig(false)} />}
      <div className={`drawer binding-drawer ${showConfig ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>模板配置</h3>
          <button className="icon-btn" onClick={() => setShowConfig(false)} title="关闭">
            ×
          </button>
        </div>
        <div className="drawer-body">
          <div className="binding-tip">
            为每个 aspect 配置默认使用的模板。导出时按此绑定分组出图。
          </div>
          {draftBindings.map((b, i) => (
            <div className="binding-row" key={i}>
              <div className="mp-field">
                <label>Aspect</label>
                <input
                  className="input"
                  value={b.aspect}
                  onChange={(e) => updateDraft(i, { aspect: e.target.value })}
                  placeholder="A / B / 自定义主题"
                />
              </div>
              <div className="mp-field" style={{ flex: 1 }}>
                <label>模板</label>
                <select
                  className="select select-sm"
                  value={b.templateId}
                  onChange={(e) => updateDraft(i, { templateId: e.target.value })}
                >
                  {allTemplates.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn-sm btn-danger"
                onClick={() => removeDraftRow(i)}
                title="删除"
              >
                ×
              </button>
            </div>
          ))}
          <div className="binding-actions">
            <button className="btn-sm btn-secondary" onClick={addDraftRow}>
              + 添加绑定
            </button>
            <button
              className="btn"
              onClick={saveBindings}
              disabled={savingBinding}
            >
              {savingBinding ? '保存中...' : '保存配置'}
            </button>
          </div>
          {bindingMsg && <div className="error-tip">{bindingMsg}</div>}
        </div>
      </div>
    </div>
  );
}
