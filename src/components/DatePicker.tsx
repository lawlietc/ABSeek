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
  const [activeQuick, setActiveQuick] = useState<QuickRange>('today');

  const today = todayStr();

  useEffect(() => {
    // 根据当前 value 推断 active 快捷
    if (value.start === value.end) {
      if (value.start === today) setActiveQuick('today');
      else setActiveQuick('today');
    } else if (value.start === shiftDays(today, -6) && value.end === today) {
      setActiveQuick('7d');
    } else if (value.start === shiftDays(today, -29) && value.end === today) {
      setActiveQuick('30d');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.start, value.end]);

  const applyQuick = (q: QuickRange) => {
    setActiveQuick(q);
    if (q === 'today') {
      onChange({ start: today, end: today });
    } else if (q === '7d') {
      onChange({ start: shiftDays(today, -6), end: today });
    } else if (q === '30d') {
      onChange({ start: shiftDays(today, -29), end: today });
    } else if (q === 'all') {
      // 用极早/极晚日期表示全部
      onChange({ start: '2000-01-01', end: '2099-12-31' });
    }
  };

  return (
    <div className="datepicker">
      <div className="quick-row">
        <button
          className={`chip-sm ${activeQuick === 'today' ? 'active' : ''}`}
          onClick={() => applyQuick('today')}
        >
          今天
        </button>
        <button
          className={`chip-sm ${activeQuick === '7d' ? 'active' : ''}`}
          onClick={() => applyQuick('7d')}
        >
          近7天
        </button>
        <button
          className={`chip-sm ${activeQuick === '30d' ? 'active' : ''}`}
          onClick={() => applyQuick('30d')}
        >
          近30天
        </button>
        <button
          className={`chip-sm ${activeQuick === 'all' ? 'active' : ''}`}
          onClick={() => applyQuick('all')}
        >
          全部
        </button>
      </div>
      <div className="range-row">
        <input
          type="date"
          className="date-input"
          value={value.start}
          max={value.end}
          onChange={(e) => {
            onChange({ ...value, start: e.target.value });
            setActiveQuick('today');
          }}
        />
        <span className="range-sep">至</span>
        <input
          type="date"
          className="date-input"
          value={value.end}
          min={value.start}
          onChange={(e) => {
            onChange({ ...value, end: e.target.value });
            setActiveQuick('today');
          }}
        />
      </div>
    </div>
  );
}
