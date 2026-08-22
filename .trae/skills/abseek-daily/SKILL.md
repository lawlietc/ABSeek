---
name: "abseek-daily"
description: "ABSeek 每日资讯出图自动化流程：采集资讯→处理信源→生成展示简讯→匹配模板出图。Invoke when user wants to run daily news collection+processing+export pipeline, or asks for 每日资讯/采集出图/abseek daily."
---

# ABSeek 每日资讯出图流程

本 skill 编排 ABSeek 项目的完整出图链路：采集（信源简报）→ 处理信源 → 生成展示简讯 → 出图。所有步骤通过 `abseek` CLI 命令 + 直接读写 md 文件完成。本流程**按 profile 泛化**：领域判断与分类规则不再写死为「游戏」，而是读取当前 profile 的 `rules.json`。

## 前置条件

- 工作目录：`D:\LFolder\AIProgram\ABSeek`
- CLI 已构建：`out/main/cli.js` 存在（若不存在，先跑 `npm run build`）
- 调用方式：`node out/main/cli.js <command> [options]`（下文统一用 `abseek` 代指）
- 协作规范：`data/AGENT_GUIDE.md`（处理 md 文件前必读）
- **profile**：默认 `game`；其他 profile 用 `--profile <id>`（如 AI 资讯用 `--profile ai`）。判断规则以 `data/profiles/<id>/config/rules.json`（或 `data/config/rules.json`）为准。
- **profile 完整性**：`--profile <id>` 要求该 profile 目录完整（`config/rules.json`、`config/sources.json`、`briefs/`、`stories/`）。当前已配置 `game`（`data/config/`）与 `ai`（`data/profiles/ai/`）。目标 profile 不完整时，提示用户或回退 `game`，不要凭记忆臆造规则。

## 数据模型（关键）

- **信源简报 brief**（`data/briefs/`，非 game profile 为 `data/profiles/<id>/briefs/`）：采集写入，**只作信息源引用，不被编辑成展示**。
- **展示简讯 story**（`data/stories/`，非 game profile 为 `data/profiles/<id>/stories/`）：agent 依据信源**聚合生成**，是**出图的唯一数据源**。展示内容完全可控，可引用多个信源。

## 解析 JSON 输出的三个坑（必读）

1. **stdout 纯净性**：CLI 的 `--json` 模式已关闭日志控制台输出（logger 只写文件），stdout 应只有 JSON。若仍解析失败，用 `out.indexOf('{')` 截取 JSON 起点再 parse。
2. **不要用 PowerShell 重定向/管道解析 JSON**：`> file` 会按 GBK 编码写盘导致中文乱码、`JSON.parse` 报 `Bad control character`。应直接用 Node 调用并解析，例如：
   ```bash
   node -e "const{execSync}=require('child_process');const r=JSON.parse(execSync('node out/main/cli.js brief list --status raw --json',{encoding:'utf8'}));console.log('count='+r.length)"
   ```
3. **输出过大时**：`brief list --json`（数千条）可能触发管道缓冲上限（ENOBUFS），改用 `--format compact` + `--status`/`--date` 缩小范围。

## 完整流程（7 步 + 可选去重）

### 第 1 步：采集资讯（信源简报）

```bash
node out/main/cli.js collect --all --json
```

（AI profile：`node out/main/cli.js --profile ai collect --all --json`）

**输出**（JSON）：
```json
{ "success": true, "totalNew": 12, "results": [{ "sourceId": "ign", "success": true, "newCount": 5 }, ...] }
```

**判定**：
- `success=true` → 继续（即使部分源失败也继续，只要有新增）
- `totalNew=0` → 流程结束，告知用户「今日无新资讯」
- 全部失败 → 告知用户错误信息，流程终止

### 第 2 步：拉取待处理信源清单

```bash
node out/main/cli.js brief list --status raw --json
```

**输出**：信源简报数组，每条含 `id` / `_filePath` / `title` / `summary` / `source` / `date` 等。

**记录**：保存 `count`（待处理总数）。

