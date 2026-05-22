/**
 * PDF.js 4.x Polyfills - Electron 主进程的浏览器 API polyfills
 * 必须在所有其他 import 之前加载！
 */

// ──────────────────────────────────────────
// 1. Node.js Crypto (用于 PDF 签名/校验)
// ──────────────────────────────────────────
import * as crypto from 'crypto';
import { pathToFileURL } from 'url';

if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = { getRandomValues: undefined, subtle: undefined };
}

if (!(globalThis as any).crypto.subtle) {
  (globalThis as any).crypto.subtle = {
    digest: async (algorithm: string, data: BufferSource) => {
      const buffer = data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const hash = crypto.createHash(algorithm.toLowerCase().replace('-', ''));
      hash.update(buffer);
      return hash.digest();
    },
  };
}

// ──────────────────────────────────────────
// 2. Path2D / DOMMatrix / Image (Stub)
// ──────────────────────────────────────────
(globalThis as any).Path2D = class Path2D {};
(globalThis as any).DOMMatrix = class DOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
};
(globalThis as any).Image = class Image {
  width = 0;
  height = 0;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => {
      if (this.onerror) this.onerror();
    }, 0);
  }
};

// ──────────────────────────────────────────
// 3. XMLHttpRequest (Stub)
// ──────────────────────────────────────────
(globalThis as any).XMLHttpRequest = class XMLHttpRequest {
  open() {}
  send() {}
};

// ──────────────────────────────────────────
// 4. Canvas polyfill (使用 node-canvas)
// ──────────────────────────────────────────
let canvasLoadError: string | null = null;

try {
  const { createCanvas, loadImage } = require('canvas');
  (globalThis as any).HTMLCanvasElement = (globalThis as any).HTMLCanvasElement || class {};
  (globalThis as any).createCanvas = createCanvas;
  (globalThis as any).loadImage = loadImage;
  canvasLoadError = null;
  console.log('[pdf-polyfills] Canvas polyfill loaded successfully');
} catch (err) {
  canvasLoadError = (err as Error).message;
  console.warn('[pdf-polyfills] Canvas polyfill not available:', canvasLoadError);
}

export function getCanvasDiagnostics(): { available: boolean; error: string | null } {
  return { available: canvasLoadError === null, error: canvasLoadError };
}

// ──────────────────────────────────────────
// 5. pdfjs-dist 全局配置
// ──────────────────────────────────────────
import * as path from 'path';

/**
 * 解析 pdf.worker.mjs 路径并设置 Worker
 *
 * 采用两级递进策略兼容开发环境、普通构建、以及 ASAR 打包环境：
 *   策略 1: 从 asar 中提取到临时目录，使用 file:// URL（离线可用、ESM loader 兼容）
 *   策略 2: 直接禁用 Worker，主线程运行（兜底）
 *
 * Electron 打包为 asar 后，ESM loader 限制只能加载 file:/data:/node: 协议的模块。
 * https:// CDN URL 被拒绝，因此必须将 Worker 文件提取到临时目录用 file:// 协议加载。
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as os from 'os';

/**
 * 标记 Worker 是否已成功配置（用于 getDocumentSafe 决定是否禁用 Worker）
 */
let _workerConfigured = false;
let _workerSetupError: string | null = null;

async function setupPdfWorker(): Promise<void> {
  const WORKER_FILENAME = 'pdf.worker.mjs';

  // ── 策略 1: 从 asar 中提取到临时目录，使用 file:// URL ──
  try {
    const workerInAsar = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const tmpDir = os.tmpdir();
    const extractedPath = path.join(tmpDir, 'term-manager-' + WORKER_FILENAME);
    const fs = require('fs');
    if (!fs.existsSync(extractedPath)) {
      fs.copyFileSync(workerInAsar, extractedPath);
      console.log('[pdf-polyfills] Worker extracted to temp:', extractedPath);
    } else {
      console.log('[pdf-polyfills] Worker already exists in temp:', extractedPath);
    }
    const fileUrl = pathToFileURL(extractedPath).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = fileUrl;
    _workerConfigured = true;
    console.log('[pdf-polyfills] GlobalWorkerOptions.workerSrc set to file:', fileUrl);
  } catch (e: any) {
    _workerSetupError = e?.message || String(e);
    console.warn('[pdf-polyfills] Worker extraction to temp failed:', _workerSetupError);
    // ── 策略 2: 直接禁用 Worker ──
    console.log('[pdf-polyfills] Worker will be disabled, PDF extraction runs on main thread');
  }
}

