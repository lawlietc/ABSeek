import * as cheerio from 'cheerio';
import { SourceConfig, ProxyConfig } from '../store/configRepo';
import { RawBrief } from './types';
import { createAgent } from './proxy';
import * as https from 'https';
import * as http from 'http';

/**
 * 静态爬虫（cheerio 兜底）
 * 通过 source.selectors 配置标题/链接/摘要/日期选择器
 */
export async function collectStatic(
  source: SourceConfig,
  proxy: ProxyConfig
): Promise<RawBrief[]> {
  const agent = createAgent(proxy);
  const html = await fetchText(source.url, agent, source.request?.userAgent);
  const $ = cheerio.load(html);

  const selectors = source.selectors || {};
  const itemSelector = selectors.item || 'article, .post, .article';
  const titleSel = selectors.title || 'h1, h2, h3';
  const linkSel = selectors.link || 'a';
  const summarySel = selectors.summary || 'p';
  const dateSel = selectors.date || 'time';
  const imageSel = selectors.image || 'img';

  const rawBriefs: RawBrief[] = [];
  $(itemSelector).each((_, el) => {
    const $el = $(el);
    const title = $el.find(titleSel).first().text().trim();
    let link = $el.find(linkSel).first().attr('href') || '';
    if (link && !link.startsWith('http')) {
      try {
        link = new URL(link, source.url).toString();
      } catch {
        // ignore
      }
    }
    const summary = $el.find(summarySel).first().text().trim();
    const dateStr = $el.find(dateSel).first().attr('datetime') || $el.find(dateSel).first().text().trim();
    const image = $el.find(imageSel).first().attr('src') || undefined;

    if (!title || !link) return;
    rawBriefs.push({
      title,
      summary: summary.slice(0, 500),
      date: normalizeDate(dateStr),
      source: source.id,
      sourceName: source.name,
      sourceUrl: link,
      image,
      body: '',
    });
  });

  return rawBriefs;
}

function fetchText(url: string, agent: any, userAgent?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        agent,
        timeout: 20000,
        headers: { 'User-Agent': userAgent || 'ABSeek/1.0' },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 跟随重定向（一层）
          const next = new URL(res.headers.location, url).toString();
          fetchText(next, agent, userAgent).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function normalizeDate(s: string): string {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}
