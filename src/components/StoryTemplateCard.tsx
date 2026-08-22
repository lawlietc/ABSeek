import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, PreviewResult } from '../types';
import { api } from '../api';

interface Props {
  templateId: string;
  aspect: string;
  stories: Story[];
  lang: string;
}

export default function StoryTemplateCard({ templateId, aspect, stories, lang }: Props) {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const storyIds = useMemo(() => stories.map((s) => s.id), [stories]);
  const storyIdsKey = storyIds.join(',');

  const render = useCallback(async () => {
    if (!templateId || storyIds.length === 0) {
      setResult(null);
      setTotalPages(1);
      setPage(1);
      return;
    }
    setLoading(true);
    try {
      const res = await api.template.previewStory({
        templateId,
        storyIds,
        lang,
        page,
      });
      setResult(res);
      setTotalPages(res.totalPages || 1);
      if (page > res.totalPages) setPage(Math.max(1, res.totalPages));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, storyIdsKey, lang, page]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe && result?.html) {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(result.html);
        doc.close();
      }
    }
  }, [result]);

  useEffect(() => {
    setPage(1);
  }, [storyIdsKey, lang]);

  return (
    <div className="template-card">
      <div className="tc-header">
        <span className="tc-title">{templateId}</span>
        <span className={`badge ${aspect}`}>{aspect}面</span>
        <span className="tc-count">{stories.length} 条</span>
      </div>
      <div className="tc-preview-wrap">
        {loading ? (
          <div className="tc-loading">渲染中...</div>
        ) : storyIds.length === 0 ? (
          <div className="tc-empty">该面暂无选中简讯</div>
        ) : (
          <iframe
            ref={iframeRef}
            className="tc-iframe"
            title={`${templateId}-${aspect}`}
          />
        )}
      </div>
      <div className="tc-footer">
        <span className="tc-page">
          第 {page} / {totalPages} 页
        </span>
        <div className="tc-page-ctrl">
          <button
            className="btn-sm btn-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ◀
          </button>
          <button
            className="btn-sm btn-secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}
