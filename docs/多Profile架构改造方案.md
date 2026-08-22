# ABSeek 多 Profile 架构改造方案

> 目标：把 ABSeek 从「专为游戏资讯设计」泛化为「多领域新闻出图」工具。通过多 profile 机制，让不同的资讯领域（如游戏、AI）各自拥有独立的采集源、处理规则、分类绑定与 skill 流程。

## 背景与现状

当前整条链路（采集 → 处理 → 分类 → 出图）都是按游戏资讯的路径写死：

| 位置 | 耦合内容 |
|---|---|
| `electron/main/store/configRepo.ts` | 默认源写死 IGN/Eurogamer/Polygon，`defaultTags:['游戏','海外']`、`defaultCategory:'游戏'` |
| `cli/index.ts` | `brief process --auto` 里 `GAMING_KEYWORDS`、`A/B_KEYWORDS`、`extractTags`、`judgeImportance` 全部硬编码 |
| `SKILL.md`（root / `.opencode` / `.trae` 三份） | 行业判断=游戏、aspect A/B 从玩家角度、tag 例子（DLC/财报） |
| `electron/main/store/agentGuide.ts` | 生成的 AGENT_GUIDE 硬编码游戏示例、A/B=玩家角度、category=游戏 |
| 数据路径 | 全项目只有一个 `data/` 树，无法隔离多套 |
| `default-bindings.json` | 单一 aspect→模板绑定 |
| `automation.json` | 单一调度（采集+出图各一个 cron） |
| `settings.json` | `customAttrSchema` 单一 |
| aspect A/B 概念 | 语义绑定「从玩家角度分好坏」，对非游戏领域不一定适用 |

## 核心设计：Profile 模型

引入 `--profile <id>` 概念，每个 profile 拥有独立的：

- 采集源（sources.json）
- 自动化调度（automation.json）
- aspect→模板绑定（default-bindings.json）
- 领域规则（rules.json，新增）
- 简讯数据（briefs/）
- 自定义字段 schema（settings.json）
- 协作规范（AGENT_GUIDE.md，按领域自动生成）

CLI 默认 `--profile game`，向后兼容。

### 目录布局

```
data/
  profiles/
    game/                      # 现有这套（迁移或保留原路径）
      sources.json
      automation.json
      default-bindings.json
      settings.json
      rules.json               # 新增：领域规则（声明式）
      briefs/
      AGENT_GUIDE.md           # 按领域生成
    ai/
      sources.json             # 独立 AI 源
      automation.json
      default-bindings.json
      settings.json
      rules.json               # AI 领域判断/分类规则
      briefs/
      AGENT_GUIDE.md
profiles.json                  # profile 注册表
templates/                     # 共享模板库（多 profile 复用）
output/profiles/{id}/          # 各自输出，互不覆盖
```

### 关键解耦点

**1. 规则从代码搬到配置（`rules.json`）**

把 `cli/index.ts` 硬编码的 `GAMING_KEYWORDS` / A/B / 打标 / 重要性抽象成声明式规则：

```json
{
  "industryKeywords": [...],
  "excludeLogic": "not-matching-industry → excluded",
  "aspectRules": {
    "definitions": "从玩家角度看好坏",
    "A": [...],
    "B": [...]
  },
  "tagRules": [{ "tag": "DLC", "keywords": [...] }],
  "importance": { "high": [...], "medium": [...] },
  "llmGuide": "给 agent/LLM 的自然语言判断指引"
}
```

`brief process --auto` 改为读取当前 profile 的 `rules.json`，逻辑通用化。

**2. aspect 概念泛化**

不把 A/B 当作唯一语义，开放为任意分类值（如 AI profile 可用 `ai-news` / `ai-model` / `ai-funding`）。模板绑定 `default-bindings.json` 每 profile 独立配置。

**3. Skill 参数化（单一 skill + `--profile`）**

同一份 6 步 skill 流程，通过 `--profile` + 读取该 profile 的 `rules.json` 与 `AGENT_GUIDE.md` 决定判断标准，不把「游戏/玩家角度」写死在 SKILL.md。

**4. 数据/输出隔离**

每个 profile 独立 `briefs/`、`output/`、`sources.json`、`automation.json`，互不污染，去重与调度各自独立。

## Skill 组织方式决策

拆解 agent 执行可能出错的类型：

1. **判错标准**（致命）：把游戏规则套到 AI 资讯，导致误判 excluded / aspect / 标签。
2. **写错格式**（次要）：frontmatter 结构、原子写入、agentMeta 不规范。

方案对比：

| 方案 | 判错标准风险 | 维护成本 | 触发准确性 |
|---|---|---|---|
| 每 profile 一份 skill（重复） | 中：agent 可能选错 skill，多份 prose 漂移失同步 | 高 | 低：agent 需先「选对 skill」 |
| **单一 skill + `--profile` + 强制读规则** | 低：判断标准是结构化数据，被强制加载 | 低 | 高：skill 只负责动作机制，判断由数据决定 |

**结论：采用「单一 `abseek-daily` skill + `--profile <id>`」方案。** skill 只承载动作机制（6 步流程、文件格式、原子写入、日志），判断标准变成 `rules.json` 数据；skill 在 STEP3 开头强制要求 agent 先读 `profiles/{id}/rules.json` 和 `AGENT_GUIDE.md` 再判定。

> 增强选项：把 profile 的完整判断 prompt 片段写进生成的 `AGENT_GUIDE.md`，skill 让 agent 通篇按 guide 执行，进一步提高确定性。

## 交付顺序（每阶段可独立可用）

### 阶段 1：多源隔离

- 新增 `--profile <id>` 参数 + `profiles.json` 注册表 + `data/profiles/{id}/` 目录隔离
- 默认 `game` 走现有逻辑，不破坏现有数据
- 跑通第二个 profile 的采集

### 阶段 2：规则配置化

- 把 `cli/index.ts` 硬编码规则抽到 `rules.json`
- `game` 的 rules.json = 现有关键词搬运，行为不变（有测试兜底）

### 阶段 3：Skill 泛化

- SKILL.md 改为读 profile 的 rules.json / AGENT_GUIDE
- `--profile ai` 跑通 AI 资讯全流程

### 阶段 4：模板 / GUI（可选）

- 模板库按需扩展
- Electron GUI 加 profile 切换

## 待确认决策

1. 阶段 1 是否顺手把现有 `data/` 迁移进 `data/profiles/game/`，还是保留原地、新增 profile 目录（过渡期双轨）？
2. skill 增强版（判断 prompt 写进生成的 AGENT_GUIDE）是阶段 3 直接做，还是先做基础版看效果再增强？