### 第 3 步：读取 profile 判断规则（存在则读，否则用内建默认）

进入 STEP3 前，**读取当前 profile 的 rules.json**（判断标准以它为准，不要凭记忆或写死）：

```bash
node out/main/cli.js guide   # 打印 AGENT_GUIDE.md 路径
```

然后读取 profile 的规则文件（二选一，看哪个存在）：
- `data/profiles/<id>/config/rules.json`
- `data/config/rules.json`

`rules.json` 含：
- `industryKeywords`：领域判定词（命中任一视为属于本领域，否则 `excluded`）
- `aspectRules.aKeywords / bKeywords`：双面分类关键词（A / B，无法判断留空）
- `tagRules`：标签 → 关键词
- `importance.high / medium`：重要性评估
- `llmGuide`：给 agent / LLM 的自然语言判断指引

> 若 `rules.json` 不存在（仅当目标 profile 未配置时），使用内建默认游戏规则（`loadProfileRules` 回退），不要自行臆造规则；判断完成后可在下方 STEP4 继续。

### 第 4 步：处理信源简报（先标记领域归属，可选用 --auto）

对每条 raw 信源，可选先跑规则化快速预处理（判断领域归属 / 双面 / 打标 / 重要性，不翻译）：

```bash
node out/main/cli.js brief process --auto --json
```

**也可直接逐条判断**：读取信源 md，依据 STEP3 的 `rules.json` 判断：
- **领域判断（最先做）**：不属于本领域 → `status: excluded`，`agentMeta.notes` 说明排除原因，结束该条。
- 属于本领域 → 保留，供 STEP5 聚合生成展示简讯。

> 信源简报的标题/摘要**不要求**双语或 aspect（那些是展示简讯的职责）。信源只作为聚合的依据与溯源。

### 第 4.5 步：跨源去重（可选但推荐）

同一天多源重复报道很常见，先跑 CLI 去重，把同事件聚成一组（按来源优先级选主，其余置 `duplicate`），后续聚合更方便：

```bash
node out/main/cli.js brief dedup --auto --date <YYYY-MM-DD>
```

（AI profile：`node out/main/cli.js --profile ai brief dedup --auto --date <YYYY-MM-DD>`）

**判定**：
- 想看被合并的重复简讯：`node out/main/cli.js brief list --status duplicate --format compact`
- dedup 只处理 `processed` 简讯，须在 STEP4 之后、STEP5 之前执行
- 可用 `--dry-run` 先预览结果，确认无误再去掉该参数执行

### 第 5 步：生成展示简讯（story，agent 核心工作）

信源处理后，**依据信源聚合生成展示简讯**。展示简讯是出图内容，完全由 agent 自定义文案。

> ⚠️ **规模控制**：一次采集可能成千上万条信源（如 685 条），**不要全量生成 story**。只挑选**当天代表性 / 重要事件**生成少量 story（建议 5~15 条），其余信源保留在 `briefs/` 作为数据源即可。

#### 5.0 挑选候选事件（重要）

先用已处理信源概览挑选要成 story 的事件：

```bash
node out/main/cli.js brief list --status processed --date <YYYY-MM-DD> --format compact
```

按标题去重/聚类肉眼挑选：
- **同一事件多源报道** → 合并为一条 story（`sources` 列出所有信源）
- **高重要性 / 玩家关注度高** → 优先入选
- 从 `briefs/` 里选出 N 个候选事件，进入 5.1

#### 5.1 信源聚合

- 多个信源报道同一事件 → **生成一条 story**，在 `sources` 里列出所有对应信源的 `briefId` / `sourceId` / `sourceName`。
- 优先基于 STEP4.5 的 dedup 结果：已被 dedup 聚类的同事件，直接用主简讯（`brief list --status duplicate` 可看被合并的从属简讯）；dedup 漏网的再手工合并。
- `sourceCount` 不落盘，由 `sources.length` 推导（模板可展示「N 家媒体报道」）。

#### 5.2 生成 story 文件

**先查该日期已有 story 的 seq**（避免撞号）：

