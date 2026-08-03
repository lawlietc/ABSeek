import { Brief, BriefStatus } from '../core/types';

const VALID_STATUS: BriefStatus[] = [
  'raw',
  'processed',
  'reviewed',
  'exported',
  'archived',
  'ignored',
  'excluded',
  'duplicate',
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 简讯 schema 校验：读取后 / 写入前调用
 * 失败不崩溃，仅返回错误列表
 */
export function validateBrief(b: Partial<Brief>): ValidationResult {
  const errors: string[] = [];

  if (!b.id || typeof b.id !== 'string') {
    errors.push('id 缺失或非字符串');
  }
  if (!b.date) {
    errors.push('date 缺失');
  } else {
    const d = typeof b.date === 'string' ? new Date(b.date) : b.date;
    if (isNaN(d.getTime())) errors.push('date 非合法时间');
  }
  if (!b.source || typeof b.source !== 'string') {
    errors.push('source 缺失或非字符串');
  }

  if (b.status && !VALID_STATUS.includes(b.status)) {
    errors.push(`status 不合法：${b.status}`);
  }

  if (b.tags && !Array.isArray(b.tags)) {
    errors.push('tags 必须是数组');
  }

  if (
    b.customAttrs &&
    (typeof b.customAttrs !== 'object' || Array.isArray(b.customAttrs))
  ) {
    errors.push('customAttrs 必须是扁平对象');
  } else if (b.customAttrs) {
    for (const [k, v] of Object.entries(b.customAttrs)) {
      if (typeof v !== 'string') {
        errors.push(`customAttrs.${k} 值必须为字符串`);
      }
    }
  }

  if (b.title && typeof b.title !== 'object') {
    errors.push('title 必须是对象（LocalizedText）');
  }
  if (b.summary && typeof b.summary !== 'object') {
    errors.push('summary 必须是对象（LocalizedText）');
  }

  return { ok: errors.length === 0, errors };
}
