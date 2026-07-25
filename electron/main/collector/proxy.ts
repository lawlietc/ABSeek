import * as https from 'https';
import * as http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyConfig } from '../store/configRepo';

export type FetchAgent = https.Agent | http.Agent | undefined;

/**
 * 根据 proxy 配置返回对应的 agent
 * - none: undefined（不走代理）
 * - system: 暂不支持，降级为 none（Electron 内 system 代理获取复杂，后续迭代）
 * - manual: 用 https-proxy-agent
 */
export function createAgent(proxy: ProxyConfig): FetchAgent {
  if (proxy.mode === 'none' || !proxy.server) return undefined;
  if (proxy.mode === 'system') return undefined; // 简化：降级 none
  try {
    return new HttpsProxyAgent(proxy.server);
  } catch (e) {
    console.warn('[proxy] agent 创建失败，降级直连', e);
    return undefined;
  }
}

/**
 * 测试代理连通性
 */
export async function testProxy(proxy: ProxyConfig): Promise<boolean> {
  if (proxy.mode === 'none') {
    // 直连测试
    return testDirect('https://www.google.com/generate_204');
  }
  if (proxy.mode === 'system') return false;
  const agent = createAgent(proxy);
  if (!agent) return false;
  return testDirect(proxy.testUrl || 'https://www.google.com/generate_204', agent);
}

function testDirect(url: string, agent?: FetchAgent): Promise<boolean> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        agent,
        timeout: 8000,
        headers: { 'User-Agent': 'ABSeek/1.0' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}
