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
// [新增] JSON字段名 / 噪声数据过滤
// ═══════════════════════════════════════════

/**
 * JSON Schema 保留字段名黑名单
 * AI 可能误将这些字段名当作术语输出，必须过滤
 */
const JSON_FIELD_NAME_BLACKLIST = new Set([
  'term_text',
  'source_lang',
  'target_term',
  'target_lang',
  'score',
  'translation_confidence',
  'translation_source',
  'abbreviation_suggestion',
  'abbreviation',
  'source_confidence',
  'source_term',
  'output',
]);

/**
 * 检测 term_text 是否为 JSON 字段名或代码标识符噪声
 */
export function isNoiseTerm(text: string): boolean {
  if (!text || text.length < 2) return true;

  const normalized = text
    .replace(/^["'`]+|["'`]+$/g, '')  // 去掉外层引号
    .trim()
    .toLowerCase();

  // 1. 黑名单精确匹配（仅过滤明确是JSON字段名的文本）
  if (JSON_FIELD_NAME_BLACKLIST.has(normalized)) return true;

  // 2. 纯标点/纯数字/纯空白
  if (/^[\s\d\p{P}]+$/u.test(text)) return true;

  return false;
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
  // 仅当AI未返回source_lang或返回无效值时，用规则补全
  if (term.source_lang && term.source_lang !== '' && term.source_lang !== 'null') {
    return term; // AI已判断，不覆盖
  }

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
  let value = 4;  // 基准分从0提升到4，保证所有术语获得基础价值

  // 有译文的加分
  if (term.target_term && term.target_term.length > 0) {
    value += 2;
  }

  // 长度加分（≥4字 +1, ≥8字 +1）
  if (term.term_text.length >= 4) value += 1;
  if (term.term_text.length >= 8) value += 1;

  // AI 评分影响（压缩到合理的贡献范围）
  value += Math.min(3, term.score / 3.3);

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
// Prompt 构建 (v4: AI自主模式完全重写 —— 自然语言描述输出结构，消除字段名泄漏)
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

  const foreignLangHint = detectedLangs
    ? (() => {
        const frMatch = detectedLangs.match(/fr/i);
        const deMatch = detectedLangs.match(/de/i);
        const esMatch = detectedLangs.match(/es/i);
        const itMatch = detectedLangs.match(/it/i);
        const ptMatch = detectedLangs.match(/pt/i);
        const jaMatch = detectedLangs.match(/ja/i);
        const koMatch = detectedLangs.match(/ko/i);
        const ruMatch = detectedLangs.match(/ru/i);
        const arMatch = detectedLangs.match(/ar/i);
        const enMatch = detectedLangs.match(/en/i);
        if (frMatch) return 'fr（法语）';
        if (deMatch) return 'de（德语）';
        if (esMatch) return 'es（西班牙语）';
        if (itMatch) return 'it（意大利语）';
        if (ptMatch) return 'pt（葡萄牙语）';
        if (jaMatch) return 'ja（日语）';
        if (koMatch) return 'ko（韩语）';
        if (ruMatch) return 'ru（俄语）';
        if (arMatch) return 'ar（阿拉伯语）';
        if (enMatch) return 'en（英语）';
        return 'en（英语）';
      })()
    : 'en（英语）';

  return `你是一位多语术语抽取专家，服务对象是以中文为母语的译者。本系统支持中、英、法、德、西、意、葡、日、韩、俄、阿共11种语言，术语库面向中文译者构建。

现有术语库示例：${existingTermsSample || '无'}
${domainContext}${bilingualHint}
检测到的外文语种：${foreignLangHint}

一、语篇类型判断
请自行判断文本的呈现方式，并据此调整抽取策略：

· 单语文本：仅有一种语言，抽取该语言中的术语原文，无译文对应

· 双语对照文本：两种语言分列或交替排列（如并列表格、交替段落、"中文 — 外文"标注格式等），应识别术语间的对译关系

· 嵌入式括号标注文本（重中之重）：文本以某一种语言为主要叙事语言，首次出现的专业术语在其后紧跟着以括号标注的外文原文（格式如"中文术语（English term）"或"English term（中文术语）"），括号内的外文原文就是括号外术语的精准译文。必须将括号内外文本识别为target_term，并建立双向对译关系

· 多语杂合文本：多种语言混杂出现在同一文本中，分别抽取各语种的术语，仅在有明确对译关系时建立对应

· 术语对照列表：结构化格式（如编号式词汇表、表格对照、术语库导出数据等），每行或每格应识别为一个术语实体

二、术语价值指引
优先抽取对中文译者有翻译价值的术语，包括但不限于：

· 专业领域概念：法律、技术、医学、金融等领域的特有名词
· 文化负载词：带有特定文化背景的术语
· 制度性概念：政策、法规、标准、组织名称等
· 复合术语：由多个词构成的固定搭配
· 具有歧义性或翻译难点的词
· 术语首次出现时附有括号外文标注 → 翻译价值极高，必须建立完整的双向对译关系（zh→外文 + 外文→zh）

对于过于普通的日常用语、缺乏语义完整性的片段，可酌情降低评分或排除。

三、语言对限定规则
本系统的有效语言范围包含以下11种：

【中文】zh
【外文】en（英语）、fr（法语）、de（德语）、es（西班牙语）、it（意大利语）、pt（葡萄牙语）、ja（日语）、ko（韩语）、ru（俄语）、ar（阿拉伯语）

术语原文与译文之间，仅允许以下两种对应关系：

→ 中文 → 外文：术语原文为中文（zh），对译为上述10种外文中的某一种
→ 外文 → 中文：术语原文为上述10种外文中的某一种，对译为中文（zh）

排除以下情况：中文对中文（zh→zh）、外文对外文（foreign→foreign，如 en→fr、ja→ko 等）。

即使译文为空（null），上述语言对限定仍然适用：术语原文只能是中文或上述10种外文，译文空缺时仅记录语言方向，不改变限定范围。

★ 特别强调：如果文本中存在嵌入式括号标注模式（如"争点排除（issue preclusion）"），括号内外的中英文互为精准译文。此时source_lang和target_lang必须分别设置为zh和对应外文（或反之），两者都必须返回非null值，切勿因source_lang被判定为zh就省去target_term的填写！理想情况下每个括号对应对应输出两个术语实体（zh→外文 + 外文→zh）。

四、概念首倡语言（语言方向判断）
在识别术语的语言方向时，不应机械地按照文本的字面语言标记，而应从概念起源的角度判断。例如：

· 中国特有概念（如"社会主义核心价值观"、"乡村振兴"）→ 源语言应为 zh
· 英美法系概念（如"common law"、"trust"）→ 源语言应为 en
· 国际通用科技概念（如"artificial intelligence"、"blockchain"）→ 即使文本中写的是中文，源语言也倾向于 en
· 日本动漫文化概念（如"anime"、"manga"）→ 源语言应为 ja

五、输出格式说明
返回一个 JSON 数组。数组中每个对象包含以下7个字段（这些描述仅供说明输出结构，不是需要抽取的内容，切勿将描述标签本身作为术语输出）：

字段1 - 名称：原文文本，类型：字符串，必填。术语的原文文本，需语义完整。
字段2 - 名称：源语言，类型：字符串，必填。术语原文的语言代码，取值范围：zh, en, fr, de, es, it, pt, ja, ko, ru, ar。
字段3 - 名称：评分，类型：整数0-10，必填。基于专业性和翻译价值的综合评分。
字段4 - 名称：译文，类型：字符串或null。译文文本。★ 嵌入式括号标注中括号内的文本是精准译文，此字段必须填写而非null；仅在文本确实不存在对译关系时才填null；决不可编造翻译。
字段5 - 名称：译文语言，类型：字符串或null。译文语言代码，无译文时填 null。
字段6 - 名称：置信度，类型：浮点数0.0-1.0。译文的置信度。嵌入式括号标注的直接对应关系，置信度设为 0.95-1.0；无译文时填 0。
字段7 - 名称：来源，类型：字符串。嵌入式括号标注或其他显式对译关系填 "file"；AI推判的对译关系填 "ai"；无译文时填 "none"。
字段8 - 名称：缩写建议，类型：字符串或null。当术语存在成熟通用的缩写形式时（如 "Artificial Intelligence" → "AI"），在此字段提供缩写；无通用缩写时填 null。

JSON数组中每个对象的键名必须严格使用以下英文键名：term_text, source_lang, score, target_term, target_lang, translation_confidence, translation_source, abbreviation_suggestion

六、注意事项
· 自主决定抽取数量，不必人为限制
· 不编造翻译，只抽取文本中实际存在的对译关系
· 对于嵌入式括号标注（如"相互性（mutuality）"），括号内外的对译关系是确定且精准的，必须完整填入target_term，决不可省略
· 缩写或首字母缩略词保持原文，源语言填写其实际所属语言
· 确保原文文本是语义完整的术语，而非滑动窗口式的任意词组片段
· 双语对照文本及嵌入式括号标注文本中，同一组术语对必须输出两条条目（zh→外文 + 外文→zh），因为双向对译关系在文本中有明确依据

只返回纯净的 JSON 数组，不要包含任何解释、注释或额外文字。`;
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

      if (allAiTerms.length === 0) {
        console.warn(
          `[AI Extractor] AI returned 0 terms from non-chunked text (${text.length} chars). ` +
          `First 300 chars: "${text.slice(0, 300)}"`
        );
      }
    }

    // [新增] 噪声过滤：移除 JSON 字段名和代码标识符
    const beforeNoiseFilter = allAiTerms.length;
    allAiTerms = allAiTerms.filter(term => !isNoiseTerm(term.term_text));
    if (beforeNoiseFilter !== allAiTerms.length) {
      console.log(`[AI Extractor] Noise filter removed ${beforeNoiseFilter - allAiTerms.length} noise terms (JSON field names, etc.)`);
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