import * as fs from 'fs';
import * as path from 'path';

/**
 * 声明式领域规则（rules.json）。game profile 的默认规则内容与 CLI 旧硬编码保持一致，
 * 行为不变；其他 profile 可各自配置 industryKeywords / aspectRules / tagRules / importance。
 */
export interface ProfileRules {
  /** 命中任一即视为属于本领域（保留处理），否则 excluded */
  industryKeywords: string[];
  /** 双面分类：A / B（保留 A/B 语义，供通用场景；也可扩展为任意主题） */
  aspectRules: {
    /** 判定说明（供 agent / 日志引用） */
    definition: string;
    aKeywords: string[];
    bKeywords: string[];
  };
  /** 标签 → 关键词列表 */
  tagRules: { tag: string; keywords: string[] }[];
  /** 重要性评估 */
  importance: {
    high: string[];
    medium: string[];
  };
  /** 给 agent / LLM 的自然语言判断指引 */
  llmGuide: string;
}

const DEFAULT_RULES: ProfileRules = {
  industryKeywords: [
    'game', 'games', 'gaming', 'gamer', 'video game',
    'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'steam', 'valve',
    'epic games', 'sega', 'ubisoft', 'activision', 'blizzard', 'capcom',
    'square enix', 'fromsoftware', 'bandai', 'namco', 'bethesda', 'cd projekt',
    'rockstar', 'take-two', 'tencent games', 'netease', 'sony interactive',
    'microsoft gaming', 'riot games', 'bandai namco', 'konami', 'ncsoft',
    'rpg', 'fps', 'moba', 'mmo', 'jrpg', 'roguelike', 'soulslike',
    'battle royale', 'platformer', 'shooter', 'metroidvania',
    'dlc', 'expansion', 'patch', 'update', 'sequel', 'prequel', 'remake',
    'remaster', 'beta', 'demo', 'early access', 'gameplay', 'trailer',
    'reveal', 'season pass', 'battle pass', 'microtransaction', 'loot box',
    'gacha', 'free-to-play', 'f2p', 'pay-to-win',
    'release', 'launch', 'delay', 'cancel', 'shutdown', 'review', 'score',
    'rating', 'goty', 'e3', 'gamescom', 'tgs', 'summer game fest',
    'nintendo direct', 'state of play', 'xbox showcase', 'playstation showcase',
    'genshin', 'honkai', 'zelda', 'mario', 'pokemon', 'pokémon',
    'call of duty', 'fifa', 'madden', 'nba 2k', 'grand theft auto', 'gta',
    'cyberpunk', 'witcher', 'elden ring', 'dark souls', 'minecraft',
    'fortnite', 'apex', 'valorant', 'league of legends', 'csgo',
    'counter-strike', 'dota', 'overwatch', 'destiny', 'halo',
    'god of war', 'spider-man', 'batman', 'final fantasy', 'dragon quest',
    'metroid', 'kirby', 'smash bros', 'animal crossing',
  ],
  aspectRules: {
    definition: 'A=对玩家是好消息，B=对玩家是坏消息；无法判断留空',
    aKeywords: [
      'new game', 'announce', 'announced', 'reveal', 'revealed', 'unveil',
      'unveiled', 'teaser', 'teased',
      'release date', 'launch date', 'coming out', 'launching',
      'dlc', 'expansion', 'free update', 'free dlc', 'free content',
      'patch', 'content update', 'new content',
      'discount', 'sale', 'price cut', 'price drop', 'free-to-play',
      'acclaimed', 'praised', 'award', 'goty', 'high review', 'good review',
      '10/10', '9/10', 'masterpiece', 'must-play', 'game of the year',
      'best-selling', 'record sales', 'milestone',
    ],
    bKeywords: [
      'delay', 'delayed', 'postpone', 'postponed', 'push back', 'pushed back',
      'cancel', 'cancelled', 'canceled', 'abandon',
      'shutdown', 'shut down', 'server closure', 'end of life', 'discontinued',
      'price hike', 'price increase', 'price raise', 'more expensive',
      'layoff', 'layoffs', 'fired', 'sacked', 'redundancy', 'job cut',
      'review bomb', 'low review', 'bad review', 'poor review', 'panned',
      'slammed', 'criticized', 'buggy', 'broken', 'unplayable', 'worst',
      'microtransaction', 'loot box', 'pay-to-win', 'p2w', 'grindy',
      'lawsuit', 'sued', 'patent infringement', 'legal trouble',
      'delayed indefinitely', 'no longer in development',
    ],
  },
  tagRules: [
    { tag: 'DLC', keywords: ['dlc', 'expansion', 'season pass', 'battle pass'] },
    { tag: '延期', keywords: ['delay', 'delayed', 'postpone', 'push back'] },
    { tag: '取消', keywords: ['cancel', 'cancelled', 'canceled', 'abandon'] },
    { tag: '发售', keywords: ['release date', 'launch date', 'release', 'launch'] },
    { tag: '评分', keywords: ['review', 'score', 'rating', 'goty', 'metacritic'] },
    { tag: '财报', keywords: ['earnings', 'revenue', 'quarterly', 'fiscal', 'financial'] },
    { tag: '人事变动', keywords: ['layoff', 'layoffs', 'fired', 'resign', 'hire', 'ceo'] },
    { tag: '更新', keywords: ['patch', 'update', 'free update', 'content update'] },
    { tag: '诉讼', keywords: ['lawsuit', 'sued', 'patent', 'legal'] },
    { tag: '测试', keywords: ['beta', 'demo', 'early access', 'alpha', 'closed beta'] },
    { tag: '关停', keywords: ['shutdown', 'shut down', 'server closure', 'end of life'] },
  ],
  importance: {
    high: [
      'goty', 'shutdown', 'cancelled', 'delayed', 'major delay',
      'acquisition', 'announce', 'revealed', 'release date',
      'layoff', 'lawsuit', 'game of the year', 'masterpiece',
    ],
    medium: ['sequel', 'remake', 'remaster', 'new game', 'dlc', 'expansion', 'beta'],
  },
  llmGuide: '判断资讯是否属于游戏行业；非游戏 → excluded。A=对玩家是好消息，B=对玩家是坏消息，无法判断留空。',
};