```bash
node out/main/cli.js story list --date <YYYY-MM-DD> --format compact
```

用 Write 工具写到 `data/stories/{YYYY-MM-DD}/` 下（非 game profile 为 `data/profiles/<id>/stories/{YYYY-MM-DD}/`；文件名 `{YYYYMMDD}-{seq}-{slug}.md`，seq 取已有最大+1）：

```yaml
---
id: 20260809-01-new-ai-model
date: 2026-08-09T08:00:00+08:00
title:
  zh: 中文标题
  en: English Title
summary:
  zh: 中文摘要
  en: English summary
tags: [模型, 发布]
category: <按 profile>
aspect: A            # 或 B / 自定义主题值，须与 default-bindings.json 匹配
customAttrs:
  importance: high
status: processed
sources:            # 聚合的信源（可多个）
  - { briefId: "20260809-01-xxxxxx-ign-xxx", sourceId: "ign", sourceName: "IGN" }
  - { briefId: "20260809-02-yyyyyy-arxiv-yyy", sourceId: "arxiv", sourceName: "arXiv" }
agentMeta:
  processedAt: 2026-08-09T08:05:00+08:00
  tool: abseek-daily-skill
  model: <写实际使用的模型名，禁止照抄占位符>   # agentMeta 整体可选，若写必须真实
  version: 1
  changes: [title, summary, aspect, tags, sources, status]
---
正文（自定义，可含关键信息汇总）
```

**要点**：
- `title` / `summary` 是对象 `{zh, en}`，不是字符串
- **YAML 特殊字符必须加引号**：英文标题/摘要含冒号+空格（如 `Protest: ...`）、`#`、`[`、`]`、`{`、`}` 等时，值要用双引号包裹，否则 frontmatter 解析失败会被移入 `_invalid`（例如 `en: "A Demo: With Colon"`）
- `tags` 必须是数组；`customAttrs` 必须是扁平对象
- **不可修改字段**：`id` / `date`；`sources` 的 `briefId` 必须指向真实存在的信源
- 文件名沿用 `{YYYYMMDD}-{seq}-{slug}.md` 规则，`seq` 在 stories 目录独立计数
- `aspect` 取值必须匹配该 profile 的 `default-bindings.json`（可 A / B / 自定义主题）

**写入方式（强制）**：先写 `.tmp` 再 rename，避免应用读到半截文件：
```
xxx.md.tmp  →  写入完成  →  rename  →  xxx.md
```
用 Write 工具写到 `<原路径>.tmp`，然后用 Rename-Item 完成原子替换。

#### 5.3 异常处理
- 信源内容无法理解：跳过该信源（不生成 story）
- 单条 story 生成失败：跳过，继续下一条，最后汇总失败数
- 不要因为单条失败终止整个流程

### 第 6 步：出图（数据源为展示简讯 stories）

所有 story 生成完成（`status: processed`）后，**带日期出图**（story 可能补生成非今日内容，默认只导今天会漏）：

```bash
node out/main/cli.js export --status processed --lang zh --date <YYYY-MM-DD> --auto-date --json
```

（AI profile：`node out/main/cli.js --profile ai export --status processed --lang zh --date <YYYY-MM-DD> --auto-date --json`）

> `--date` 与 STEP5 生成 story 的日期一致；`--auto-date` 当天无简讯时自动回退到最近有简讯的日期，兜底防止空导出。

**输出**（JSON）：
```json
{
  "success": true,
  "files": ["2026-08-09-template-a-A-1-zh.jpg", ...],
  "outputDir": "D:\\LFolder\\AIProgram\\ABSeek\\output\\images\\2026-08-09",
  "briefCount": 8
}
```

### 第 7 步：确认生图结果（三层校验）

#### 7.1 检查 CLI 返回值
从 `export` 的 JSON 提取 `success` / `files` 长度 / `outputDir` / `briefCount`。

#### 7.2 实际核对文件存在
```
Glob pattern: output/images/<date>/*.jpg
```
对比实际文件数与 `files.length`。

