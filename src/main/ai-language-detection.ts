// 智能语言检测和翻译服务
// 基于AI的多语言支持和术语对齐

import { getFullEndpoint, AIConfig } from './ai-client';
import { LanguageDetectionResult, TranslationRequest, TranslationResponse, TermAlignmentResult } from '../types/multilingual';

/**
 * 智能语言检测 - 使用AI识别文本的语言
 * 支持多种语言检测算法：基于字符统计、AI预测、字典匹配
 */
export async function detectLanguage(
  text: string, 
  config?: AIConfig
): Promise<LanguageDetectionResult> {
  if (!text || text.trim().length < 2) {
    return { language: 'unknown', confidence: 0 };
  }
  
  // 1. 简单字符统计方法（快速、低成本）
  const simpleResult = detectLanguageByCharacters(text);
  if (simpleResult.confidence > 0.85) {
    return simpleResult;
  }
  
  // 2. 如果没有足够的AI配置，返回简单检测结果
  if (!config?.apiKey) {
    return simpleResult;
  }
  
  // 3. 使用AI进行更精确的语言检测
  try {
    const aiResult = await detectLanguageWithAI(text, config);
    return aiResult;
  } catch (error) {
    console.warn('AI语言检测失败，回退到简单检测:', error);
    return simpleResult;
  }
}

/**
 * 基于字符统计的语言检测
 * 使用Unicode字符范围识别语言
 */
function detectLanguageByCharacters(text: string): LanguageDetectionResult {
  const trimmedText = text.trim();
  let chineseCount = 0;
  let japaneseCount = 0;
  let koreanCount = 0;
  let cyrillicCount = 0;
  let latinCount = 0;
  let arabicCount = 0;
  let otherCount = 0;
  
  // Unicode范围定义
  const RANGES = {
    // 中文字符：包括基本汉字、扩展A区、扩展B区的部分
    chinese: /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/,
    // 日文：平假名、片假名、日文汉字
    japanese: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/,
    // 韩文：韩文音节
    korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
    // 西里尔字母：俄语、乌克兰语等
    cyrillic: /[\u0400-\u04FF\u0500-\u052F]/,
    // 拉丁字母：英语、法语、德语、西班牙语等
    latin: /[A-Za-z\u00C0-\u00FF\u0100-\u017F]/,
    // 阿拉伯字母：阿拉伯语、波斯语等
    arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
    // 其他：数字、标点、空格等
    other: /[0-9\s\p{P}\p{S}]/u
  };
  
  // 统计字符
  for (const char of trimmedText) {
    if (RANGES.chinese.test(char)) {
      chineseCount++;
    } else if (RANGES.japanese.test(char)) {
      japaneseCount++;
    } else if (RANGES.korean.test(char)) {
      koreanCount++;
    } else if (RANGES.cyrillic.test(char)) {
      cyrillicCount++;
    } else if (RANGES.latin.test(char)) {
      latinCount++;
    } else if (RANGES.arabic.test(char)) {
      arabicCount++;
    } else if (RANGES.other.test(char)) {
      otherCount++;
    } else {
      otherCount++;
    }
  }
  
  // 计算字符总数（排除其他字符）
  const meaningfulChars = text.length - otherCount;
  if (meaningfulChars === 0) {
    return { language: 'unknown', confidence: 0 };
  }
  
  // 计算每种语言的比例
  const languages = [
    { code: 'zh', count: chineseCount, name: '中文' },
    { code: 'ja', count: japaneseCount, name: '日本語' },
    { code: 'ko', count: koreanCount, name: '한국어' },
    { code: 'ru', count: cyrillicCount, name: 'Русский' },
    { code: 'en', count: latinCount, name: 'English' },
    { code: 'ar', count: arabicCount, name: 'العربية' }
  ];
  
  // 找出最可能的语言
  const sortedLanguages = languages
    .filter(lang => lang.count > 0)
    .sort((a, b) => b.count - a.count);
  
  if (sortedLanguages.length === 0) {
    return { language: 'unknown', confidence: 0 };
  }
  
  const primary = sortedLanguages[0];
  const confidence = Math.min(0.95, primary.count / meaningfulChars);
  
  // 添加备选语言（如果存在）
  const alternatives = sortedLanguages
    .slice(1, 3)
    .map(lang => ({
      language: lang.code,
      confidence: Math.min(0.9, lang.count / meaningfulChars)
    }));
  
  return {
    language: primary.code,
    confidence,
    alternatives: alternatives.length > 0 ? alternatives : undefined
  };
}