// 立即异步设置 Worker（不阻塞模块加载）
setupPdfWorker().catch(err => {
  console.error('[pdf-polyfills] Worker setup failed:', err);
});

// ──────────────────────────────────────────
// 6. Worker 加载失败的降级追踪
// ──────────────────────────────────────────

let _workerLoadFailed = false;

/**
 * PDF.js getDocument 的安全封装，自动处理 Worker 加载失败
 *
 * 当 Worker 加载失败时（asar ESM loader 限制、file:// 不可用等），
 * 自动降级为 disableWorker: true（主线程渲染），功能完整但单线程运行。
 */
async function getDocumentSafe(
  options: Record<string, any>
): Promise<any> {
  // 如果 Worker 未配置，或之前已确认不可用，直接禁用 Worker
  if (!_workerConfigured || _workerLoadFailed) {
    if (_workerLoadFailed) {
      console.log('[pdf-polyfills] Worker previously failed, using disableWorker: true');
    } else {
      console.log('[pdf-polyfills] Worker not configured, using disableWorker: true');
    }
    const task = pdfjsLib.getDocument({ ...options, disableWorker: true } as any);
    return (task as any).promise;
  }

  try {
    const task = pdfjsLib.getDocument(options as any);
    const doc = await (task as any).promise;
    return doc;
  } catch (error: any) {
    const msg = error?.message || String(error);
    // 检测是否是 Worker 相关的错误
    if (
      msg.includes('Setting up fake worker failed') ||
      msg.includes('Cannot find module') ||
      msg.includes('pdf.worker') ||
      msg.includes('Only URLs with a scheme') ||
      msg.includes('ESM loader') ||
      msg.includes('worker')
    ) {
      _workerLoadFailed = true;
      console.warn(
        '[pdf-polyfills] Worker load failed, retrying with disableWorker: true\n' +
        `  Error: ${msg.substring(0, 200)}`
      );

      // 直接降级：禁用 Worker
      console.log('[pdf-polyfills] Falling back to disableWorker: true');
      const fallbackTask = pdfjsLib.getDocument({ ...options, disableWorker: true } as any);
      return (fallbackTask as any).promise;
    }
    // 非 Worker 相关错误，直接抛出
    throw error;
  }
}

// ──────────────────────────────────────────
// 7. 导出 pdfjsLib 和辅助函数供其他模块使用
// ──────────────────────────────────────────
export { pdfjsLib, getDocumentSafe };

/**
 * 渲染 PDF 页面到图片 buffer（PNG 格式）
 * 使用 node-canvas（需要原生模块编译）
 */
export async function renderPageToImage(
  page: any,
  scale: number = 2.0
): Promise<Buffer> {
  const diagnostics = getCanvasDiagnostics();
  let canvasLib: any;
  try {
    canvasLib = require('canvas');
  } catch (e: any) {
    const detail = diagnostics.error || e?.message || 'unknown error';
    throw new Error(
      `Canvas library not available. ${detail}\n` +
      'Please rebuild canvas for Electron:\n' +
      '  1. Install ClangCL via Visual Studio Installer (C++ Clang tools for Windows), OR\n' +
      '  2. Downgrade Node.js to v20 LTS: nvm install 20 && nvm use 20\n' +
      '  3. Then run: npm rebuild canvas'
    );
  }

  const { createCanvas } = canvasLib;

  let viewport: any;
  if (typeof (page as any).getViewportRect === 'function') {
    const rect = (page as any).getViewportRect({ scale });
    viewport = { width: rect.width, height: rect.height };
  } else {
    viewport = page.getViewport({ scale });
  }

  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;

  return canvas.toBuffer('image/png');
}

