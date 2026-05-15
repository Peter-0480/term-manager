/**
 * AI Vision PDF 抽取模块
 * 利用视觉大模型（GPT-4o / Claude 3.5 Sonnet 等）直接「读取」PDF 页面图像，
 * 支持文本型 PDF 和扫描型（图片）PDF，无需本地 OCR 引擎。
 *
 * 工作流：
 * 1. 将 PDF 文件分页渲染为 PNG 图像
 * 2. 逐个页面作为图像发送给 AI 视觉模型
 * 3. AI 直接提取其中的专业术语并提供翻译建议
 * 4. 合并所有页面的结果并返回结构化 ExtractedTerm 数组
 */

import fs from 'fs';
import { AIConfig, getFullEndpoint } from './ai-client';
import { ExtractedTerm } from './term-engine';
import { APIResponseHandler } from './api-response-handler';

export interface AIExtractionProgress {
  currentPage: number;
  totalPages: number;
  stage: 'rendering' | 'extracting' | 'complete' | 'error';
  message?: string;
}

export type AIExtractionProgressCallback = (progress: AIExtractionProgress) => void;

/**
 * 将 PDF 文件的一页渲染为 PNG Buffer
 * 使用 pdfjs-dist 渲染页面 + node-canvas 输出 PNG
 */
async function renderPDFPageAsImage(
  pdfData: Uint8Array,
  pageNum: number,
  scale: number = 1.5
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { createRequire } = await import('module');
  const nodeRequire = createRequire(import.meta.url || __filename);
  const pdfjsLib: any = nodeRequire('pdfjs-dist/legacy/build/pdf.js');

  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // 使用 node-canvas 创建渲染画布
  let canvas: any;
  try {
    // 尝试使用 node-canvas（如果已安装）
    const { createCanvas } = nodeRequire('canvas');
    canvas = createCanvas(viewport.width, viewport.height);
  } catch {
    // 降级：仅提取文本内容
    console.warn(`[PDF AI Extractor] node-canvas not available, falling back to text extraction for page ${pageNum}`);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str ?? '').join(' ');
    return { buffer: Buffer.from(text, 'utf-8'), width: viewport.width, height: viewport.height };
  }

  const ctx = canvas.getContext('2d');
  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;

  const buffer = canvas.toBuffer('image/png');
  return { buffer, width: viewport.width, height: viewport.height };
}

/**
 * 将 Buffer 转换为 Base64 Data URL
 */
function bufferToDataURL(buffer: Buffer, mimeType: string = 'image/png'): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 调用 AI Vision API 从单页图像中提取术语
 * 支持 OpenAI Vision 格式和 Anthropic Vision 格式
 */
async function extractTermsFromPageImageViaAI(
  imageDataURL: string,
  pageNum: number,
  totalPages: number,
  language: string,
  aiConfig: AIConfig
): Promise<ExtractedTerm[]> {
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

  console.log(`[PDF AI Extractor] Sending page ${pageNum}/${totalPages} to AI vision model (${provider}, ${model})`);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    let requestBody: any;
    let response: Response;

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';

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
                  media_type: 'image/png',
                  data: imageDataURL.split(',')[1], // Anthropic uses raw base64
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
      // OpenAI / DeepSeek 兼容格式
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
                  url: imageDataURL,
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
      console.error(`[PDF AI Extractor] API error for page ${pageNum}: HTTP ${response.status}, ${errorText.substring(0, 200)}`);
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

    // 解析 AI 返回的 JSON
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
 * 通过 AI Vision 模式从 PDF 文件中抽取术语
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

  const pdfData = fs.readFileSync(filePath);
  const uint8data = new Uint8Array(pdfData);

  // 获取 PDF 总页数
  const { createRequire } = await import('module');
  const nodeRequire = createRequire(import.meta.url || __filename);
  const pdfjsLib: any = nodeRequire('pdfjs-dist/legacy/build/pdf.js');
  const loadingTask = pdfjsLib.getDocument({ data: uint8data });
  const pdf = await loadingTask.promise;
  const totalPages = Math.min(pdf.numPages, maxPages);

  console.log(`[PDF AI Extractor] PDF has ${pdf.numPages} pages, processing up to ${totalPages}`);

  if (totalPages === 0) {
    throw new Error('PDF 文件没有可处理的页面');
  }

  const allTerms: ExtractedTerm[] = [];
  const seenTerms = new Set<string>();

  // 逐页处理
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({
      currentPage: pageNum,
      totalPages,
      stage: 'rendering',
      message: `正在渲染第 ${pageNum}/${totalPages} 页...`,
    });

    let imageDataURL: string;

    try {
      // 渲染页面为图像
      const { buffer, width, height } = await renderPDFPageAsImage(uint8data, pageNum);
      console.log(`[PDF AI Extractor] Page ${pageNum}: rendered ${width}x${height}, buffer ${buffer.length} bytes`);

      // 检查是否使用了降级模式（返回文本而非图像）
      const isTextOnly = buffer[0] !== 0x89; // PNG magic number check
      if (isTextOnly) {
        // 降级模式：提取到的是文本，直接使用
        const textContent = buffer.toString('utf-8');
        console.log(`[PDF AI Extractor] Page ${pageNum}: using text-only extraction (${textContent.length} chars)`);

        if (textContent.trim().length > 10) {
          // 发送文本到 AI 进行术语提取
          const terms = await extractTermsFromTextViaAI(textContent, language, aiConfig, pageNum);
          for (const term of terms) {
            const key = `${term.term_text}:${term.source_lang}`;
            if (!seenTerms.has(key)) {
              seenTerms.add(key);
              allTerms.push(term);
            }
          }
        }
        onProgress?.({
          currentPage: pageNum,
          totalPages,
          stage: 'complete',
          message: `第 ${pageNum}/${totalPages} 页完成（文本模式）`,
        });
        continue;
      }

      // 正常图像模式
      imageDataURL = bufferToDataURL(buffer);

      onProgress?.({
        currentPage: pageNum,
        totalPages,
        stage: 'extracting',
        message: `正在 AI 提取第 ${pageNum}/${totalPages} 页...`,
      });

      const terms = await extractTermsFromPageImageViaAI(
        imageDataURL,
        pageNum,
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
        message: `第 ${pageNum}/${totalPages} 页完成（含 ${terms.length} 个术语）`,
      });
    } catch (pageError) {
      console.error(`[PDF AI Extractor] Error processing page ${pageNum}:`, pageError);
      onProgress?.({
        currentPage: pageNum,
        totalPages,
        stage: 'error',
        message: `第 ${pageNum}/${totalPages} 页处理失败: ${pageError instanceof Error ? pageError.message : String(pageError)}`,
      });
      // 继续处理下一页
      continue;
    }
  }

  // 按分数排序并去重
  const result = allTerms
    .sort((a, b) => b.score - a.score)
    .slice(0, 500);

  console.log(`[PDF AI Extractor] Completed: ${result.length} unique terms from ${totalPages} pages`);
  return result;
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