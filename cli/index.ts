#!/usr/bin/env node
// ABSeek CLI 入口：abseek <command> [options]
// 让外部 agent 通过命令行编排 采集→处理→出图 流程
// 核心模块全部复用 electron/main 下的实现，零业务逻辑重复

import * as path from 'path';
import * as fs from 'fs';
import { BriefRepo } from '../electron/main/store/briefRepo';
import { Collector } from '../electron/main/collector/collector';
import { Scheduler } from '../electron/main/collector/scheduler';
import { detectDuplicates } from '../electron/main/collector/duplicateDetector';
import { loadSources } from '../electron/main/store/configRepo';
import { runAutoExport } from '../electron/main/core/autoExport';
import {
  loadDefaultBindings,
  loadTemplateConfig,
  paginate,
} from '../electron/main/core/router';
import { renderHtml, flattenForLang } from '../electron/main/core/render';
import { screenshot, closeBrowser } from '../electron/main/core/screenshot';
import { ensureAgentGuide } from '../electron/main/store/agentGuide';
import { createLogger } from '../electron/main/logger/logger';

// ============ 路径解析 ============

function resolvePaths(dataDirFlag?: string) {
  const ROOT = process.cwd();
  const DATA_DIR = dataDirFlag || path.join(ROOT, 'data');
  return {
    ROOT,
    DATA_DIR,
    CONFIG_DIR: path.join(DATA_DIR, 'config'),
    BRIEFS_DIR: path.join(DATA_DIR, 'briefs'),
    INVALID_DIR: path.join(DATA_DIR, '_invalid'),
    LOGS_DIR: path.join(DATA_DIR, 'logs'),
    TEMPLATES_DIR: path.join(ROOT, 'templates'),
    OUTPUT_DIR: path.join(ROOT, 'output', 'images'),
  };
}

type Paths = ReturnType<typeof resolvePaths>;

// ============ 参数解析（轻量自实现，不引入 commander） ============

interface ParsedArgs {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  /** 多值参数（如 --set 可出现多次），收集成数组 */
  multi: Record<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: '',
    positional: [],
    flags: {},
    multi: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      let k: string;
      let v: string;
      if (eqIdx >= 0) {
        // --key=value 格式
        k = key.slice(0, eqIdx);
        v = key.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          // --key value 格式
          k = key;
          v = next;
          i++;
        } else {
          // --flag（布尔）
          result.flags[key] = true;
          i++;
          continue;
        }
      }
      // 多值参数收集到 multi
      if (k in result.multi) {
        result.multi[k].push(v);
      } else if (k in result.flags && typeof result.flags[k] === 'string') {
        result.multi[k] = [result.flags[k] as string, v];
        delete result.flags[k];
      } else {
        result.flags[k] = v;
      }
      i++;
    } else {
      if (!result.command) {
        result.command = arg;
      } else if (result.command === 'brief' && !result.subcommand) {
        result.subcommand = arg;
      } else {
        result.positional.push(arg);
      }
      i++;
    }
  }

  return result;
}

function flag(args: ParsedArgs, key: string): string | undefined {
  const v = args.flags[key];
  return typeof v === 'string' ? v : undefined;
}

function flagBool(args: ParsedArgs, key: string): boolean {
  return args.flags[key] === true || args.flags[key] === 'true';
}

function multiFlag(args: ParsedArgs, key: string): string[] {
  return args.multi[key] || [];
}

// ============ Usage ============