/**
 * 加载某 profile 的 rules.json（位于 data/config/rules.json 或 data/profiles/<id>/config/rules.json）。
 * 不存在时返回游戏默认规则。
 */
export function loadProfileRules(configDir: string): ProfileRules {
  const file = path.join(configDir, 'rules.json');
  if (!fs.existsSync(file)) {
    return DEFAULT_RULES;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...DEFAULT_RULES,
      ...parsed,
      aspectRules: { ...DEFAULT_RULES.aspectRules, ...(parsed.aspectRules || {}) },
      importance: { ...DEFAULT_RULES.importance, ...(parsed.importance || {}) },
    };
  } catch {
    return DEFAULT_RULES;
  }
}

export function isInIndustry(rules: ProfileRules, text: string): boolean {
  return rules.industryKeywords.some((kw) => text.includes(kw));
}

export function judgeAspect(rules: ProfileRules, text: string): string {
  const { aKeywords, bKeywords } = rules.aspectRules;
  const hasB = bKeywords.some((kw) => text.includes(kw));
  const hasA = aKeywords.some((kw) => text.includes(kw));
  if (hasB && !hasA) return 'B';
  if (hasA && !hasB) return 'A';
  if (hasA && hasB) return 'B';
  return '';
}

export function extractTags(rules: ProfileRules, text: string, existingTags: string[]): string[] {
  const tags = new Set(existingTags);
  for (const { tag, keywords } of rules.tagRules) {
    if (keywords.some((kw) => text.includes(kw))) tags.add(tag);
  }
  return Array.from(tags);
}

export function judgeImportance(rules: ProfileRules, text: string): string {
  if (rules.importance.high.some((kw) => text.includes(kw))) return 'high';
  if (rules.importance.medium.some((kw) => text.includes(kw))) return 'medium';
  return 'low';
}
