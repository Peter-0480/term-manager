/**
 * AI Vision PDF 抽取模块
 * 利用视觉大模型（GPT-4o / Claude 3.5 Sonnet 等）直接「读取」PDF 页面图像，
 * 支持文本型 PDF 和扫描型（图片）PDF，无需本地 OCR 引擎。
 *
 * 工作流：
 * 1. 将 PDF 文件分页渲染为图像（PNG 优先，SVG 降级）
 * 2. 逐个页面作为图像发送给 AI 视觉模型
 * 3. AI 直接提取其中的专业术语并提供翻译建议
 * 4. 合并所有页面的结果并返回结构化 ExtractedTerm 数组
 *
 * 渲染优先级（图片型 PDF）：
 *   Canvas 可用 → PNG 渲染 → AI Vision
 *   Canvas 不可用 → SVG 渲染（零原生依赖）→ AI Vision
 */

import fs from 'fs';
import { AIConfig, getFullEndpoint } from './ai-client';
import { ExtractedTerm } from './term-engine';
import { APIResponseHandler } from './api-response-handler';
import {
  pdfjsLib,
  getDocumentSafe,
  renderPageToImage,
  renderPageToSVG,
  PDFJS_STANDARD_FONTS_URL,
  getCanvasDiagnostics,
} from './pdf-polyfills';

export interface AIExtractionProgress {
  currentPage: number;
  totalPages: number;
  stage: 'rendering' | 'extracting' | 'complete' | 'error';
  message?: string;
}

export type AIExtractionProgressCallback = (progress: AIExtractionProgress) => void;

/**
 * 将 Buffer 转换为 Base64 Data URL
 */
function bufferToDataURL(buffer: Buffer, mimeType: string = 'image/png'): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 将 SVG 字符串转为 Base64 Data URL
 */
function svgToDataURL(svgString: string): string {
  const base64 = Buffer.from(svgString, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * 清理 SVG 字符串中的潜在问题（如非法的 XML 字符）
 */
function sanitizeSVG(svg: string): string {
  return svg
    .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u10000-\u10FFFF]/g, '')
    .trim();
}

/**
 * 将 PDF 文件的一页渲染为可发送给 AI 的图像数据
 *
 * 工作流：
 *   1. 先用 getTextContent() 尝试读取文本层 → textFragments
 *   2. 尝试 Canvas 渲染 → PNG buffer
 *   3. Canvas 不可用时降级到 SVG 渲染 → SVG string
 *   4. 最终返回统一的 { dataURL, mediaType, isImage } 描述
 */