const USAGE = `ABSeek CLI - 让外部 agent 通过命令行编排 采集→处理→出图

用法:
  abseek <command> [options]

命令:
  collect [--source <id>|--all]       采集资讯（单源或全部启用源）
  brief list [options]                列出简讯
  brief get <id> [options]            查看单条简讯
  brief save <id> --set <k=v>...      修改简讯字段
  brief process --auto                规则化批量处理 raw 简讯
  brief dedup --auto                  跨源重复检测（process 之后、export 之前）
  export [options]                    按模板出图
  bindings list                       查看 aspect→模板绑定
  guide                               打印 AGENT_GUIDE.md 路径

通用选项:
  --data-dir <path>                   指定数据目录（默认 ./data）
  --json                              输出 JSON 格式（便于 agent 解析）
  --help                              显示帮助

brief list 选项:
  --status <s>                        按状态筛选（raw/processed/reviewed/exported/excluded/duplicate）
  --date <YYYY-MM-DD>                 按日期筛选
  --format <compact>                  紧凑输出（id | status | aspect | title），默认 JSON 或人类可读

brief save 选项:
  --set <key=value>                   设置字段（可多次），支持: aspect,status,category,tags
                                      tags 用逗号分隔，如 --set tags=游戏,DLC

brief process --auto 选项:
  --dry-run                           只输出处理结果，不写回文件
  自动批量处理 raw 简讯：行业判断→翻译→分面→打标，固化逻辑无需临时脚本

brief dedup --auto 选项:
  --date <YYYY-MM-DD>                 只检测指定日期（默认全部 processed）
  --dry-run                           只输出检测结果，不写回文件
  跨源重复检测：同事件的多个简讯聚类→按来源优先级选主→其余置 duplicate

export 选项:
  --date <YYYY-MM-DD>                 指定日期（默认今天）
  --status <s,s>                      状态白名单（默认 processed,reviewed）
  --lang <l>                          输出语言（默认 zh）
  --briefIds <id,id>                  指定简讯 ID（默认按 status+date 筛选）
  --auto-date                         今天没简讯时自动回退到最近有简讯的日期

示例:
  abseek collect --all                              采集所有启用源
  abseek brief list --status raw --format compact   紧凑列出待处理简讯
  abseek brief process --auto                       批量处理 raw 简讯
  abseek brief dedup --auto --date 2026-08-01       检测指定日期跨源重复
  abseek brief list --status duplicate              查看被合并的重复简讯
  abseek brief save 20260730-01-xxx --set aspect=A  修改简讯 aspect
  abseek export --status processed --lang zh --auto-date  自动回退日期出图
`;

// ============ 命令实现 ============