/**
 * 使用AI进行语言检测
 */
async function detectLanguageWithAI(
  text: string,
  config: AIConfig
): Promise<LanguageDetectionResult> {
  const { endpoint, model, provider } = getFullEndpoint(config);
  const apiKey = config.apiKey!;
  
  // 准备提示词
  const prompt = `请识别以下文本的语言，用ISO 639-1语言代码返回：
  
文本内容：${text.substring(0, 500)}${text.length > 500 ? '...' : ''}

请只返回JSON格式，例如：
{
  "language": "zh",
  "confidence": 0.95,
  "alternatives": [
    {"language": "en", "confidence": 0.05}
  ]
}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(provider === 'anthropic' ? { 'x-api-key': apiKey } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 100
      })
    });
    
    if (!response.ok) {
      throw new Error(`AI请求失败: ${response.status}`);
    }
    
    const result = await response.json();
    const content = provider === 'anthropic' 
      ? result.content?.[0]?.text || ''
      : result.choices?.[0]?.message?.content || '';
    
    // 解析JSON响应
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到JSON响应');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        language: parsed.language || 'unknown',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        alternatives: parsed.alternatives || []
      };
    } catch (parseError) {
      console.warn('AI响应解析失败:', parseError);
      // 尝试从纯文本中提取语言信息
      const languageCodes = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'ar'];
      const lowerContent = content.toLowerCase();
      for (const code of languageCodes) {
        if (lowerContent.includes(code)) {
          return {
            language: code,
            confidence: 0.7,
            alternatives: []
          };
        }
      }
      throw new Error('无法解析语言检测结果');
    }
  } catch (error) {
    throw new Error(`AI语言检测失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * AI翻译服务
 */
export async function translateWithAI(
  request: TranslationRequest,
  config?: AIConfig
): Promise<TranslationResponse> {
  if (!config?.apiKey) {
    throw new Error('需要配置API密钥才能使用AI翻译');
  }
  
  const { endpoint, model, provider } = getFullEndpoint(config);
  const apiKey = config.apiKey;
  
  // 构建上下文提示
  const contextInfo = request.context ? `上下文信息：${request.context}\n` : '';
  const domainInfo = request.domain_id ? `领域ID：${request.domain_id}\n` : '';
  
  const prompt = `你是一个专业术语翻译工具。请将以下术语从${request.source_lang}精确翻译到${request.target_lang}。

术语：${request.text}
${contextInfo}${domainInfo}

要求：
- 输出简洁、准确的术语标准译文，符合目标语言的专业术语规范
- 不要输出句子、描述性或解释性内容
- 不要添加括号注释或额外信息
- 不要使用不必要的修饰词或连接词（如"and"、"or"等），除非术语原文本身包含

请按以下JSON格式返回，且只返回JSON对象本身：
{
  "text": "术语译文",
  "confidence": 0.95,
  "alternatives": ["备选译文1", "备选译文2"]
}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(provider === 'anthropic' ? { 'x-api-key': apiKey } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });
    
    if (!response.ok) {
      throw new Error(`翻译请求失败: ${response.status}`);
    }
    
    const result = await response.json();
    const content = provider === 'anthropic'
      ? result.content?.[0]?.text || ''
      : result.choices?.[0]?.message?.content || '';
    
    // 解析JSON响应
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到JSON响应');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.text || '',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.8)),
        alternatives: parsed.alternatives || [],
        explanation: parsed.explanation
      };
    } catch (parseError) {
      console.warn('翻译响应解析失败:', parseError);
      // 返回纯文本作为翻译
      return {
        text: content.trim(),
        confidence: 0.6,
        alternatives: []
      };
    }
  } catch (error) {
    throw new Error(`AI翻译失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 术语对齐算法
 * 查找源语言和目标语言术语之间的最佳匹配
 */
export function alignTerms(
  sourceTerms: Array<{id?: number, text: string, context?: string}>,
  targetTerms: Array<{id?: number, text: string, context?: string}>,
  sourceLang: string,
  targetLang: string
): TermAlignmentResult[] {
  const alignments: TermAlignmentResult[] = [];
  
  // 1. 精确匹配
  for (const source of sourceTerms) {
    for (const target of targetTerms) {
      const normalizedSource = normalizeTerm(source.text);
      const normalizedTarget = normalizeTerm(target.text);
      
      if (normalizedSource === normalizedTarget) {
        alignments.push({
          source_term: source.text,
          target_term: target.text,
          source_lang: sourceLang,
          target_lang: targetLang,
          similarity: 1.0,
          alignment_type: 'exact'
        });
        break;
      }
    }
  }
  
  // 2. 模糊匹配（使用编辑距离）
  const unmatchedSources = sourceTerms.filter(s => 
    !alignments.some(a => a.source_term === s.text)
  );
  const unmatchedTargets = targetTerms.filter(t => 
    !alignments.some(a => a.target_term === t.text)
  );
  
  for (const source of unmatchedSources) {
    let bestMatch: TermAlignmentResult | null = null;
    
    for (const target of unmatchedTargets) {
      const similarity = calculateTermSimilarity(source.text, target.text);
      
      if (similarity > 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = {
          source_term: source.text,
          target_term: target.text,
          source_lang: sourceLang,
          target_lang: targetLang,
          similarity,
          alignment_type: similarity > 0.9 ? 'partial' : 'fuzzy'
        };
      }
    }
    
    if (bestMatch) {
      alignments.push(bestMatch);
    }
  }
  
  return alignments;
}

/**
 * 术语规范化
 */
function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, '') // 只保留字母和数字
    .normalize('NFKD'); // Unicode规范化
}

