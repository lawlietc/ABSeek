import { useState, useEffect } from 'react';
import { Story, StorySource, Brief } from '../types';
import { api } from '../api';

interface Props {
  storyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function StoryEditDrawer({ storyId, onClose, onSaved }: Props) {
  const [story, setStory] = useState<Story | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);
  const [error, setError] = useState('');

  // 拉取展示简讯 + 可用信源列表（供添加来源用）
  useEffect(() => {
    if (!storyId) {
      setStory(null);
      return;
    }
    setLoading(true);
    setError('');
    Promise.all([
      api.story.get(storyId),
      api.brief.list(true),
    ]).then(([s, b]) => {
      setStory(s);
      setBriefs(b || []);
      setLoading(false);
      setSavedTip(false);
    });
  }, [storyId]);

  const update = (patch: Partial<Story>) => {
    if (!story) return;
    setStory({ ...story, ...patch });
    setSavedTip(false);
  };

  const addSource = (briefId: string) => {
    if (!story || !briefId) return;
    if (story.sources.some((s) => s.briefId === briefId)) return;
    const brief = briefs.find((b) => b.id === briefId);
    const src: StorySource = {
      briefId,
      sourceId: brief?.source || briefId,
      sourceName: brief?.source || undefined,
    };
    update({ sources: [...story.sources, src] });
  };

  const removeSource = (briefId: string) => {
    if (!story) return;
    update({ sources: story.sources.filter((s) => s.briefId !== briefId) });
  };

  const save = async () => {
    if (!story) return;
    setSaving(true);
    setError('');
    const ok = await api.story.save(story);
    setSaving(false);
    if (ok) {
      setSavedTip(true);
      onSaved();
    } else {
      setError('保存失败，请查看主进程日志');
    }
  };

  const open = !!storyId;

  return (
    <>
      {open && <div className="drawer-mask" onClick={onClose} />}
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>编辑展示简讯</h3>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="drawer-body">
          {loading ? (
            <div className="empty">加载中...</div>
          ) : story ? (
            <>
              <div className="drawer-id">{story.id}</div>

              <div className="form-row">
                <label>中文标题</label>
                <input
                  className="input"
                  value={story.title.zh || ''}
                  onChange={(e) =>
                    update({ title: { ...story.title, zh: e.target.value } })
                  }
                />
              </div>
              <div className="form-row">
                <label>英文标题</label>
                <input
                  className="input"
                  value={story.title.en || ''}
                  onChange={(e) =>
                    update({ title: { ...story.title, en: e.target.value } })
                  }
                />
              </div>
              <div className="form-row">
                <label>中文摘要</label>
                <textarea
                  className="textarea"
                  value={story.summary.zh || ''}
                  onChange={(e) =>
                    update({ summary: { ...story.summary, zh: e.target.value } })
                  }
                />
              </div>
              <div className="form-row">
                <label>英文摘要</label>
                <textarea
                  className="textarea"
                  value={story.summary.en || ''}
                  onChange={(e) =>
                    update({ summary: { ...story.summary, en: e.target.value } })
                  }
                />
              </div>

              <div className="form-row">
                <label>分类 (aspect)</label>
                <input
                  className="input"
                  value={story.aspect}
                  onChange={(e) => update({ aspect: e.target.value })}
                  placeholder="A / B / 自定义主题"
                />
              </div>
              <div className="form-row">
                <label>状态 (status)</label>
                <select
                  className="select"
                  value={story.status}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  <option value="raw">raw（待处理）</option>
                  <option value="processed">processed（已处理）</option>
                  <option value="reviewed">reviewed（已审阅）</option>
                  <option value="excluded">excluded（已排除）</option>
                </select>
              </div>
              <div className="form-row">
                <label>标签（逗号分隔）</label>
                <input
                  className="input"
                  value={story.tags.join(', ')}
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
              <div className="form-row">
                <label>正文（可选）</label>
                <textarea
                  className="textarea"
                  value={story.body || ''}
                  onChange={(e) => update({ body: e.target.value })}
                />
              </div>

              {/* 信源引用管理 */}
              <div className="form-row">
                <label>信源引用（{story.sources.length}）</label>
                <div className="src-list">
                  {story.sources.map((s) => {
                    const brief = briefs.find((b) => b.id === s.briefId);
                    return (
                      <div className="src-item" key={s.briefId}>
                        <div className="src-item-info">
                          <div className="src-item-name">
                            {brief?.title?.zh || brief?.title?.en || s.sourceName || s.sourceId}
                          </div>
                          <div className="src-item-id">{s.briefId}</div>
                        </div>
                        <button
                          className="bi-edit-btn exclude-btn"
                          title="移除该信源"
                          onClick={() => removeSource(s.briefId)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {story.sources.length === 0 && (
                    <div className="src-empty">暂无信源引用</div>
                  )}
                </div>
                <div className="src-add">
                  <select
                    className="select"
                    defaultValue=""
                    onChange={(e) => {
                      addSource(e.target.value);
                      e.target.value = '';
                    }}
                  >
                    <option value="">+ 添加信源...</option>
                    {briefs
                      .filter((b) => !story.sources.some((s) => s.briefId === b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {(b.title?.zh || b.title?.en || b.id)} · {b.source}
                        </option>
                      ))}
                  </select>
                </div>
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
            <div className="empty">未找到展示简讯</div>
          )}
        </div>
      </div>
    </>
  );
}
