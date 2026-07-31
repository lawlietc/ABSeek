---
name: "abseek-daily"
description: "ABSeek 每日资讯出图自动化流程：采集资讯→处理简讯md文件→匹配模板出图。Invoke when user wants to run daily news collection+processing+export pipeline, or asks for 每日资讯/采集出图/abseek daily."
---

# ABSeek 每日资讯出图流程

本 skill 编排 ABSeek 项目的完整出图链路：采集 → 处理简讯 → 出图。所有步骤通过 `abseek` CLI 命令 + 直接读写 md 文件完成。

## 前置条件

- 工作目录：`D:\LFolder\AIProgram\ABSeek`
- CLI 已构建：`out/main/cli.js` 存在（若不存在，先跑 `npm run build`）
- 调用方式：`node out/main/cli.js <command> [options]`（下文统一用 `abseek` 代指）
- 协作规范：`data/AGENT_GUIDE.md`（处理 md 文件前必读）

## 完整流程（5 步）

### 第 1 步：采集资讯

```bash
node out/main/cli.js collect --all --json
```

**输出**（JSON）：
```json
{ "success": true, "totalNew": 12, "results": [{ "sourceId": "ign", "success": true, "newCount": 5 }, ...] }
```

**判定**：
- `success=true` → 继续（即使部分源失败也继续，只要有新增）
- `totalNew=0` → 流程结束，告知用户「今日无新资讯」
- 全部失败 → 告知用户错误信息，流程终止

### 第 2 步：拉取待处理简讯清单

```bash
node out/main/cli.js brief list --status raw --json
```

**输出**：简讯数组，每条含 `id` / `_filePath` / `title` / `summary` / `source` / `date` 等。

**记录**：保存 `count`（待处理总数），用于最后汇总。

### 第 3 步：逐条处理简讯（agent 核心工作）

#### 3.0 开始前状态重校验（必须）

进入 STEP3 后，**先重新拉取一次 raw 简讯清单**确认数量，不要直接用 STEP2 的结果：

```bash
node out/main/cli.js brief list --status raw --json
```

- 如果返回 `[]` 或数量为 0：说明期间状态已变化（可能被 GUI 或其他流程处理过），**跳过 STEP3，直接进入 STEP4**
- 数量 > 0：以这次拉取的清单为准，继续逐条处理

这一步避免「STEP2 拉到 N 条，STEP3 执行时 raw=0」的状态不一致问题。

> 💡 **可选快速预处理**：如果想跳过逐条读写 md 的重复劳动，可先跑 `node out/main/cli.js brief process --auto --json`，CLI 会用关键词规则批量完成行业判断/AB 面/标签/状态流转（不翻译，title.zh 留空）。之后 agent 只需对需要精修的简讯补翻译、调整 aspect。两种方式二选一，不要混用以免重复处理。

对每条 raw 简讯，**直接读写 md 文件**（不用 `brief save` 命令，因为要改的字段多）。

#### 3.1 读取简讯文件

用 Read 工具读 `_filePath` 指向的 md 文件。文件结构：
```
---
<YAML frontmatter>
---
<正文>
```

#### 3.2 处理内容（agent 用自身 LLM 能力完成）

对每条简讯按顺序做以下处理：

1. **行业判断（最先做）**：判断这条资讯是否属于游戏行业。**非游戏行业**的消息（如纯科技、纯财经、与游戏无关的硬件等）→ `status: excluded`，`agentMeta.notes` 说明排除原因，**结束该条处理**（不做翻译/分面/打标）
2. **翻译**：`originalTitle` / `originalSummary` 是英文原文，生成中文填到 `title.zh` / `summary.zh`（保留 `title.en` / `summary.en`）
3. **摘要精简**：如果原文摘要过长，精简到 50-80 字
4. **判定 aspect**：根据内容判断分到 A 面还是 B 面，拿不准的保留未分面（参考下方分类规则）
5. **打标签**：补充 tags（如 `DLC` / `财报` / `人事变动` 等）
6. **重要性**：填 `customAttrs.importance`（high/medium/low）
7. **状态流转**：`status: raw` → `status: processed`（excluded 的已在第 1 步处理）

#### aspect 分类参考规则

核心判断原则：**从玩家角度**看，这条消息是好消息还是坏消息。

- **A 面（对玩家是好消息）**：新游戏公布、DLC、发售日、游戏降价、游戏评价好、评分高、免费更新等
  - ⚠️ 注意区分「对玩家坏但对行业好」的消息，这类**不算 A 面**，例如：PS 取消实体光盘、游戏内购增多、订阅制涨价等