/** collect [--source <id>|--all] */
async function cmdCollect(args: ParsedArgs, paths: Paths, asJson: boolean) {
  const log = createLogger('cli', paths.LOGS_DIR);
  const briefRepo = new BriefRepo(paths.BRIEFS_DIR, paths.INVALID_DIR, log);
  const collector = new Collector(briefRepo, log);
  const scheduler = new Scheduler(collector, paths.CONFIG_DIR, log);

  const sourceId = flag(args, 'source');
  const all = flagBool(args, 'all');

  if (!sourceId && !all) {
    console.error('请指定 --source <id> 或 --all');
    process.exit(1);
  }

  const results: { sourceId: string; success: boolean; newCount: number; error?: string }[] = [];

  if (sourceId) {
    const r = await scheduler.runCollect(sourceId);
    results.push({ sourceId, ...r });
  } else {
    const sf = loadSources(paths.CONFIG_DIR);
    for (const s of sf.sources) {
      if (!s.enabled) continue;
      const r = await scheduler.runCollect(s.id);
      results.push({ sourceId: s.id, ...r });
    }
  }

  const totalNew = results.reduce((sum, r) => sum + r.newCount, 0);
  const anySuccess = results.some((r) => r.success);

  if (asJson) {
    console.log(JSON.stringify({ success: anySuccess, totalNew, results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.success ? 'OK' : 'FAIL';
      console.log(`  [${mark}] ${r.sourceId}: 新增 ${r.newCount} 条${r.error ? ' (' + r.error + ')' : ''}`);
    }
    console.log(`共新增 ${totalNew} 条`);
  }
}

/** brief list / get / save */
async function cmdBrief(args: ParsedArgs, paths: Paths, asJson: boolean) {
  const log = createLogger('cli', paths.LOGS_DIR);
  const briefRepo = new BriefRepo(paths.BRIEFS_DIR, paths.INVALID_DIR, log);
  const sub = args.subcommand;

  if (sub === 'list') {
    const status = flag(args, 'status');
    const date = flag(args, 'date');
    const format = flag(args, 'format');
    // list() 默认排除 excluded/duplicate；查这些状态时用 listAll()
    const needAll = status === 'excluded' || status === 'duplicate';
    let briefs = needAll ? briefRepo.listAll() : briefRepo.list();

    if (status) {
      briefs = briefs.filter((b) => b.status === status);
    }
    if (date) {
      briefs = briefs.filter((b) => b.date?.substring(0, 10) === date);
    }

    if (asJson) {
      // JSON 输出保留 _filePath，方便 agent 直接定位文件
      console.log(JSON.stringify(briefs, null, 2));
    } else if (format === 'compact') {
      // 紧凑格式：id | status | aspect | title，便于 agent 快速解析
      for (const b of briefs) {
        const title = b.title?.en || b.title?.zh || '(无标题)';
        console.log(`${b.id} | ${b.status} | ${b.aspect || '-'} | ${title}`);
      }
      console.log(`共 ${briefs.length} 条`);
    } else {
      if (briefs.length === 0) {
        console.log('（无简讯）');
        return;
      }
      for (const b of briefs) {
        const title = b.title.zh || b.title.en || Object.values(b.title)[0] || '(无标题)';
        console.log(`  ${b.id} [${b.status}] [${b.aspect || '-'}] ${title}`);
      }
      console.log(`共 ${briefs.length} 条`);
    }
    return;
  }

  if (sub === 'get') {
    const id = args.positional[0];
    if (!id) {
      console.error('用法: abseek brief get <id>');
      process.exit(1);
    }
    const brief = briefRepo.getById(id);
    if (!brief) {
      console.error(`简讯不存在: ${id}`);
      process.exit(1);
    }
    if (asJson) {
      console.log(JSON.stringify(brief, null, 2));
    } else {
      console.log(`ID:     ${brief.id}`);
      console.log(`日期:   ${brief.date}`);
      console.log(`来源:   ${brief.source}`);
      console.log(`状态:   ${brief.status}`);
      console.log(`Aspect: ${brief.aspect || '(未分面)'}`);
      console.log(`分类:   ${brief.category}`);
      console.log(`标签:   ${brief.tags.join(', ')}`);
      const titleZh = brief.title.zh;
      const titleEn = brief.title.en;
      if (titleZh) console.log(`标题(zh): ${titleZh}`);
      if (titleEn) console.log(`标题(en): ${titleEn}`);
      const sumZh = brief.summary.zh;
      const sumEn = brief.summary.en;
      if (sumZh) console.log(`摘要(zh): ${sumZh}`);
      if (sumEn) console.log(`摘要(en): ${sumEn}`);
      if (brief._filePath) console.log(`文件:   ${brief._filePath}`);
    }
    return;
  }

  if (sub === 'save') {
    const id = args.positional[0];
    if (!id) {
      console.error('用法: abseek brief save <id> --set <key=value>...');
      process.exit(1);
    }
    const sets = multiFlag(args, 'set');
    if (sets.length === 0) {
      console.error('请至少指定一个 --set <key=value>');
      process.exit(1);
    }

    const brief = briefRepo.getById(id);
    if (!brief) {
      console.error(`简讯不存在: ${id}`);
      process.exit(1);
    }

    const update: Record<string, unknown> = { id, _filePath: brief._filePath };
    for (const s of sets) {
      const eqIdx = s.indexOf('=');
      if (eqIdx < 0) {
        console.error(`--set 格式错误（应为 key=value）: ${s}`);
        process.exit(1);
      }
      const key = s.slice(0, eqIdx);
      const value = s.slice(eqIdx + 1);
      if (key === 'tags') {
        update.tags = value.split(',').map((t) => t.trim()).filter(Boolean);
      } else if (['aspect', 'status', 'category'].includes(key)) {
        update[key] = value;
      } else {
        console.error(`不支持的字段: ${key}（支持: aspect, status, category, tags）`);
        process.exit(1);
      }
    }

    const ok = briefRepo.save(update as any);
    if (asJson) {
      console.log(JSON.stringify({ success: ok, id, updated: update }, null, 2));
    } else {
      console.log(ok ? `已保存 ${id}` : `保存失败 ${id}`);
    }
    return;
  }

  if (sub === 'process') {
    const auto = flagBool(args, 'auto');
    const dryRun = flagBool(args, 'dry-run');
    if (!auto) {
      console.error('目前只支持 --auto 模式: abseek brief process --auto');
      process.exit(1);
    }
    const result = cmdBriefProcessAuto(briefRepo, dryRun);
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`处理: 成功${result.success}(A${result.aCount}/B${result.bCount}/空${result.noAspect}) 排除${result.excluded} 失败${result.fail}`);
      for (const item of result.items) {
        console.log(`  ${item.id}: ${item.action} aspect=${item.aspect || '空'}`);
      }
    }
    return;
  }

  if (sub === 'dedup') {
    const auto = flagBool(args, 'auto');
    const dryRun = flagBool(args, 'dry-run');
    const date = flag(args, 'date');
    if (!auto) {
      console.error('目前只支持 --auto 模式: abseek brief dedup --auto [--date YYYY-MM-DD] [--dry-run]');
      process.exit(1);
    }
    const sf = loadSources(paths.CONFIG_DIR);
    const result = await detectDuplicates(briefRepo, sf.sources, date, dryRun, log);
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`跨源去重: 检测 ${result.total} 条 / ${result.clusters} 个重复聚类 / 标记 ${result.duplicates} 条 duplicate${dryRun ? ' (dry-run)' : ''}`);
      for (const d of result.details) {
        console.log(`  主=${d.primaryId}(${d.primarySource}) 合并 ${d.duplicateIds.length} 条  "${d.title.slice(0, 40)}"`);
        for (const dupId of d.duplicateIds) {
          console.log(`    └ ${dupId}`);
        }
      }
    }
    return;
  }

  console.error(`未知子命令: brief ${sub}`);
  console.log(USAGE);
  process.exit(1);
}