interface PageRenderResult {
  pageNum: number;
  /** 可渲染的图像 dataURL（PNG 或 SVG） */
  dataURL: string;
  /** MIME 类型：image/png 或 image/svg+xml */
  mediaType: 'image/png' | 'image/svg+xml';
  /** 是否为图像（vs 纯文本降级） */
  isImage: boolean;
  /** 尺寸信息 */
  width: number;
  height: number;
  /** 文本内容（如果有文本层的话） */
  textContent: string;
}
async function renderPDFPage(
  pdfData: Uint8Array,
  pageNum: number,
  scale: number = 1.5
): Promise<PageRenderResult> {
  const pdf = await getDocumentSafe({
    data: pdfData,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  });
  const page = await pdf.getPage(pageNum);

  // 获取 viewport
  let viewport: any;
  if (typeof (page as any).getViewportRect === 'function') {
    const rect = (page as any).getViewportRect({ scale });
    viewport = { width: rect.width, height: rect.height };
  } else {
    viewport = page.getViewport({ scale });
  }

  // ── 先提取文本层 ──
  let textContent = '';
  try {
    const tc = await page.getTextContent();
    textContent = tc.items
      .map((item: any) => item.str ?? '')
      .join(' ')
      .trim();
  } catch {
    textContent = '';
  }

  // ── 路径 A: Canvas → PNG（最优）──
  try {
    const pngBuffer = await renderPageToImage(page, scale);
    const dataURL = bufferToDataURL(pngBuffer, 'image/png');
    console.log(
      `[PDF AI Extractor] Page ${pageNum}: rendered as ${viewport.width}x${viewport.height} PNG (${pngBuffer.length} bytes), text=${textContent.length} chars`
    );
    return {
      pageNum,
      dataURL,
      mediaType: 'image/png',
      isImage: true,
      width: viewport.width,
      height: viewport.height,
      textContent,
    };
  } catch (canvasError: any) {
    const msg = canvasError?.message || String(canvasError);
    console.warn(
      `[PDF AI Extractor] Page ${pageNum}: Canvas 渲染失败 → ${msg.substring(0, 120)}\n` +
      `   尝试 SVG 降级渲染（零原生依赖）...`
    );
  }

  // ── 路径 B: SVG 渲染（零原生依赖降级）──
  try {
    const svgString = await renderPageToSVG(page, scale);
    const cleaned = sanitizeSVG(svgString);
    const dataURL = svgToDataURL(cleaned);
    console.log(
      `[PDF AI Extractor] Page ${pageNum}: rendered as ${viewport.width}x${viewport.height} SVG (${cleaned.length} chars), text=${textContent.length} chars`
    );
    return {
      pageNum,
      dataURL,
      mediaType: 'image/svg+xml',
      isImage: true,
      width: viewport.width,
      height: viewport.height,
      textContent,
    };
  } catch (svgError: any) {
    const svgMsg = svgError?.message || String(svgError);
    console.error(
      `[PDF AI Extractor] Page ${pageNum}: SVG 渲染也失败 → ${svgMsg.substring(0, 120)}\n` +
      `   回退到纯文本模式。`
    );
  }

  // ── 路径 C: 纯文本降级 ──
  console.log(
    `[PDF AI Extractor] Page ${pageNum}: 无法渲染为图像，使用纯文本 (${textContent.length} chars)`
  );
  return {
    pageNum,
    dataURL: '',
    mediaType: 'image/png',
    isImage: false,
    width: viewport.width,
    height: viewport.height,
    textContent,
  };
}

/**
 * 调用 AI Vision API 从单页图像中提取术语
 * 支持 OpenAI Vision 格式和 Anthropic Vision 格式
 */