- **B 面（对玩家是坏消息）**：游戏延期、DLC 取消、游戏涨价、评价低、评分低、服务器关停等
  - ⚠️ 注意区分媒体评分和玩家评分：可能出现媒体评分高、玩家评分低的情况，此时应以**玩家评分**为准判为 B 面
- **无法判断**：保留未分面状态（`aspect: ""`），`status` 仍设为 `processed`。出图时因 aspect 为空匹配不到模板，会自动跳过，不影响其他简讯出图

#### 3.3 写回文件（必须遵循 AGENT_GUIDE 规范）

**写入方式（强制）**：先写 `.tmp` 再 rename，避免应用读到半截文件：

```
xxx.md.tmp  →  写入完成  →  rename  →  xxx.md
```

用 Write 工具写到 `<原路径>.tmp`，然后用 RunCommand 执行 `Rename-Item` 完成原子替换。

**YAML 格式要求**：
- `title` / `summary` 是对象：`{zh: 中文, en: English}`，不是字符串
- `tags` 必须是数组
- `customAttrs` 必须是扁平对象
- 时间用 ISO 8601
- 不可修改字段：`id` / `source` / `sourceUrl` / `date`
- 文件名不变

**agentMeta 必填**：
```yaml
agentMeta:
  processedAt: 2026-07-30T08:05:00+08:00   # 当前时间
  tool: trae-skill
  model: <你用的模型名>
  version: 1
  changes: [title, summary, aspect, tags, customAttrs, status]
  notes: 简短说明判定理由
```

#### 3.4 异常处理

- 简讯内容为空或无法理解：`status: ignored`，`agentMeta.notes` 说明原因
- 非游戏行业消息：`status: excluded`，`agentMeta.notes` 说明排除原因（见 3.2 第 1 步）
- 无法判断 AB 面的消息：`status: processed`，`aspect: ""`（留空），出图时自动跳过
- 单条处理失败：跳过，继续下一条，最后汇总失败数
- 不要因为单条失败终止整个流程

### 第 4 步：出图

所有 raw 简讯处理完成后（全部变成 processed / excluded / ignored 之一），执行：

```bash
node out/main/cli.js export --status processed --lang zh --json
```

**输出**（JSON）：
```json
{
  "success": true,
  "files": ["2026-07-30-template-a-A-1-zh.jpg", "2026-07-30-template-a-A-2-zh.jpg", ...],
  "outputDir": "D:\\LFolder\\AIProgram\\ABSeek\\output\\images\\2026-07-30",
  "briefCount": 8
}
```

### 第 5 步：确认生图结果（三层校验）

agent 必须向用户汇报生图结果，三层校验确保可信：

#### 5.1 检查 CLI 返回值

从 `export` 的 JSON 输出提取：
- `success` 是否为 true
- `files` 数组长度（生成几张图）
- `outputDir`（输出目录绝对路径）
- `briefCount`（参与出图的简讯数）

#### 5.2 实际核对文件存在

用 Glob 或 LS 工具检查 `outputDir` 下是否真的有 `files` 列出的文件：

```
Glob pattern: output/images/<date>/*.jpg
```

对比实际文件数与 `files.length`。若不一致，说明有遗漏，需排查。

#### 5.3 汇总报告

向用户输出结构化汇总，格式：

```
## 今日资讯出图完成

**采集**：3 个源，新增 12 条简讯
**处理**：成功 10 条（A 面 6 条 / B 面 4 条），忽略 2 条
**出图**：生成 4 张图片
  - 2026-07-30-template-a-A-1-zh.jpg (A 面第 1 页)
  - 2026-07-30-template-a-A-2-zh.jpg (A 面第 2 页)
  - 2026-07-30-template-a-B-1-zh.jpg (B 面第 1 页)
  - 2026-07-30-template-a-B-2-zh.jpg (B 面第 2 页)
**输出目录**：D:\LFolder\AIProgram\ABSeek\output\images\2026-07-30
**文件核对**：实际 4 个文件，与预期一致 ✓

**忽略的简讯**：
  - <id>：<原因>
```

## 命令速查

| 命令 | 作用 |
|---|---|
| `node out/main/cli.js collect --all --json` | 采集全部启用源 |
| `node out/main/cli.js brief list --status raw --json` | 列待处理简讯 |
| `node out/main/cli.js brief list --status processed --json` | 列已处理简讯（校验用） |
| `node out/main/cli.js export --status processed --lang zh --json` | 出图 |
| `node out/main/cli.js bindings list` | 查看 aspect→模板绑定 |
| `node out/main/cli.js guide` | 打印 AGENT_GUIDE.md 路径 |

## 流程日志（强制）

agent 执行流程时，必须把关键节点追加到 `data/logs/skill-runs-{YYYY-MM-DD}.log`。出问题时靠这个文件快速定位卡在哪一步。