// ============ brief process --auto 规则化批处理 ============

interface BriefProcessResult {
  success: number;
  excluded: number;
  fail: number;
  aCount: number;
  bCount: number;
  noAspect: number;
  items: { id: string; action: string; aspect: string }[];
}

// 游戏行业相关词：命中任一即视为游戏行业（保留处理）
const GAMING_KEYWORDS = [
  // 通用
  'game', 'games', 'gaming', 'gamer', 'video game',
  // 平台 / 厂商
  'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'steam', 'valve',
  'epic games', 'sega', 'ubisoft', 'activision', 'blizzard', 'capcom',
  'square enix', 'fromsoftware', 'bandai', 'namco', 'bethesda', 'cd projekt',
  'rockstar', 'take-two', 'tencent games', 'netease', 'sony interactive',
  'microsoft gaming', 'riot games', 'bandai namco', 'konami', 'ncsoft',
  // 类型
  'rpg', 'fps', 'moba', 'mmo', 'jrpg', 'roguelike', 'soulslike',
  'battle royale', 'platformer', 'shooter', 'metroidvania',
  // 内容 / 形态
  'dlc', 'expansion', 'patch', 'update', 'sequel', 'prequel', 'remake',
  'remaster', 'beta', 'demo', 'early access', 'gameplay', 'trailer',
  'reveal', 'season pass', 'battle pass', 'microtransaction', 'loot box',
  'gacha', 'free-to-play', 'f2p', 'pay-to-win',
  // 事件
  'release', 'launch', 'delay', 'cancel', 'shutdown', 'review', 'score',
  'rating', 'goty', 'e3', 'gamescom', 'tgs', 'summer game fest',
  'nintendo direct', 'state of play', 'xbox showcase', 'playstation showcase',
  // 知名 IP
  'genshin', 'honkai', 'zelda', 'mario', 'pokemon', 'pokémon',
  'call of duty', 'fifa', 'madden', 'nba 2k', 'grand theft auto', 'gta',
  'cyberpunk', 'witcher', 'elden ring', 'dark souls', 'minecraft',
  'fortnite', 'apex', 'valorant', 'league of legends', 'csgo',
  'counter-strike', 'dota', 'overwatch', 'destiny', 'halo',
  'god of war', 'spider-man', 'batman', 'final fantasy', 'dragon quest',
  'metroid', 'kirby', 'smash bros', 'animal crossing',
];

