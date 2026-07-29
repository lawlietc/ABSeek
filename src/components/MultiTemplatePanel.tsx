import { useState, useEffect } from 'react';
import { Brief, DefaultBinding } from '../types';
import { api } from '../api';
import TemplateCard from './TemplateCard';

interface Props {
  briefs: Brief[]; // 已选中的简讯（全部 aspect）
  lang: string;
  onLangChange: (lang: string) => void;
  onExport: () => void;
  exporting: boolean;
}

export default function MultiTemplatePanel({
  briefs,
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

  const selectedCount = briefs.length;

  // 打开配置面板，复制一份 draft 供编辑
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
          <div className="empty">从左侧勾选简讯后，此处并排预览各模板</div>
        ) : (
          (() => {
            // 如果选中的简讯都没分到任何 binding 对应的 aspect，给提示
            const hasAnyMatched = bindings.some(
              (b) => briefs.filter((x) => x.aspect === b.aspect).length > 0
            );

            if (!hasAnyMatched) {
              return (
                <div className="empty">
                  <div style={{ marginBottom: 8 }}>
                    已选 {selectedCount} 条简讯，但都未分配到 A/B 面
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                    请点左侧底部的「移到 A 面」或「移到 B 面」按钮分配 aspect 后再预览
                  </div>
                </div>
              );
            }

            return bindings.map((b) => {
              const aspectBriefs = briefs.filter((x) => x.aspect === b.aspect);
              return (
                <TemplateCard
                  key={`${b.templateId}-${b.aspect}`}
                  templateId={b.templateId}
                  aspect={b.aspect}
                  briefs={aspectBriefs}
                  lang={lang}
                />
              );
            });
          })()
        )}
      </div>

      {/* 选中了未分面简讯时的顶部提示条 */}
      {selectedCount > 0 &&
        briefs.some((b) => b.aspect !== 'A' && b.aspect !== 'B') && (
          <div className="mp-unassigned-tip">
            已选 {selectedCount} 条中有{' '}
            {briefs.filter((b) => b.aspect !== 'A' && b.aspect !== 'B').length} 条未分配 aspect，
            请用底部按钮「移到 A/B 面」
          </div>
        )}

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
                <select
                  className="select select-sm"
                  value={b.aspect}
                  onChange={(e) => updateDraft(i, { aspect: e.target.value })}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
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
