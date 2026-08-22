import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadProfileRules,
  isInIndustry,
  judgeAspect,
  extractTags,
  judgeImportance,
  ProfileRules,
} from '../../electron/main/rules/profileRules';

let tmpRoot: string;
let configDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abseek-rules-'));
  configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('loadProfileRules', () => {
  it('rules.json 不存在时返回默认游戏规则', () => {
    const rules = loadProfileRules(configDir);
    expect(rules.industryKeywords.length).toBeGreaterThan(100);
    expect(rules.aspectRules.aKeywords.length).toBeGreaterThan(0);
    expect(rules.aspectRules.bKeywords.length).toBeGreaterThan(0);
    expect(rules.tagRules.length).toBeGreaterThan(0);
  });

  it('读取自定义规则并合并默认字段', () => {
    fs.writeFileSync(
      path.join(configDir, 'rules.json'),
      JSON.stringify({
        industryKeywords: ['ai', 'model', 'llm'],
        aspectRules: { aKeywords: ['breakthrough'], bKeywords: ['hype'] },
        tagRules: [{ tag: '模型', keywords: ['model'] }],
      }),
      'utf8'
    );
    const rules = loadProfileRules(configDir);
    expect(rules.industryKeywords).toEqual(['ai', 'model', 'llm']);
    expect(rules.aspectRules.aKeywords).toEqual(['breakthrough']);
    expect(rules.aspectRules.bKeywords).toEqual(['hype']);
    expect(rules.tagRules).toEqual([{ tag: '模型', keywords: ['model'] }]);
    // 未提供的 importance / definition 用默认
    expect(rules.importance.high.length).toBeGreaterThan(0);
    expect(rules.aspectRules.definition).toBeTruthy();
  });

  it('rules.json 解析失败时回退默认', () => {
    fs.writeFileSync(path.join(configDir, 'rules.json'), 'bad json', 'utf8');
    const rules = loadProfileRules(configDir);
    expect(rules.industryKeywords.length).toBeGreaterThan(100);
  });
});

describe('判读函数（基于默认游戏规则）', () => {
  const rules: ProfileRules = {
    industryKeywords: ['game', 'playstation', 'steam'],
    aspectRules: { definition: '', aKeywords: ['release', 'discount'], bKeywords: ['delay', 'cancel'] },
    tagRules: [{ tag: '延期', keywords: ['delay'] }],
    importance: { high: ['goty'], medium: ['dlc'] },
    llmGuide: '',
  };

  it('isInIndustry 命中领域词返回 true', () => {
    expect(isInIndustry(rules, 'playstation 5 game release')).toBe(true);
    expect(isInIndustry(rules, 'a random tech article')).toBe(false);
  });

  it('judgeAspect 判断 A / B / 空', () => {
    expect(judgeAspect(rules, 'game release date announced')).toBe('A');
    expect(judgeAspect(rules, 'game delayed again')).toBe('B');
    expect(judgeAspect(rules, 'game something')).toBe('');
  });

  it('extractTags 提取标签', () => {
    expect(extractTags(rules, 'game delayed to next year', [])).toContain('延期');
    expect(extractTags(rules, 'nothing', [])).toEqual([]);
  });

  it('judgeImportance 评估重要性', () => {
    expect(judgeImportance(rules, 'game goty award')).toBe('high');
    expect(judgeImportance(rules, 'game dlc release')).toBe('medium');
    expect(judgeImportance(rules, 'random')).toBe('low');
  });
});