// B 面关键词（对玩家是坏消息）
const B_KEYWORDS = [
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
];

// A 面关键词（对玩家是好消息）
const A_KEYWORDS = [
  'new game', 'announce', 'announced', 'reveal', 'revealed', 'unveil',
  'unveiled', 'teaser', 'teased',
  'release date', 'launch date', 'coming out', 'launching',
  'dlc', 'expansion', 'free update', 'free dlc', 'free content',
  'patch', 'content update', 'new content',
  'discount', 'sale', 'price cut', 'price drop', 'free-to-play',
  'acclaimed', 'praised', 'award', 'goty', 'high review', 'good review',
  '10/10', '9/10', 'masterpiece', 'must-play', 'game of the year',
  'best-selling', 'record sales', 'milestone',
];

function isGamingRelated(text: string): boolean {
  return GAMING_KEYWORDS.some((kw) => text.includes(kw));
}

function judgeAspect(text: string): string {
  const hasB = B_KEYWORDS.some((kw) => text.includes(kw));
  const hasA = A_KEYWORDS.some((kw) => text.includes(kw));
  if (hasB && !hasA) return 'B';
  if (hasA && !hasB) return 'A';
  if (hasA && hasB) return 'B'; // 同时命中好坏词，按 B 处理（坏消息更值得关注）
  return ''; // 无法判断
}

function extractTags(text: string, existingTags: string[]): string[] {
  const tags = new Set(existingTags);
  const tagRules: [string, string[]][] = [
    ['DLC', ['dlc', 'expansion', 'season pass', 'battle pass']],
    ['延期', ['delay', 'delayed', 'postpone', 'push back']],
    ['取消', ['cancel', 'cancelled', 'canceled', 'abandon']],
    ['发售', ['release date', 'launch date', 'release', 'launch']],
    ['评分', ['review', 'score', 'rating', 'goty', 'metacritic']],
    ['财报', ['earnings', 'revenue', 'quarterly', 'fiscal', 'financial']],
    ['人事变动', ['layoff', 'layoffs', 'fired', 'resign', 'hire', 'ceo']],
    ['更新', ['patch', 'update', 'free update', 'content update']],
    ['诉讼', ['lawsuit', 'sued', 'patent', 'legal']],
    ['测试', ['beta', 'demo', 'early access', 'alpha', 'closed beta']],
    ['关停', ['shutdown', 'shut down', 'server closure', 'end of life']],
  ];
  for (const [tag, kws] of tagRules) {
    if (kws.some((kw) => text.includes(kw))) tags.add(tag);
  }
  return Array.from(tags);
}

function judgeImportance(text: string): string {
  const highKeywords = [
    'goty', 'shutdown', 'cancelled', 'delayed', 'major delay',
    'acquisition', 'announce', 'revealed', 'release date',
    'layoff', 'lawsuit', 'game of the year', 'masterpiece',
  ];
  if (highKeywords.some((kw) => text.includes(kw))) return 'high';
  const mediumKeywords = ['sequel', 'remake', 'remaster', 'new game', 'dlc', 'expansion', 'beta'];
  if (mediumKeywords.some((kw) => text.includes(kw))) return 'medium';
  return 'low';
}

