#!/usr/bin/env node
/**
 * 存量清理脚本：标记同 sourceUrl 的重复简讯
 *
 * 背景：采集层此前缺并发锁（已修复 scheduler.ts），同一 URL 被并发采集两次，
 * 生成 -01/-02 两个内容相同的 md 文件。dedup（duplicateDetector）基于标题
 * 相似度聚类已处理大部分，但仍有少量同 URL 副本因状态为 excluded 等原因未被覆盖。
 *
 * 本脚本：按 sourceUrl 聚合，同组内保留 id 最小（seq 最小）的一条，
 * 其余标记为 status=duplicate，customAttrs.mergedTo 指向保留简讯，
 * agentMeta.notes 记录清理来源。
 *
 * 用法：
 *   node scripts/cleanup-same-url-dups.js --dry-run   # 预演，只打印
 *   node scripts/cleanup-same-url-dups.js             # 实际写回
 */
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const BRIEFS_DIR = path.resolve(__dirname, '..', 'data', 'briefs');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = walk(BRIEFS_DIR);

  // 按 sourceUrl 聚合
  const byUrl = new Map();
  for (const p of files) {
    let m;
    try {
      m = matter(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const url = (m.data.sourceUrl || '').trim();
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ p, data: m.data, content: m.content });
  }

  // 找出需清理的组：组内 >1 条且其中 >1 条非 duplicate
  let totalToMark = 0;
  const groups = [];
  for (const [url, arr] of byUrl) {
    if (arr.length < 2) continue;
    const nonDup = arr.filter((x) => x.data.status !== 'duplicate');
    if (nonDup.length < 2) continue;
    // 按 id 排序，保留第一个
    nonDup.sort((a, b) => (a.data.id || a.p).localeCompare(b.data.id || b.p));
    const keep = nonDup[0];
    const toMark = nonDup.slice(1);
    totalToMark += toMark.length;
    groups.push({ url, keep, toMark });
  }

  console.log(`扫描 ${files.length} 个 md 文件，发现 ${groups.length} 组同 URL 重复，需标记 ${totalToMark} 条为 duplicate`);
  console.log(`模式: ${dryRun ? 'dry-run（不写回）' : '实际写回'}`);
  console.log('---');

  for (const g of groups) {
    console.log(`URL: ${g.url}`);
    console.log(`  保留: ${g.keep.data.id}`);
    for (const t of g.toMark) {
      console.log(`  标记: ${t.data.id} (原状态: ${t.data.status})`);
    }
  }

  if (dryRun) {
    console.log('---');
    console.log('dry-run 完成，未写回任何文件。去掉 --dry-run 执行实际清理。');
    return;
  }

  // 实际写回
  let written = 0;
  const now = new Date().toISOString();
  for (const g of groups) {
    for (const t of g.toMark) {
      const newData = { ...t.data };
      newData.status = 'duplicate';
      if (!newData.customAttrs) newData.customAttrs = {};
      newData.customAttrs.mergedTo = g.keep.data.id;
      newData.agentMeta = {
        processedAt: now,
        tool: 'cleanup-same-url-dups',
        version: 1,
        changes: ['status', 'customAttrs'],
        notes: `同URL存量清理: 与 ${g.keep.data.id} 同 sourceUrl，标记为重复`,
      };
      // 原子写：先 .tmp 再 rename
      const tmp = t.p + '.tmp';
      const out = matter.stringify(t.content, newData);
      fs.writeFileSync(tmp, out, 'utf8');
      fs.renameSync(tmp, t.p);
      written++;
    }
  }

  console.log('---');
  console.log(`清理完成，已写回 ${written} 个文件`);
}

main();