#### 7.3 汇总报告
向用户输出结构化汇总：
```
## 今日资讯出图完成
**采集**：N 个源，新增 X 条信源
**信源处理**：保留 X 条 / 排除 Y 条
**展示简讯**：生成 M 条（引用信源数合计 K）
**出图**：生成 N 张图片
  - <filename> (<aspect> 第 i 页)
**输出目录**：<outputDir>
**文件核对**：实际 N 个文件，与预期一致 ✓
```

## 命令速查

| 命令 | 作用 |
|---|---|
| `node out/main/cli.js collect --all --json` | 采集全部启用源（信源） |
| `node out/main/cli.js brief list --status raw --json` | 列待处理信源 |
| `node out/main/cli.js brief process --auto --json` | 规则化处理信源（领域/双面/打标） |
| `node out/main/cli.js brief dedup --auto --date <YYYY-MM-DD>` | 跨源重复检测（process 后、export 前） |
| `node out/main/cli.js brief list --status duplicate --format compact` | 查看被合并的重复简讯 |
| `node out/main/cli.js story list --status processed --json` | 列展示简讯 |
| `node out/main/cli.js export --status processed --lang zh --date <date> --auto-date --json` | 出图（数据源 stories） |
| `node out/main/cli.js bindings list` | 查看 aspect→模板绑定 |
| `node out/main/cli.js guide` | 打印 AGENT_GUIDE.md 路径 |
| `abseek ... --profile <id>` | 指定 profile（默认 game） |

> 所有命令均可加 `--profile <id>` 切换 profile。信源简报在 `briefs/`，展示简讯在 `stories/`，出图只读 stories。

## 流程日志（强制）

agent 执行流程时，必须把关键节点追加到 `data/logs/skill-runs-{YYYY-MM-DD}.log`（对应 profile 的日志在其 `logs/` 目录）。用 Node 追加（避免 PowerShell GBK 编码问题）：

```bash
node -e "require('fs').appendFileSync('data/logs/skill-runs-2026-08-09.log','[08:00:00] [STEP1-START] 采集\n','utf8')"
```

### 必须记录的节点
| 时机 | 格式 |
|---|---|
| 每步开始/成功/失败 | `[HH:MM:SS] [STEP{n}-START\|OK\|FAIL] <步骤名>: <结果>` |
| 信源排除 | `[HH:MM:SS] [BRIEF-EXCLUDE] <id>: <原因>` |
| story 生成 | `[HH:MM:SS] [STORY] <id>: aspect=<A\|B\|空> sources=<数>` |
| story 失败 | `[HH:MM:SS] [STORY-FAIL] <id>: <原因>` |
| 流程结束 | `[HH:MM:SS] [END] 采集N 信源保留X/排除Y story生成M 出图K张` |

## 注意事项

1. **工作目录**：所有 CLI 命令必须在项目根 `D:\LFolder\AIProgram\ABSeek` 下执行，否则数据目录定位错误。
2. **JSON 解析**：见上文「解析 JSON 输出的三个坑」——避免 PowerShell 重定向/管道（GBK 编码），用 Node execSync 解析。
3. **不动 GUI 应用**：如果 Electron 应用正在运行，agent 改 md 后 chokidar 会自动增量刷新前端，无需重启。
4. **信源 vs 展示**：采集回的信源简报**不要直接改造成展示**；展示内容通过新增 story 生成。信源只作引用。
5. **幂等性**：若中途中断重跑，已处理的信源不会出现在 `--status raw`，已生成的 story 不会重复；可安全续跑。
6. **代理**：采集海外源是否需要代理以及端口，**以 `data/config/sources.json`（或对应 profile 的 `config/sources.json`）的 `global.proxy.server` 为准**（当前为 `http://127.0.0.1:7897`）；单源 `request.useProxy=false` 时无需代理。若代理未运行，采集会失败。
7. **流程日志**：必须记录到 `data/logs/skill-runs-{date}.log`；CLI 自身日志由 CLI 自动写入 `data/logs/cli-runs-{date}.log`。
