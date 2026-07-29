import { useState, useEffect } from 'react';

interface Props {
  value: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
}

/** 获取今天的 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD 下 n 天 */
function shiftDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 快捷范围 */
type QuickRange = 'today' | '7d' | '30d' | 'all';

export default function DatePicker({ value, onChange }: Props) {
  // draft 状态：所有改动（快捷选项 + 日期输入框）都先写 draft，点"应用筛选"才提交
  const [draft, setDraft] = useState(value);
  const [activeQuick, setActiveQuick] = useState<QuickRange>('today');

  const today = todayStr();

  // 外部 value 变化时同步到 draft（例如父组件重置）
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // 根据已应用的 value 推断 active 快捷（只读，不影响 draft）
  useEffect(() => {
    if (value.start === value.end) {
      if (value.start === today) setActiveQuick('today');
      else setActiveQuick('today');
    } else if (value.start === shiftDays(today, -6) && value.end === today) {
      setActiveQuick('7d');
    } else if (value.start === shiftDays(today, -29) && value.end === today) {
      setActiveQuick('30d');
    } else if (value.start === '2000-01-01' && value.end === '2099-12-31') {
      setActiveQuick('all');
    } else {
      setActiveQuick('today'); // 自定义范围时取消快捷高亮
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.start, value.end]);

  /** 快捷选项：只更新 draft，不立即提交 */
  const pickQuick = (q: QuickRange) => {
    let next: { start: string; end: string };
    if (q === 'today') {
      next = { start: today, end: today };
    } else if (q === '7d') {
      next = { start: shiftDays(today, -6), end: today };
    } else if (q === '30d') {
      next = { start: shiftDays(today, -29), end: today };
    } else {
      // all：用极早/极晚日期表示全部
      next = { start: '2000-01-01', end: '2099-12-31' };
    }
    setDraft(next);
    setActiveQuick(q);
  };

  /** 手动改日期：只更新 draft */
  const updateStart = (newStart: string) => {
    setDraft((d) =>
      newStart > d.end ? { start: newStart, end: newStart } : { ...d, start: newStart }
    );
    setActiveQuick('today');
  };

  const updateEnd = (newEnd: string) => {
    setDraft((d) =>
      newEnd < d.start ? { start: newEnd, end: newEnd } : { ...d, end: newEnd }
    );
    setActiveQuick('today');
  };

  // draft 是否与已应用的 value 不同
  const isDirty = draft.start !== value.start || draft.end !== value.end;

  /** 点"应用筛选"才真正提交 */
  const applyFilter = () => {
    // 校验 start <= end，否则自动交换
    if (draft.start > draft.end) {
      onChange({ start: draft.end, end: draft.start });
    } else {
      onChange(draft);
    }
  };

  return (
    <div className="datepicker">
      <div className="quick-row">
        <button
          className={`chip-sm ${activeQuick === 'today' ? 'active' : ''}`}
          onClick={() => pickQuick('today')}
        >
          今天
        </button>
        <button
          className={`chip-sm ${activeQuick === '7d' ? 'active' : ''}`}
          onClick={() => pickQuick('7d')}
        >
          近7天
        </button>
        <button
          className={`chip-sm ${activeQuick === '30d' ? 'active' : ''}`}
          onClick={() => pickQuick('30d')}
        >
          近30天
        </button>
        <button
          className={`chip-sm ${activeQuick === 'all' ? 'active' : ''}`}
          onClick={() => pickQuick('all')}
        >
          全部
        </button>
      </div>
      <div className="range-row">
        <input
          type="date"
          className="date-input"
          value={draft.start}
          max={draft.end}
          onChange={(e) => updateStart(e.target.value)}
        />
        <span className="range-sep">至</span>
        <input
          type="date"
          className="date-input"
          value={draft.end}
          min={draft.start}
          onChange={(e) => updateEnd(e.target.value)}
        />
        <button
          className={`chip-sm apply-btn ${isDirty ? 'dirty' : ''}`}
          onClick={applyFilter}
          disabled={!isDirty}
        >
          应用筛选
        </button>
      </div>
    </div>
  );
}