async function extractTermsFromPageImageViaAI(
  pageResult: PageRenderResult,
  totalPages: number,
  language: string,
  aiConfig: AIConfig
): Promise<ExtractedTerm[]> {
  const { dataURL, mediaType, pageNum, isImage } = pageResult;
  const { endpoint, model, provider } = getFullEndpoint(aiConfig);
  const apiKey = aiConfig.apiKey!;

  const prompt = `You are an expert terminology extraction assistant.
Please analyze this image of a PDF document page (page ${pageNum} of ${totalPages}).

Your task:
1. Read ALL visible text in the image, whether it's text-based or from a scanned copy.
2. Identify professional/specialized terms, domain-specific terminology, and key phrases.
3. For each term, provide the term text, source language, and a relevance score (0-10).
4. If the term has an obvious translation in the target language, provide it.
5. Ignore headers, footers, page numbers, and common stop words.

Language context: ${language === 'auto' ? 'Detect automatically' : language === 'zh' ? 'Chinese document with English terms mixed' : 'English document'}
Target translation language: ${language === 'zh' ? 'English (en)' : 'Chinese (zh)'}

Return ONLY a valid JSON array with this structure:
[
  {
    "term_text": "the original term",
    "source_lang": "zh" or "en",
    "score": 8,
    "target_term": "translation if applicable (omit if unsure)",
    "target_lang": "en" or "zh (omit if no translation)"
  }
]

Rules:
- Return ONLY valid JSON, nothing else
- Each term must be at least 2 characters
- Score 1-10 based on domain relevance
- Maximum 30 terms per page
- If a term is unrecognizable/ambiguous, skip it`;

  console.log(
    `[PDF AI Extractor] Sending page ${pageNum}/${totalPages} to AI vision model (${provider}, ${model}, ${mediaType})`
  );

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    let requestBody: any;
    let response: Response;

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';

      // Anthropic: 使用 base64（不带 data: 前缀）
      const rawBase64 = dataURL.split(',')[1] || '';
      const anthropicMediaType = mediaType === 'image/svg+xml' ? 'image/png' : mediaType;
      // 注意: Anthropic 不原生支持 image/svg+xml，降级为 image/png

      requestBody = {
        model: model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: anthropicMediaType,
                  data: rawBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        temperature: 0.1,
      };

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    } else {
      // OpenAI / DeepSeek 兼容格式（支持 image/svg+xml）
      headers['Authorization'] = `Bearer ${apiKey}`;

      requestBody = {
        model: model,
        max_tokens: 2000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: dataURL,
                  detail: 'high',
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      };

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[PDF AI Extractor] API error for page ${pageNum}: HTTP ${response.status}, ${errorText.substring(0, 200)}`
      );
      throw new Error(`AI vision API error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    let aiText = '';

    if (provider === 'anthropic') {
      aiText = payload?.content?.[0]?.text || '';
    } else {
      aiText = payload?.choices?.[0]?.message?.content || '';
    }

    if (!aiText) {
      console.warn(`[PDF AI Extractor] Empty AI response for page ${pageNum}`);
      return [];
    }

    console.log(`[PDF AI Extractor] Page ${pageNum}: AI response length ${aiText.length}`);

    const parsed = APIResponseHandler.parseJsonResponse(aiText);
    if (!Array.isArray(parsed)) {
      console.warn(`[PDF AI Extractor] Page ${pageNum}: AI response is not a valid JSON array`);
      return [];
    }

    const terms: ExtractedTerm[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      if (!item.term_text || typeof item.term_text !== 'string') continue;

      const term: ExtractedTerm = {
        term_text: String(item.term_text).trim(),
        source_lang: item.source_lang === 'zh' ? 'zh' : 'en',
        score: Math.max(1, Math.min(10, Number(item.score) || 5)),
      };

      if (item.target_term && typeof item.target_term === 'string') {
        (term as any).target_term = item.target_term.trim();
      }
      if (item.target_lang && typeof item.target_lang === 'string') {
        (term as any).target_lang = item.target_lang.trim();
      }

      terms.push(term);
    }

    console.log(`[PDF AI Extractor] Page ${pageNum}: extracted ${terms.length} terms`);
    return terms;
  } catch (error) {
    console.error(`[PDF AI Extractor] Extraction error for page ${pageNum}:`, error);
    throw error;
  }
}

/**
 * 通过 AI 从纯文本中提取术语（降级模式使用）
 */
