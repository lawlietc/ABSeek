import * as fs from 'fs';
import * as path from 'path';

const AGENT_GUIDE_CONTENT = `# ABSeek 外部 Agent 协作规范

本文件由 ABSeek 应用首次初始化时生成，供外部 AI 工具（命令行 LLM、本地大模型、云端 API 等）读写数据时遵循。

## 一、数据模型（两类实体）

- **信源简报 brief**（\`data/briefs/{YYYY-MM-DD}/*.md\`）：采集写入，**只作信息源引用，不被编辑成展示**。可读写。
- **展示简讯 story**（\`data/stories/{YYYY-MM-DD}/*.md\`）：由 agent 依据信源**聚合生成**，是**出图的唯一数据源**。展示内容完全可控，可引用多个信源（\`sources\`）。
- \`data/AGENT_GUIDE.md\` — 本规范（只读）
- \`data/_invalid/\` — 异常文件目录（只读，应用自动移入解析失败的文件）
- 判断规则（读）：\`data/config/rules.json\`（或 \`data/profiles/<id>/config/rules.json\`）

## 二、信源简报文件格式

\`\`\`markdown
---
id: 20260723-01-a1b2c3-ign-black-myth-wukong-dlc
date: 2026-07-23T08:00:00+08:00
source: IGN
sourceUrl: https://www.ign.com/articles/xxx
author: IGN Editorial
image: https://.../cover.jpg
title:
  en: English Title
summary:
  en: English summary
originalTitle: English Title
originalSummary: English summary
tags: [游戏, DLC]
category: 游戏
aspect: ""
status: raw
---
原始正文（只作信息源参考）
\`\`\`

> 信源简报不要求 title.zh / summary.zh 或 aspect；这些是展示简讯的职责。信源只作为聚合依据与溯源。

## 三、展示简讯文件格式（出图数据源）

\`\`\`markdown
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
aspect: A
customAttrs:
  importance: high
status: processed
sources:
  - { briefId: "20260809-01-xxxxxx-ign-xxx", sourceId: "ign", sourceName: "IGN" }
  - { briefId: "20260809-02-yyyyyy-arxiv-yyy", sourceId: "arxiv", sourceName: "arXiv" }
agentMeta:
  processedAt: 2026-08-09T08:05:00+08:00
  tool: external-llm
  model: qwen3.8
  version: 1
  changes: [title, summary, aspect, tags, sources, status]
---
正文（自定义，可含关键信息汇总）
\`\`\`

**要点**：
- \`sourceCount\` 不落盘，由 \`sources.length\` 推导。
- \`sources\` 的 \`briefId\` 必须指向真实存在的信源。
- \`aspect\` 取值须匹配该 profile 的 \`default-bindings.json\`（可 A / B / 自定义主题）。

## 四、可修改字段

\`\`\`yaml
brief: title / summary / tags / category / status / agentMeta / originalTitle / originalSummary
story: title / summary / tags / category / aspect / customAttrs / sources / status / agentMeta
\`\`\`

## 五、不可修改字段

\`\`\`yaml
brief: id / source / sourceUrl / date
story: id / date
\`\`\`

（除非明确在做数据纠错）

## 六、写入方式

**必须先写临时文件再重命名**，避免应用读到半截文件：

\`\`\`
xxx.md.tmp  →  写入完成  →  rename  →  xxx.md
\`\`\`

应用通过 chokidar 监听 \`data/briefs/\` 与 \`data/stories/\`，会忽略 \`*.tmp\` \`*.lock\` \`*.partial\`，仅在最终 .md 落地后才读取。

## 七、状态流转规则

\`\`\`
信源简报：raw → (processed) → excluded（不属于本领域）
展示简讯：raw → processed → reviewed → exported
\`\`\`

- 信源领域判断 / 展示简讯生成后的状态由 agent 置为 \`processed\`。
- 人工审核、导出由应用或用户操作，agent 不应主动置为 \`reviewed\` / \`exported\` / \`archived\`。
- 若数据有误无法处理，置 \`status: ignored\` 并在 \`agentMeta.notes\` 说明原因。

## 八、YAML 格式要求

- 所有时间用 ISO 8601（如 \`2026-07-23T08:00:00+08:00\`）
- \`tags\` 必须是数组
- \`customAttrs\` 必须是扁平对象，键名受 \`data/config/settings.json\` 的 \`customAttrSchema\` 约束
- \`title\` / \`summary\` 是对象（\`{zh, en}\`），不是字符串
- 不使用特殊符号

## 九、agentMeta 要求

\`\`\`yaml
agentMeta:
  processedAt: 2026-07-23T08:05:00+08:00
  tool: external-llm        # 工具标识
  model: qwen3.8            # 可选，模型名
  version: 1                # 规则/prompt 版本
  changes: [title, aspect, tags, sources, status]  # 本次改动的字段列表
  notes: 自动判定为 A 面     # 可选，备注
\`\`\`

## 十、错误处理约定

- 写入前校验 YAML 合法性
- 不要删除 \`id\` / \`source\` / \`date\` 字段
- 文件命名格式：brief \`{YYYYMMDD}-{seq}-{hash6}-{source}-{slug}.md\`，story \`{YYYYMMDD}-{seq}-{slug}.md\`，请勿改名
- 若数据有误，置 \`status: ignored\` 并在 \`agentMeta.notes\` 说明
- 领域判断与分类以 \`rules.json\` 为准（不存在则用默认游戏规则）
`;

/**
 * 首次启动时生成 AGENT_GUIDE.md（已存在则跳过）
 */
export function ensureAgentGuide(dataDir: string): void {
  const file = path.join(dataDir, 'AGENT_GUIDE.md');
  if (fs.existsSync(file)) return;
  try {
    fs.writeFileSync(file, AGENT_GUIDE_CONTENT, 'utf8');
    console.log(`[agentGuide] 已生成 ${file}`);
  } catch (e) {
    console.warn(`[agentGuide] 生成失败`, e);
  }
}