/**
 * brief process --auto：规则化批量处理 raw 简讯
 * - 行业判断：非游戏 → excluded
 * - AB 面判断（关键词规则）：能判则判，不能判留空
 * - 标签提取 / 重要性评估 / 状态流转
 * - 不做翻译（title.zh 留空，出图时 onMissingLang=fallback 用 en）
 *
 * agent 可选用此命令做"快速预处理"，后续对需要精修的简讯再用 LLM 补翻译/调整 aspect。
 */
function cmdBriefProcessAuto(briefRepo: BriefRepo, dryRun: boolean): BriefProcessResult {
  const rawBriefs = briefRepo.list().filter((b) => b.status === 'raw');
  const items: { id: string; action: string; aspect: string }[] = [];
  let success = 0;
  let excluded = 0;
  let fail = 0;
  let aCount = 0;
  let bCount = 0;
  let noAspect = 0;

  for (const brief of rawBriefs) {
    try {
      const text = [
        brief.title?.en,
        brief.summary?.en,
        brief.originalTitle,
        brief.originalSummary,
        brief.body,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      // 1. 行业判断
      if (!isGamingRelated(text)) {
        if (!dryRun) {
          briefRepo.save({
            id: brief.id,
            _filePath: brief._filePath,
            status: 'excluded',
            agentMeta: {
              processedAt: new Date().toISOString(),
              tool: 'cli-brief-process-auto',
              version: 1,
              changes: ['status'],
              notes: 'CLI 规则判断: 非游戏行业 → excluded',
            },
          });
        }
        excluded++;
        items.push({ id: brief.id, action: 'excluded', aspect: '' });
        continue;
      }

      // 2. AB 面判断 + 标签 + 重要性
      const aspect = judgeAspect(text);
      const tags = extractTags(text, brief.tags || []);
      const importance = judgeImportance(text);

      if (!dryRun) {
        briefRepo.save({
          id: brief.id,
          _filePath: brief._filePath,
          aspect,
          tags,
          customAttrs: { importance },
          status: 'processed',
          agentMeta: {
            processedAt: new Date().toISOString(),
            tool: 'cli-brief-process-auto',
            version: 1,
            changes: ['aspect', 'tags', 'customAttrs', 'status'],
            notes: `CLI 规则处理 aspect=${aspect || '空'} importance=${importance}`,
          },
        });
      }

      success++;
      if (aspect === 'A') aCount++;
      else if (aspect === 'B') bCount++;
      else noAspect++;
      items.push({ id: brief.id, action: 'processed', aspect });
    } catch {
      fail++;
      items.push({ id: brief.id, action: 'fail', aspect: '' });
    }
  }

  return { success, excluded, fail, aCount, bCount, noAspect, items };
}

/** export [--date] [--status] [--lang] [--briefIds] */
async function cmdExport(args: ParsedArgs, paths: Paths, asJson: boolean) {
  const log = createLogger('cli', paths.LOGS_DIR);
  const briefRepo = new BriefRepo(paths.BRIEFS_DIR, paths.INVALID_DIR, log);

  const date = flag(args, 'date') || new Date().toISOString().substring(0, 10);
  const lang = flag(args, 'lang') || 'zh';
  const briefIdsFlag = flag(args, 'briefIds');

  const autoDate = flagBool(args, 'auto-date');
  let result: { success: boolean; files: string[]; outputDir: string; briefCount: number; error?: string };
  let usedDate = date;

  if (briefIdsFlag) {
    // 指定 ID 模式
    const ids = briefIdsFlag.split(',').map((s) => s.trim()).filter(Boolean);
    result = await exportByIds(briefRepo, paths, ids, lang, date, log);
  } else {
    // 按 status+date 筛选模式
    const statusFlag = flag(args, 'status') || 'processed,reviewed';
    const statusFilter = statusFlag.split(',').map((s) => s.trim()).filter(Boolean);

    // --auto-date：当天没匹配简讯时，回退到最近有简讯的日期
    if (autoDate) {
      const all = briefRepo.list();
      const hasToday = all.some(
        (b) => b.date?.substring(0, 10) === date && statusFilter.includes(b.status)
      );
      if (!hasToday) {
        const dates = new Set<string>();
        for (const b of all) {
          if (statusFilter.includes(b.status) && b.date) {
            dates.add(b.date.substring(0, 10));
          }
        }
        const sorted = Array.from(dates).filter(Boolean).sort().reverse();
        if (sorted.length > 0) {
          usedDate = sorted[0];
          log.info(`[cli:export] --auto-date 回退: ${date} → ${usedDate}`);
        }
      }
    }

    result = await runAutoExport(
      briefRepo,
      paths.TEMPLATES_DIR,
      paths.CONFIG_DIR,
      paths.OUTPUT_DIR,
      { date: usedDate, statusFilter, langs: [lang] },
      log
    );
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log(`导出完成: ${result.files.length} 张图 → ${result.outputDir}`);
      for (const f of result.files) {
        console.log(`  ${f}`);
      }
    } else {
      console.error(`导出失败: ${result.error}`);
    }
  }
}

