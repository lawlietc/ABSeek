import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Brief, PreviewResult } from '../types';
import { api } from '../api';

interface Props {
  templateId: string;
  aspect: string;
  briefs: Brief[]; // 已按该 aspect 过滤的简讯
  lang: string;
}

export default function TemplateCard({ templateId, aspect, briefs, lang }: Props) {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 简讯 ID 列表（用 useMemo 稳定引用，避免依赖数组每次变化导致死循环）
  const briefIds = useMemo(() => briefs.map((b) => b.id), [briefs]);
  // 用于依赖比较的字符串 key
  const briefIdsKey = briefIds.join(',');

  const render = useCallback(async () => {
    if (!templateId || briefIds.length === 0) {
      setResult(null);
      setTotalPages(1);
      setPage(1);
      return;
    }
    setLoading(true);
    try {
      const res = await api.template.previewHtml({
        templateId,
        briefIds,
        lang,
        page,
      });
      setResult(res);
      setTotalPages(res.totalPages || 1);
      // 页码越界自动回正
      if (page > res.totalPages) setPage(Math.max(1, res.totalPages));
    } finally {
      setLoading(false);
    }
    // 用 briefIdsKey 字符串代替 briefIds 数组，避免依赖每次变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, briefIdsKey, lang, page]);

  useEffect(() => {
    render();
  }, [render]);

  // 把 HTML 写入 iframe
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

  // 简讯变化重置页码
  useEffect(() => {
    setPage(1);
  }, [briefIdsKey, lang]);

  return (
    <div className="template-card">
      <div className="tc-header">
        <span className="tc-title">{templateId}</span>
        <span className={`badge ${aspect}`}>{aspect}面</span>
        <span className="tc-count">{briefs.length} 条</span>
      </div>
      <div className="tc-preview-wrap">
        {loading ? (
          <div className="tc-loading">渲染中...</div>
        ) : briefIds.length === 0 ? (
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