async function extractTermsFromTextViaAI(
  text: string,
  language: string,
  aiConfig: AIConfig,
  context: number
): Promise<ExtractedTerm[]> {
  const { endpoint, model, provider } = getFullEndpoint(aiConfig);
  const apiKey = aiConfig.apiKey!;

  const prompt = `You are an expert terminology extraction assistant.
Extract professional/specialized terms from the following text (from page ${context} of a PDF document).

Language context: ${language === 'auto' ? 'Auto-detect' : language}
Return ONLY valid JSON array:
[{"term_text": "...", "source_lang": "zh"|"en", "score": 1-10, "target_term": "..." (optional), "target_lang": "en"|"zh" (optional)}]

Text:
${text.substring(0, 3000)}`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let requestBody: any;

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      requestBody = { model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }], temperature: 0.1 };
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
      requestBody = { model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }], temperature: 0.1 };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`API error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const aiText = provider === 'anthropic'
      ? payload?.content?.[0]?.text || ''
      : payload?.choices?.[0]?.message?.content || '';

    const parsed = APIResponseHandler.parseJsonResponse(aiText);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: any) => item && typeof item === 'object' && typeof item.term_text === 'string')
      .map((item: any): ExtractedTerm => ({
        term_text: String(item.term_text).trim(),
        source_lang: item.source_lang === 'zh' ? 'zh' : 'en',
        score: Math.max(1, Math.min(10, Number(item.score) || 5)),
        ...(item.target_term ? { target_term: String(item.target_term).trim() } as any : {}),
        ...(item.target_lang ? { target_lang: String(item.target_lang).trim() } as any : {}),
      }));
  } catch (error) {
    console.error(`[PDF AI Extractor] Text extraction error for page ${context}:`, error);
    return [];
  }
}

/**
 * 通过 AI Vision 模式从 PDF 文件中抽取术语
 *
 * 支持 3 种渲染路径：
 *   1. Canvas → PNG → AI Vision（最佳，需要 node-canvas 原生模块）
 *   2. SVG → SVG Data URL → AI Vision（降级，零原生依赖，pdfjs-dist 内置）
 *   3. 纯文本 → AI 文本提取（fallback，适用于有文本层的 PDF）
 *
 * @param filePath PDF 文件路径
 * @param language 源语言
 * @param aiConfig AI 配置
 * @param onProgress 进度回调
 * @param maxPages 最大处理页数（默认 50，防止超长文档处理过久）
 * @returns 结构化术语数组
 */
export async function extractTermsFromPDFViaAI(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  aiConfig: AIConfig,
  onProgress?: AIExtractionProgressCallback,
  maxPages: number = 50
): Promise<ExtractedTerm[]> {
  if (!aiConfig.apiKey) {
    throw new Error('AI API Key 未配置，无法使用 AI Vision PDF 抽取');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF 文件不存在: ${filePath}`);
  }

  console.log(`[PDF AI Extractor] Starting AI vision extraction for: ${filePath}`);

  // 诊断 canvas 可用性
  const canvasDiag = getCanvasDiagnostics();
  if (canvasDiag.available) {
    console.log('[PDF AI Extractor] ✅ Canvas 可用，将使用 PNG 渲染');
  } else {
    console.warn(
      `[PDF AI Extractor] ⚠️  Canvas 不可用: ${canvasDiag.error}\n` +
      `   将使用 SVG 渲染路径（零原生依赖）处理图片型 PDF。`
    );
  }

  const pdfData = fs.readFileSync(filePath);
  const uint8data = new Uint8Array(pdfData);

  const pdf = await getDocumentSafe({
    data: uint8data,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  });
  const totalPages = Math.min(pdf.numPages, maxPages);

  console.log(`[PDF AI Extractor] PDF has ${pdf.numPages} pages, processing up to ${totalPages}`);

  if (totalPages === 0) {
    throw new Error('PDF 文件没有可处理的页面');
  }

  const allTerms: ExtractedTerm[] = [];
  const seenTerms = new Set<string>();
  let skippedCount = 0;
  let svgRenderedCount = 0;
  let pngRenderedCount = 0;
  let textOnlyCount = 0;

  // 逐页处理
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({
      currentPage: pageNum,
      totalPages,
      stage: 'rendering',
      message: `正在渲染第 ${pageNum}/${totalPages} 页...`,
    });

    try {
      const pageResult = await renderPDFPage(uint8data, pageNum);

      if (pageResult.isImage) {
        // ── 图像模式（PNG 或 SVG）──
        if (pageResult.mediaType === 'image/svg+xml') {
          svgRenderedCount++;
        } else {
          pngRenderedCount++;
        }

        onProgress?.({
          currentPage: pageNum,
          totalPages,
          stage: 'extracting',
          message: `正在 AI 提取第 ${pageNum}/${totalPages} 页（${pageResult.mediaType === 'image/svg+xml' ? 'SVG' : 'PNG'} 模式）...`,
        });

        const terms = await extractTermsFromPageImageViaAI(
          pageResult,
          totalPages,
          language,
          aiConfig
        );

        for (const term of terms) {
          const key = `${term.term_text}:${term.source_lang}`;
          if (!seenTerms.has(key)) {
            seenTerms.add(key);
            allTerms.push(term);
          }
        }

        onProgress?.({
          currentPage: pageNum,
          totalPages,
          stage: 'complete',
          message: `第 ${pageNum}/${totalPages} 页完成（${pageResult.mediaType === 'image/svg+xml' ? 'SVG' : 'PNG'} 视觉模式，${terms.length} 术语）`,
        });
      } else {
        // ── 纯文本模式 ──
        const text = pageResult.textContent;
        textOnlyCount++;

        if (text.length >= 10) {
          console.log(`[PDF AI Extractor] Page ${pageNum}: 纯文本模式 (${text.length} chars)`);
          const terms = await extractTermsFromTextViaAI(text, language, aiConfig, pageNum);
          for (const term of terms) {
            const key = `${term.term_text}:${term.source_lang}`;
            if (!seenTerms.has(key)) {
              seenTerms.add(key);
              allTerms.push(term);
            }
          }
          onProgress?.({
            currentPage: pageNum,
            totalPages,
            stage: 'complete',
            message: `第 ${pageNum}/${totalPages} 页完成（文本模式，${terms.length} 术语）`,
          });
        } else if (text.length === 0) {
          skippedCount++;
          console.warn(
            `[PDF AI Extractor] ⚠️  第 ${pageNum}/${totalPages} 页跳过: 无可提取文本且无法渲染图像\n` +
            `   请确认:\n` +
            `   1. Node.js 版本兼容 (推荐 v20 LTS)\n` +
            `   2. 已安装 canvas: npm install canvas\n` +
            `   3. 已为 Electron 重新编译: npx electron-rebuild -f -w canvas`
          );
          onProgress?.({
            currentPage: pageNum,
            totalPages,
            stage: 'error',
            message: `第 ${pageNum}/${totalPages} 页跳过: 无法渲染且无文本层`,
          });
        } else {
          console.warn(
            `[PDF AI Extractor] ⚠️  第 ${pageNum}/${totalPages} 页跳过: 文本过短 (${text.length} chars)`
          );
          onProgress?.({
            currentPage: pageNum,
            totalPages,
            stage: 'complete',
            message: `第 ${pageNum}/${totalPages} 页完成（文本过短，跳过）`,
          });
        }
      }
    } catch (pageError) {
      console.error(`[PDF AI Extractor] Error processing page ${pageNum}:`, pageError);
      onProgress?.({
        currentPage: pageNum,
        totalPages,
        stage: 'error',
        message: `第 ${pageNum}/${totalPages} 页处理失败: ${
          pageError instanceof Error ? pageError.message : String(pageError)
        }`,
      });
      continue;
    }
  }

  // 汇总日志
  console.log(
    `[PDF AI Extractor] 渲染统计: ${pngRenderedCount} PNG + ${svgRenderedCount} SVG + ${textOnlyCount} 纯文本 + ${skippedCount} 跳过`
  );

  if (skippedCount === totalPages && allTerms.length === 0) {
    console.warn(
      `[PDF AI Extractor] ⚠️  PDF 全部 ${totalPages} 页无法处理。\n` +
      `   可能原因:\n` +
      `   1. PDF 为纯图片扫描版，且 SVG 渲染也失败\n` +
      `   2. 无 AI Vision API Key 或配置错误\n` +
      `   建议:\n` +
      `   - 安装 Canvas 原生模块: npm install canvas\n` +
      `   - 为 Electron 重新编译: npx electron-rebuild -f -w canvas\n` +
      `   - 确保 AI API Key 配置了支持 Vision 的模型（如 GPT-4o、Claude 3.5）`
    );
  }

  // 按分数排序并去重
  const result = allTerms.sort((a, b) => b.score - a.score).slice(0, 500);

  console.log(
    `[PDF AI Extractor] Completed: ${result.length} unique terms from ${totalPages} pages`
  );
  return result;
}