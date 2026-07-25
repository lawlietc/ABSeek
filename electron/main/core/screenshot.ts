import * as fs from 'fs';
import * as os from 'os';
import puppeteer, { Browser } from 'puppeteer-core';
import { TemplateConfig } from './types';

let browserInstance: Browser | null = null;

/** 探测系统已安装的 Chrome / Edge */
function findSystemChrome(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates: string[] = [];
  if (os.platform() === 'win32') {
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push(
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
    candidates.push(
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    );
    candidates.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
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

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;
  const executablePath = findSystemChrome();
  if (!executablePath) {
    throw new Error('未找到系统 Chrome/Edge，请安装或设置 PUPPETEER_EXECUTABLE_PATH');
  }
  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/** 截图（与 prototype 实现一致） */
export async function screenshot(
  html: string,
  config: TemplateConfig,
  outputPath: string
): Promise<void> {
  const { width, height, scale } = config.layout;
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');
  await page.screenshot({
    path: outputPath,
    type: config.output.format === 'png' ? 'png' : 'jpeg',
    quality: config.output.format === 'png' ? undefined : config.output.quality || 90,
    clip: { x: 0, y: 0, width, height },
  });
  await page.close();
}