/** 按指定 ID 出图（复用渲染模块，逻辑与 index.ts export:current 一致） */
async function exportByIds(
  briefRepo: BriefRepo,
  paths: Paths,
  ids: string[],
  lang: string,
  date: string,
  log: ReturnType<typeof createLogger>
): Promise<{ success: boolean; files: string[]; outputDir: string; briefCount: number; error?: string }> {
  try {
    const allBriefs = briefRepo.list();
    const selected = ids
      .map((id) => allBriefs.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    if (selected.length === 0) {
      return { success: true, files: [], outputDir: '', briefCount: 0 };
    }

    const bindings = loadDefaultBindings(paths.CONFIG_DIR);
    const outputDir = path.join(paths.OUTPUT_DIR, date);
    fs.mkdirSync(outputDir, { recursive: true });
    const files: string[] = [];

    for (const binding of bindings) {
      const aspectBriefs = selected.filter((b) => b.aspect === binding.aspect);
      if (aspectBriefs.length === 0) continue;

      const config = loadTemplateConfig(paths.TEMPLATES_DIR, binding.templateId);
      const flat = aspectBriefs
        .map((b) => flattenForLang(b, lang, config.output.onMissingLang))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pages = paginate(flat, config.limit.maxBriefs);

      for (let i = 0; i < pages.length; i++) {
        const page = i + 1;
        const pagination = { page, total: pages.length };
        const html = renderHtml(
          path.join(paths.TEMPLATES_DIR, binding.templateId),
          config,
          pages[i],
          pagination,
          date,
          lang
        );
        const filename = config.output.filename
          .replace('{{date}}', date)
          .replace('{{templateId}}', config.id)
          .replace('{{aspect}}', binding.aspect)
          .replace('{{page}}', String(page))
          .replace('{{lang}}', lang);
        const outPath = path.join(outputDir, filename);
        await screenshot(html, config, outPath);
        files.push(filename);
      }
    }

    log.info(`[cli:export] 导出 ${files.length} 张图 → ${outputDir}`);
    return { success: true, files, outputDir, briefCount: selected.length };
  } catch (e: any) {
    log.error('[cli:export] 失败', e);
    return {
      success: false,
      files: [],
      outputDir: '',
      briefCount: 0,
      error: e?.message || String(e),
    };
  }
}

/** bindings list */
function cmdBindings(paths: Paths, asJson: boolean) {
  try {
    const bindings = loadDefaultBindings(paths.CONFIG_DIR);
    if (asJson) {
      console.log(JSON.stringify(bindings, null, 2));
    } else {
      for (const b of bindings) {
        console.log(`  aspect=${b.aspect} → template=${b.templateId}`);
      }
    }
  } catch (e) {
    console.error('读取 default-bindings.json 失败:', e);
    process.exit(1);
  }
}

/** guide — 打印 AGENT_GUIDE.md 路径，不存在则生成 */
function cmdGuide(paths: Paths) {
  ensureAgentGuide(paths.DATA_DIR);
  const guidePath = path.join(paths.DATA_DIR, 'AGENT_GUIDE.md');
  console.log(guidePath);
}

// ============ CLI 调用日志 ============

/**
 * 记录每次 CLI 调用到 data/logs/cli-runs-{date}.log
 * 格式：[ISO时间] [START|OK|FAIL] 命令 参数  exit=退出码 耗时=秒 error=错误信息
 * 出问题时可快速定位「哪个命令在什么时候跑了、成功没、多久」
 */
function logCliRun(
  logsDir: string,
  status: 'START' | 'OK' | 'FAIL',
  cmdLine: string,
  extra?: { exitCode?: number; durationMs?: number; error?: string }
) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString();
    const dateStr = ts.substring(0, 10);
    const file = path.join(logsDir, `cli-runs-${dateStr}.log`);
    const parts = [`[${ts}] [${status}] ${cmdLine}`];
    if (extra?.exitCode !== undefined) parts.push(`exit=${extra.exitCode}`);
    if (extra?.durationMs !== undefined) parts.push(`耗时=${(extra.durationMs / 1000).toFixed(1)}s`);
    if (extra?.error) parts.push(`error=${extra.error.replace(/\n/g, ' ')}`);
    fs.appendFileSync(file, parts.join('  ') + '\n', 'utf8');
  } catch {
    // 日志写入失败不影响主流程
  }
}