/**
 * 计算术语相似度（0-1）
 * 使用多种算法组合
 */
function calculateTermSimilarity(term1: string, term2: string): number {
  const norm1 = normalizeTerm(term1);
  const norm2 = normalizeTerm(term2);
  
  if (norm1 === norm2) return 1.0;
  
  // 1. 编辑距离相似度
  const editDistance = levenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);
  const editSimilarity = maxLength > 0 ? 1 - (editDistance / maxLength) : 0;
  
  // 2. Jaccard相似度（基于字符集）
  const set1 = new Set(norm1);
  const set2 = new Set(norm2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;
  
  // 3. 前缀/后缀相似度
  const prefixLength = commonPrefixLength(norm1, norm2);
  const suffixLength = commonSuffixLength(norm1, norm2);
  const avgLength = (norm1.length + norm2.length) / 2;
  const prefixSimilarity = avgLength > 0 ? prefixLength / avgLength : 0;
  const suffixSimilarity = avgLength > 0 ? suffixLength / avgLength : 0;
  
  // 加权组合
  const weights = {
    edit: 0.4,
    jaccard: 0.3,
    prefix: 0.15,
    suffix: 0.15
  };
  
  const combinedSimilarity = 
    editSimilarity * weights.edit +
    jaccardSimilarity * weights.jaccard +
    prefixSimilarity * weights.prefix +
    suffixSimilarity * weights.suffix;
  
  return Math.max(0, Math.min(1, combinedSimilarity));
}

/**
 * 计算Levenshtein编辑距离
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替换
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 删除
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * 计算共同前缀长度
 */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * 计算共同后缀长度
 */
function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  const minLength = Math.min(a.length, b.length);
  while (i < minLength && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i++;
  }
  return i;
}

/**
 * 批量翻译术语
 */
export async function batchTranslateTerms(
  terms: Array<{id: number, text: string}>,
  sourceLang: string,
  targetLang: string,
  config?: AIConfig
): Promise<Array<{term_id: number, text: string, confidence: number}>> {
  if (!config?.apiKey) {
    throw new Error('需要配置API密钥才能使用批量翻译');
  }
  
  const results: Array<{term_id: number, text: string, confidence: number}> = [];
  
  // 分批处理，每批10个术语
  const batchSize = 10;
  for (let i = 0; i < terms.length; i += batchSize) {
    const batch = terms.slice(i, i + batchSize);
    
    // 构建批量翻译请求
    const batchText = batch.map(term => term.text).join('\n');
    const request: TranslationRequest = {
      text: batchText,
      source_lang: sourceLang,
      target_lang: targetLang,
      context: `批量翻译${batch.length}个术语`
    };
    
    try {
      const response = await translateWithAI(request, config);
      // 简单拆分翻译结果（假设AI返回相同数量的翻译）
      const translations = response.text.split('\n').map(t => t.trim());
      
      for (let j = 0; j < Math.min(batch.length, translations.length); j++) {
        results.push({
          term_id: batch[j].id,
          text: translations[j],
          confidence: response.confidence
        });
      }
    } catch (error) {
      console.warn(`批量翻译批次${Math.floor(i / batchSize) + 1}失败:`, error);
      // 对失败的术语添加占位符
      batch.forEach(term => {
        results.push({
          term_id: term.id,
          text: `[翻译失败: ${term.text}]`,
          confidence: 0.1
        });
      });
    }
    
    // 添加延迟避免API限制
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}