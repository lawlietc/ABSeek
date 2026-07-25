import * as fs from 'fs';
import * as path from 'path';

const AGENT_GUIDE_CONTENT = `# ABSeek 外部 Agent 协作规范

本文件由 ABSeek 应用首次初始化时生成，供外部 AI 工具（命令行 LLM、本地大模型、云端 API 等）读写简讯数据时遵循。

## 一、可读写目录

- \`data/briefs/{YYYY-MM-DD}/*.md\` — 简讯文件，可读写
- \`data/AGENT_GUIDE.md\` — 本规范（只读）
- \`data/_invalid/\` — 异常文件目录（只读，应用自动移入解析失败的文件）

## 二、简讯文件格式

每条简讯 = 一个 .md 文件，含 YAML frontmatter + 正文：

\`\`\`markdown
---
id: 20260723-01-a1b2c3-ign-black-myth-wukong-dlc
date: 2026-07-23T08:00:00+08:00
source: IGN
sourceUrl: https://www.ign.com/articles/xxx
author: IGN Editorial
image: https://.../cover.jpg
title:
  zh: 中文标题（agent 翻译后填）
  en: English Title
summary:
  zh: 中文摘要
  en: English summary
originalTitle: English Title
originalSummary: English summary
tags: [游戏, DLC, 国产]
category: 游戏
aspect: A
customAttrs:
  importance: high
status: processed
agentMeta:
  processedAt: 2026-07-23T08:05:00+08:00
  tool: external-llm
  model: qwen3.8
  version: 1
  changes: [summary, category, aspect, customAttrs]
  notes: 自动判定为 A 面
---

这里是原始正文或长正文，供 agent 处理与人工参考。
\`\`\`

## 三、可修改字段

\`\`\`yaml
title / summary / tags / category / customAttrs / status / agentMeta
originalTitle / originalSummary
\`\`\`

## 四、不可修改字段

\`\`\`yaml
id / source / sourceUrl / date
\`\`\`

（除非明确在做数据纠错）

## 五、写入方式

**必须先写临时文件再重命名**，避免应用读到半截文件：

\`\`\`
xxx.md.tmp  →  写入完成  →  rename  →  xxx.md
\`\`\`

应用通过 chokidar 监听 \`data/briefs/\`，会忽略 \`*.tmp\` \`*.lock\` \`*.partial\`，仅在最终 .md 落地后才读取。

## 六、状态流转规则

\`\`\`
raw → processed（agent 处理后置此状态）
\`\`\`

人工审核、导出由应用或用户操作，agent 不应主动置为 \`reviewed\` / \`exported\` / \`archived\` / \`ignored\`。

若数据有误无法处理，置 \`status: ignored\` 并在 \`agentMeta.notes\` 说明原因。

## 七、YAML 格式要求

- 所有时间用 ISO 8601（如 \`2026-07-23T08:00:00+08:00\`）
- \`tags\` 必须是数组
- \`customAttrs\` 必须是扁平对象，键名受 \`data/config/settings.json\` 的 \`customAttrSchema\` 约束
- \`title\` / \`summary\` 是对象（\`{zh, en}\`），不是字符串
- 不使用特殊符号

## 八、agentMeta 要求

\`\`\`yaml
agentMeta:
  processedAt: 2026-07-23T08:05:00+08:00
  tool: external-llm        # 工具标识
  model: qwen3.8            # 可选，模型名
  version: 1                # 规则/prompt 版本
  changes: [summary, category, customAttrs]  # 本次改动的字段列表
  notes: 自动判定为 A 面     # 可选，备注
\`\`\`

## 九、错误处理约定

- 写入前校验 YAML 合法性
- 不要删除 \`id\` / \`source\` / \`date\` 字段
- 文件命名格式：\`{YYYYMMDD}-{seq}-{hash6}-{source}-{slug}.md\`，请勿改名
- 若数据有误，置 \`status: ignored\` 并在 \`agentMeta.notes\` 说明
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