/** 还原命令行字符串（用于日志记录） */
function reconstructCmdLine(): string {
  const args = process.argv.slice(2);
  // 过滤敏感参数值（目前无敏感参数，保留原样）
  return `abseek ${args.join(' ')}`.trim();
}

// ============ 主入口 ============

async function main() {
  const args = parseArgs(process.argv);

  if (!args.command || flagBool(args, 'help')) {
    console.log(USAGE);
    process.exit(0);
  }

  const dataDir = flag(args, 'data-dir');
  const paths = resolvePaths(dataDir);
  const asJson = flagBool(args, 'json');
  const cmdLine = reconstructCmdLine();

  // 记录调用开始
  logCliRun(paths.LOGS_DIR, 'START', cmdLine);
  const startTime = Date.now();

  try {
    switch (args.command) {
      case 'collect':
        await cmdCollect(args, paths, asJson);
        break;
      case 'brief':
        await cmdBrief(args, paths, asJson);
        break;
      case 'export':
        await cmdExport(args, paths, asJson);
        break;
      case 'bindings':
        cmdBindings(paths, asJson);
        break;
      case 'guide':
        cmdGuide(paths);
        break;
      default:
        console.error(`未知命令: ${args.command}`);
        console.log(USAGE);
        process.exit(1);
    }
    // 记录调用成功
    logCliRun(paths.LOGS_DIR, 'OK', cmdLine, {
      exitCode: 0,
      durationMs: Date.now() - startTime,
    });
  } catch (e: any) {
    // 记录调用失败
    logCliRun(paths.LOGS_DIR, 'FAIL', cmdLine, {
      exitCode: 1,
      durationMs: Date.now() - startTime,
      error: e?.message || String(e),
    });
    throw e;
  } finally {
    // 确保浏览器进程关闭
    await closeBrowser();
  }
}

main().catch((e) => {
  console.error('错误:', e?.message || String(e));
  process.exit(1);
});
