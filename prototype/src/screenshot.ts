import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import puppeteer, { Browser } from 'puppeteer';
import { TemplateConfig } from './shared/types';

let browserInstance: Browser | null = null;

/**
 * 探测系统已安装的 Chrome / Edge 可执行文件
 * （v0.3 跳过 puppeteer 自带 chromium 下载，复用系统浏览器）
 */
function findSystemChrome(): string | undefined {
  // 1. 环境变量优先
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // 2. 常见安装路径
  const candidates: string[] = [];
  if (os.platform() === 'win32') {
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push(
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
    candidates.push(
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    );
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
    candidates.push('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  } else if (os.platform() === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/microsoft-edge');
  }
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * 获取/复用浏览器实例
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  const executablePath = findSystemChrome();
  if (!executablePath) {
    throw new Error(
      '未找到系统 Chrome/Edge，请安装 Chrome 或设置 PUPPETEER_EXECUTABLE_PATH 环境变量'
    );
  }
  console.log(`[browser] 使用: ${executablePath}`);
  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1',
    ],
  });
  return browserInstance;
}

/**
 * 关闭浏览器
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * 用 Puppeteer 截图
 * @param html 完整 HTML 字符串（含内联 CSS）
 * @param config 模板配置
 * @param outputPath 输出文件路径
 */
export async function screenshot(
  html: string,
  config: TemplateConfig,
  outputPath: string
): Promise<void> {
  const { width, height, scale } = config.layout;

  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setViewport({
    width,
    height,
    deviceScaleFactor: scale,
  });

  // 直接用 setContent 加载 HTML，无需 file:// 路径
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // 确保字体加载完成
  await page.evaluateHandle('document.fonts.ready');

  // 截图：full page false，按视口尺寸截
  await page.screenshot({
    path: outputPath,
    type: config.output.format === 'png' ? 'png' : 'jpeg',
    quality: config.output.format === 'png' ? undefined : config.output.quality || 90,
    clip: {
      x: 0,
      y: 0,
      width,
      height,
    },
  });

  await page.close();
  console.log(`[screenshot] 已生成: ${outputPath}`);
}