### 日志方法

用 RunCommand 执行 Node 单行命令追加（不要用 Write 工具，会覆盖整个文件）。

⚠️ **必须用 Node 的 `appendFileSync`**，不要用 PowerShell 的 `Add-Content`/`Out-File`（PowerShell 5 默认 GBK 编码写中文会乱码，且部分环境脚本执行策略会拦截）：

```bash
node -e "require('fs').appendFileSync('data/logs/skill-runs-2026-07-30.log','[08:00:00] [STEP1-START] 采集\n','utf8')"
```

批量追加多行（用 `\n` 拼接）：

```bash
node -e "require('fs').appendFileSync('data/logs/skill-runs-2026-07-30.log','[08:00:15] [STEP1-OK] 采集: 3源 12条新增\n[08:00:16] [STEP2-START] 拉取raw简讯\n','utf8')"
```

⚠️ 日志内容含单引号时，Node 字符串外层用双引号、内层用单引号；含双引号时反过来。或用模板字符串拼接。

### 必须记录的节点

| 时机 | 格式 | 示例 |
|---|---|---|
| 每步开始 | `[HH:MM:SS] [STEP{n}-START] <步骤名>` | `[08:00:00] [STEP1-START] 采集` |
| 每步成功 | `[HH:MM:SS] [STEP{n}-OK] <步骤名>: <结果摘要>` | `[08:00:15] [STEP1-OK] 采集: 3源 12条新增` |
| 每步失败 | `[HH:MM:SS] [STEP{n}-FAIL] <步骤名>: <错误>` | `[08:00:15] [STEP1-FAIL] 采集: 全部源失败` |
| 单条简讯处理完 | `[HH:MM:SS] [BRIEF] <id>: aspect=<A\|B\|空> changes=[字段列表]` | `[08:01:20] [BRIEF] 20260730-01-xxx: aspect=A changes=[title,summary,aspect,tags]` |
| 单条简讯排除（非游戏） | `[HH:MM:SS] [BRIEF-EXCLUDE] <id>: <排除原因>` | `[08:01:30] [BRIEF-EXCLUDE] 20260730-02-yyy: 非游戏行业 → excluded` |
| 单条简讯失败 | `[HH:MM:SS] [BRIEF-FAIL] <id>: <原因>` | `[08:02:00] [BRIEF-FAIL] 20260730-03-zzz: 内容为空 → ignored` |
| 流程结束 | `[HH:MM:SS] [END] 采集N 处理M(成功X/失败Y) 出图K张` | `[08:03:30] [END] 采集12 处理12(成功11/失败1) 出图4张` |

### 完整示例

```
[08:00:00] [STEP1-START] 采集
[08:00:15] [STEP1-OK] 采集: 3源 12条新增
[08:00:16] [STEP2-START] 拉取raw简讯
[08:00:17] [STEP2-OK] 拉取raw简讯: 12条
[08:00:17] [STEP3-START] 处理简讯
[08:01:20] [BRIEF] 20260730-01-xxx: aspect=A changes=[title,summary,aspect,tags,customAttrs]
[08:01:35] [BRIEF] 20260730-02-yyy: aspect=B changes=[title,summary,aspect,tags]
[08:02:00] [BRIEF-FAIL] 20260730-03-zzz: 内容为空 → ignored
[08:03:00] [STEP3-OK] 处理简讯: 成功11 失败1
[08:03:01] [STEP4-START] 出图
[08:03:30] [STEP4-OK] 出图: 4张 → output/images/2026-07-30
[08:03:30] [END] 采集12 处理12(成功11/失败1) 出图4张
```

### 日志文件路径

日期用**当天日期**，路径相对项目根：
```
data/logs/skill-runs-2026-07-30.log
```

## 注意事项

1. **工作目录**：所有 CLI 命令必须在 `D:\LFolder\AIProgram\ABSeek` 下执行，否则数据目录定位错误
2. **不动 GUI 应用**：如果 Electron 应用正在运行，agent 改 md 后应用的 chokidar 会自动增量刷新前端，无需重启
3. **文件命名**：处理 md 时**不要改名**，只改 frontmatter 内容
4. **批量处理**：简讯多时逐条处理，每条处理完即可写回，不必等全部处理完
5. **幂等性**：如果中途中断重跑，已 processed 的简讯不会被 `brief list --status raw` 列出，可安全续跑
6. **代理**：采集海外源需要本机 Clash 在 127.0.0.1:7890 运行，否则采集会失败
7. **流程日志**：必须记录到 `data/logs/skill-runs-{date}.log`（见上方「流程日志」一节），CLI 自身的调用日志由 CLI 自动写入 `data/logs/cli-runs-{date}.log`
