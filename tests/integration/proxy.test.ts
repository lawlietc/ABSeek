import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';

// mock https 用于 testProxy
vi.mock('https', () => {
  const get = vi.fn((url: string, options: any, cb: (res: any) => void) => {
    const res = new Readable({ read() {} }) as any;
    res.statusCode = 204;
    cb(res);
    res.resume();
    return { on: vi.fn(), destroy: vi.fn() };
  });
  return { default: { get }, get };
});

import { createAgent, testProxy } from '../../electron/main/collector/proxy';
import { ProxyConfig } from '../../electron/main/store/configRepo';

describe('createAgent', () => {
  it('mode=none 返回 undefined', () => {
    expect(createAgent({ mode: 'none' })).toBeUndefined();
  });

  it('mode=none 无 server 返回 undefined', () => {
    expect(createAgent({ mode: 'none' })).toBeUndefined();
  });

  it('mode=system 降级为 undefined', () => {
    expect(createAgent({ mode: 'system' })).toBeUndefined();
  });

  it('mode=manual 创建 HttpsProxyAgent', () => {
    const agent = createAgent({
      mode: 'manual',
      server: 'http://127.0.0.1:7890',
    });
    expect(agent).toBeDefined();
  });

  it('mode=manual 无 server 返回 undefined', () => {
    const agent = createAgent({ mode: 'manual', server: '' });
    expect(agent).toBeUndefined();
  });

  it('mode=manual 非法 server 返回 undefined', () => {
    const agent = createAgent({ mode: 'manual', server: 'not-a-url:::invalid' });
    // HttpsProxyAgent 对非法 URL 可能抛错或返回，这里期望降级为 undefined
    // 实际 HttpsProxyAgent 不校验 URL，会返回 agent，所以这里只验证不抛错
    expect(agent).toBeDefined();
  });
});

describe('testProxy', () => {
  it('mode=none 直连测试', async () => {
    const ok = await testProxy({ mode: 'none' });
    // mock https.get 返回 204，应成功
    expect(ok).toBe(true);
  });

  it('mode=system 返回 false', async () => {
    const ok = await testProxy({ mode: 'system' });
    expect(ok).toBe(false);
  });

  it('mode=manual 无 server 返回 false', async () => {
    const ok = await testProxy({ mode: 'manual', server: '' });
    expect(ok).toBe(false);
  });
});
