import { useState, useEffect } from 'react';
import { Brief } from '../types';
import { api } from '../api';

interface Props {
  briefId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditDrawer({ briefId, onClose, onSaved }: Props) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);
  const [error, setError] = useState('');

  // 拉取完整简讯（含 _filePath 用于回写）
  useEffect(() => {
    if (!briefId) {
      setBrief(null);
      return;
    }
    setLoading(true);
    setError('');
    api.brief.get(briefId).then((b: Brief | null) => {
      setBrief(b);
      setLoading(false);
      setSavedTip(false);
    });
  }, [briefId]);

  const update = (patch: Partial<Brief>) => {
    if (!brief) return;
    setBrief({ ...brief, ...patch });
    setSavedTip(false);
  };

  const save = async () => {
    if (!brief) return;
    setSaving(true);
    setError('');
    const ok = await api.brief.save(brief);
    setSaving(false);
    if (ok) {
      setSavedTip(true);
      onSaved();
    } else {
      setError('保存失败，请查看主进程日志');
    }
  };

  const open = !!briefId;

  return (
    <>
      {open && <div className="drawer-mask" onClick={onClose} />}
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>编辑简讯</h3>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="drawer-body">
          {loading ? (
            <div className="empty">加载中...</div>
          ) : brief ? (
            <>
              <div className="drawer-id">{brief.id}</div>
              <div className="form-row">
                <label>中文标题</label>
                <input
                  className="input"
                  value={brief.title.zh || ''}
                  onChange={(e) =>
                    update({ title: { ...brief.title, zh: e.target.value } })
                  }
                />
              </div>
              <div className="form-row">
                <label>英文标题</label>
                <input
                  className="input"
                  value={brief.title.en || ''}
                  onChange={(e) =>
                    update({ title: { ...brief.title, en: e.target.value } })
                  }
                />
              </div>
              <div className="form-row">
                <label>中文摘要</label>
                <textarea
                  className="textarea"
                  value={brief.summary.zh || ''}
                  onChange={(e) =>
                    update({
                      summary: { ...brief.summary, zh: e.target.value },
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label>英文摘要</label>
                <textarea
                  className="textarea"
                  value={brief.summary.en || ''}
                  onChange={(e) =>
                    update({
                      summary: { ...brief.summary, en: e.target.value },
                    })
                  }
                />
              </div>
              <div className="form-row">
                <label>分类 (aspect)</label>
                <input
                  className="input"
                  value={brief.aspect}
                  onChange={(e) => update({ aspect: e.target.value })}
                  placeholder="A / B / 自定义主题"
                />
              </div>
              <div className="form-row">
                <label>状态 (status)</label>
                <select
                  className="select"
                  value={brief.status}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  <option value="raw">raw（待处理）</option>
                  <option value="processed">processed（已处理）</option>
                  <option value="reviewed">reviewed（已审阅）</option>
                  <option value="excluded">excluded（已排除，保留用于去重）</option>
                </select>
              </div>
              <div className="form-row">
                <label>来源</label>
                <input
                  className="input"
                  value={brief.source}
                  onChange={(e) => update({ source: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>标签（逗号分隔）</label>
                <input
                  className="input"
                  value={brief.tags.join(', ')}
                  onChange={(e) =>
                    update({
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              {error && <div className="error-tip">{error}</div>}
              <div className="form-row drawer-actions">
                <button className="btn" onClick={save} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </button>
                {savedTip && <span className="saved-tip">已保存</span>}
              </div>
            </>
          ) : (
            <div className="empty">未找到简讯</div>
          )}
        </div>
      </div>
    </>
  );
}