/**
 * 渲染 PDF 页面为 SVG 字符串（零原生依赖）
 * 使用 pdfjs-dist 内置的 SVGGraphics 引擎，无需 canvas/node-gyp
 *
 * @param page - PDF.js page 对象
 * @param scale - 缩放比例（默认 2.0 以保证清晰度）
 * @returns SVG 字符串
 */
export async function renderPageToSVG(
  page: any,
  scale: number = 2.0
): Promise<string> {
  // pdfjs-dist 4.x 中 SVGGraphics 位于 pdfjs-dist/legacy/build/pdf.mjs
  // 需要通过 pdfjsLib 内部访问或单独 import
  let SVGGraphics: any;

  // 尝试不同的导入路径（pdfjs-dist 4.x）
  try {
    const svgMod = require('pdfjs-dist/legacy/build/pdf.mjs');
    SVGGraphics = svgMod.SVGGraphics;
  } catch {
    // 某些打包环境下路径不同
  }

  if (!SVGGraphics) {
    // fallback: 从 pdfjsLib 中获取
    SVGGraphics = (pdfjsLib as any).SVGGraphics;
  }

  if (!SVGGraphics) {
    throw new Error(
      'SVGGraphics not available from pdfjs-dist. ' +
      'Please ensure pdfjs-dist >= 4.0.0 is installed.'
    );
  }

  // 兼容两种 API：page.getViewport（旧版）或 page.getViewportRect（新版）
  let viewport: any;
  if (typeof (page as any).getViewportRect === 'function') {
    const rect = (page as any).getViewportRect({ scale });
    viewport = { width: rect.width, height: rect.height };
  } else {
    viewport = page.getViewport({ scale });
  }

  // 使用 pdfjs-dist 的 SVGGraphics 引擎渲染
  const svgGfx = new SVGGraphics(page.commonObjs, page.objs);
  svgGfx.embedFonts = false; // 避免嵌入字体导致 SVG 过大

  const svgRoot = await svgGfx.getSVG(page.getOperatorList(), viewport);

  if (!svgRoot) {
    throw new Error('SVGGraphics.getSVG returned null/undefined');
  }

  // 序列化 SVG DOM 为字符串
  // 在 Node.js 中，SVGGraphics 返回的是 @xmldom/xmldom 的 Document 对象
  let svgString: string;

  if (typeof (svgRoot as any).outerHTML === 'string') {
    svgString = (svgRoot as any).outerHTML;
  } else if (typeof (svgRoot as any).toString === 'function') {
    svgString = (svgRoot as any).toString();
  } else {
    // 使用 XMLSerializer（需要 xmldom polyfill，但 pdfjs-dist 内置了）
    try {
      const XMLSerializer = require('@xmldom/xmldom').XMLSerializer || globalThis.XMLSerializer;
      const serializer = new XMLSerializer();
      svgString = serializer.serializeToString(svgRoot);
    } catch {
      // 最后的 fallback：手动拼接基本 SVG 包装
      const width = viewport.width;
      const height = viewport.height;
      svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${String(svgRoot)}</svg>`;
    }
  }

  console.log(`[pdf-polyfills] Page rendered to SVG: ${svgString.length} chars, viewport ${viewport.width}x${viewport.height}`);
  return svgString;
}

// ──────────────────────────────────────────
// 8. 常用配置常量
// ──────────────────────────────────────────
export const PDFJS_STANDARD_FONTS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/';

/**
 * 从 PDF buffer 提取文本（文本型 PDF）
 * 使用 pdfjs-dist 4.x 的 getDocument API
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentSafe({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  });

  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const items = (content.items as any[]).sort((a, b) => {
      const yDiff = (b.transform?.[5] ?? 0) - (a.transform?.[5] ?? 0);
      if (Math.abs(yDiff) > 5) return yDiff;
      return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0);
    });

    let lineText = '';
    let lastY = -1;

    for (const item of items) {
      if (!item.str) continue;
      const y = item.transform?.[5] ?? 0;

      if (lastY !== -1 && Math.abs(y - lastY) > 3) {
        textParts.push(lineText.trim());
        lineText = '';
      }

      lineText += item.str + ' ';
      lastY = y;
    }
    if (lineText.trim()) {
      textParts.push(lineText.trim());
    }

    textParts.push('');
  }

  return textParts.join('\n').trim();
}