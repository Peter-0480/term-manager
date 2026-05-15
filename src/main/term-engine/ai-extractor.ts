/**
 * AI 增强抽取模块
 * 负责通过大模型进行智能术语抽取
 * 从 smart-extractor.ts 中拆分出来
 */

import {
  AIConfig, ExtractionStrategy, ExtractedTerm, SmartExtractionResult,
  DEFAULT_STRATEGY, AIChunkExtractionRequest, ProgressReporter,
} from './types';
import { getTerms, getDomains } from '../database';
import { getFullEndpoint, validateAIConfig as checkAIConfig } from '../ai-client';
import { globalRequestMerger } from '../api-cache-manager';
import { aiFetch, buildAIBody, extractContentFromResponse } from '../ai-fetch';
import { APIResponseHandler } from '../api-response-handler';
import { detectBilingualContent } from './bilingual-extractor';

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function calculateSimilarity(term1: string, term2: string): number {
  const set1 = new Set(term1.toLowerCase().split(''));
  const set2 = new Set(term2.toLowerCase().split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function findSimilarTerms(
  candidate: string,
  existingTerms: string[],
  threshold: number = 0.7
): { term: string; similarity: number }[] {
  const results: { term: string; similarity: number }[] = [];
  for (const existingTerm of existingTerms) {
    const similarity = calculateSimilarity(candidate, existingTerm);
    if (similarity >= threshold) {
      results.push({ term: existingTerm, similarity });
    }
  }
  return results.sort((a, b) => b.similarity - a.similarity);
}

// ═══════════════════════════════════════════
// AI 调用核心
// ═══════════════════════════════════════════

/**
 * 实际调用AI进行术语抽取
 */
async function callAITermExtraction(
  prompt: string,
  aiConfig?: AIConfig,
  textChunk?: string,
  language?: string,
  abortSignal?: AbortSignal,
): Promise<ExtractedTerm[]> {
  try {
    if (!aiConfig) {
      console.warn('[AI Extractor] No AI config provided, using empty results');
      return [];
    }

    const configCheck = checkAIConfig(aiConfig);
    if (!configCheck.valid) {
      console.warn('[AI Extractor] AI config invalid:', configCheck.reason);
      return [];
    }

    const { endpoint, model } = getFullEndpoint(aiConfig);
    const apiKey = aiConfig.apiKey;

    if (!apiKey) {
      console.warn('[AI Extractor] API key not configured');
      return [];
    }

    const requestBody = buildAIBody(prompt, model, endpoint, {
      maxTokens: 4000,
      temperature: 0.1,
    });

    const response = await aiFetch(endpoint, apiKey, requestBody, {
      timeout: 60000,
      retries: 1,
      retryDelay: 1000,
      signal: abortSignal,
      retryOnTimeout: false,
    });

    if (!response.ok) {
      console.warn(`[AI Extractor] AI API request failed: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    const content = extractContentFromResponse(data, endpoint);

    if (!content) {
      console.warn('[AI Extractor] Empty AI response content');
      return [];
    }

    const parsed = APIResponseHandler.parseJsonResponse(content);
    return parsed;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AI Extractor] AI call error: ${errorMsg}`);
    return [];
  }
}

// ═══════════════════════════════════════════
// 分块处理
// ═══════════════════════════════════════════

/**
 * 将长文本分块，避免超出AI模型token限制
 */
function chunkTextForAI(text: string, chunkSize: number = 6000, language: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ═══════════════════════════════════════════
// [方案B] 概念首倡语言后处理
// ═══════════════════════════════════════════

/**
 * 根据术语内容判断其"概念首倡语言"
 * 例如：AI、API、HTTP 等术语的首倡语言是英语
 * 而 "依法治国" 的首倡语言是中文
 */
function postCheckSourceLanguage(term: ExtractedTerm): ExtractedTerm {
  // 如果术语主要是英文字母/缩写，判定为英文源
  if (/^[A-Za-z0-9\s\-\+\/]+$/.test(term.term_text) && term.term_text.length > 1) {
    const alphaOnly = term.term_text.replace(/[^a-zA-Z]/g, '');
    if (alphaOnly.length >= 2) {
      term.source_lang = 'en';
    }
  }

  // 如果术语包含明显的中文特征，判定为中文源
  if (/[\u4e00-\u9fa5]/.test(term.term_text)) {
    term.source_lang = 'zh';
  }

  return term;
}

// ═══════════════════════════════════════════
// [方案C] 翻译价值评分模型 V2
// ═══════════════════════════════════════════

function calculateTranslationValueV2(term: ExtractedTerm, _language: string): number {
  let value = 0;

  // 有译文的加分
  if (term.target_term && term.target_term.length > 0) {
    value += 3;
  }

  // 长术语（可能需要专业知识才能翻译）加分
  if (term.term_text.length >= 5) value += 2;
  if (term.term_text.length >= 10) value += 1;

  // 包含专有名词特征（大写字母开头）
  if (/[A-Z]/.test(term.term_text)) value += 2;

  // 基础分 + 置信度影响
  value += Math.min(4, term.score / 2.5);

  return Math.min(10, value);
}

// ═══════════════════════════════════════════
// 智能去重
// ═══════════════════════════════════════════

function smartDeduplicateTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
  const unique: ExtractedTerm[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const normalized = term.term_text.toLowerCase().trim();
    if (seen.has(normalized)) continue;

    // 检查是否与已存在的术语高度相似
    let isDuplicate = false;
    for (const existing of unique) {
      const existingNorm = existing.term_text.toLowerCase().trim();
      if (calculateSimilarity(normalized, existingNorm) > 0.85) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(normalized);
      unique.push(term);
    }
  }

  return unique;
}

// ═══════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════

function buildSystemInstruction(
  language: string,
  existingTerms: string[],
  domainInfo: any,
  _strategy: ExtractionStrategy,
  isBilingual: boolean,
  detectedLangs: string,
): string {
  const existingTermsSample = existingTerms.slice(0, 20).join(', ');
  const domainContext = domainInfo ? `领域：${domainInfo.name}` : '通用领域';
  const bilingualHint = isBilingual
    ? `\n检测到多语言：${detectedLangs}`
    : '';

  return `你是一位术语抽取专家，为中文母语译者服务。
现有术语库示例：${existingTermsSample || '无'}
${domainContext}${bilingualHint}

要求输出JSON格式：[{"term_text": "...", "source_lang": "...", "score": 0-10, "target_term": "..."}]
- 单语文本中，target_term 设为 null
- 不要编造翻译
- 只抽取有术语价值的词条`;
}

function buildChunkPrompt(chunk: string, systemInstruction: string): string {
  return `${systemInstruction}

请从以下文本片段中抽取术语：
---
${chunk}
---`;
}

function buildExtractionPrompt(
  text: string,
  _language: string,
  existingTerms: string[],
  domainInfo: any,
  strategy: ExtractionStrategy,
  isBilingual: boolean = false,
  detectedLangs: string = '',
): string {
  return buildSystemInstruction(
    _language, existingTerms, domainInfo, strategy, isBilingual, detectedLangs
  ) + `\n\n请从以下文本中抽取术语：\n---\n${text}\n---`;
}

// ═══════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════

/**
 * 智能AI抽取 - 直接使用大模型进行术语识别
 */
export async function extractWithAI(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  console.log(`[AI Extractor] Starting, text length: ${text.length}, language: ${language}`);

  const cacheKey = `ai-extraction:${language}:${strategy.mode}:${strategy.domainId || 'none'}:${text.length > 100 ? simpleHash(text.substring(0, 100)) : text}`;

  return globalRequestMerger.mergeRequest(cacheKey, async () => {
    return await performAIExtraction(text, language, strategy);
  });
}

/**
 * 实际执行AI抽取的内部函数
 */
async function performAIExtraction(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  const existingTerms = getTerms({ pageSize: 1000 });
  const existingTermTexts = existingTerms.rows?.map((t: any) => t.term_text) || [];
  const domains = getDomains();

  const domainInfo = strategy.domainId
    ? domains.find((d: any) => d.id === strategy.domainId)
    : null;

  const bilingualCheck = detectBilingualContent(text);
  const isBilingual = bilingualCheck.isBilingual;
  const detectedLangs = bilingualCheck.languages
    .map(l => `${l.lang}(${(l.ratio * 100).toFixed(0)}%)`)
    .join(', ');

  const prompt = buildExtractionPrompt(
    text, language, existingTermTexts, domainInfo,
    strategy, isBilingual, detectedLangs
  );

  try {
    const shouldChunk = text.length > 15000;
    let allAiTerms: ExtractedTerm[] = [];

    if (shouldChunk) {
      console.log(`[AI Extractor] Chunked processing (${text.length} chars)`);

      const chunks = chunkTextForAI(text, 6000, language);
      const systemInstruction = buildSystemInstruction(
        language, existingTermTexts, domainInfo,
        strategy, isBilingual, detectedLangs
      );

      const CHUNK_TIMEOUT_MS = 90000;

      const chunkPromises = chunks.map((chunk, i) => {
        const chunkHash = simpleHash(chunk.substring(0, 200));
        const mergeKey = `chunk-extraction:${language}:${strategy.domainId || 'none'}:${chunkHash}`;

        const chunkAbortController = new AbortController();
        const chunkTimeoutId = setTimeout(() => {
          console.warn(`[AI Extractor] Chunk ${i + 1} timeout`);
          chunkAbortController.abort();
        }, CHUNK_TIMEOUT_MS);

        return globalRequestMerger.mergeRequest(mergeKey, async () => {
          const chunkPrompt = buildChunkPrompt(chunk, systemInstruction);
          const chunkTerms = await callAITermExtraction(
            chunkPrompt, strategy.aiConfig, chunk, language,
            chunkAbortController.signal
          );
          clearTimeout(chunkTimeoutId);
          return chunkTerms;
        }).catch(chunkError => {
          clearTimeout(chunkTimeoutId);
          console.error(`[AI Extractor] Chunk ${i + 1} error:`, chunkError);
          return [] as ExtractedTerm[];
        });
      });

      const chunkResults = await Promise.allSettled(chunkPromises);

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          allAiTerms.push(...result.value);
        }
      }

      allAiTerms = smartDeduplicateTerms(allAiTerms);
    } else {
      allAiTerms = await callAITermExtraction(prompt, strategy.aiConfig, text, language);
    }

    // 方案B: 概念首倡语言后处理
    allAiTerms = allAiTerms.map(term => postCheckSourceLanguage(term));

    // 后处理：添加元数据
    const results: SmartExtractionResult[] = allAiTerms.map((term) => {
      const similarTerms = findSimilarTerms(
        term.term_text,
        existingTermTexts,
        strategy.similarityThreshold
      );
      const isExisting = similarTerms.length > 0;
      const confidence = term.score / 10;
      const translationValue = calculateTranslationValueV2(term, language);

      return {
        ...term,
        confidence,
        isExistingTerm: isExisting,
        translationValue,
        domainMatch: strategy.domainId || undefined,
      };
    });

    return results.slice(0, strategy.maxResults || 300);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[AI Extractor] Extraction failed:', errorMessage);

    if (errorMessage.includes('API Key未配置') ||
        errorMessage.includes('API配置不完整') ||
        errorMessage.includes('网络连接失败')) {
      throw new Error(`智能抽取失败: ${errorMessage}`);
    }

    return [];
  }
}