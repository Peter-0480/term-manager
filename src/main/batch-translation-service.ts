/**
 * 批量翻译服务
 * 将多个术语合并为单个API请求，提高效率
 */

import { AIConfig, getFullEndpoint } from './ai-client';
import { APIResponseHandler } from './api-response-handler';
import { PromptManager } from './prompt-manager';
import { aiCacheWrapper } from './api-cache-manager';

export interface BatchTranslationRequest {
  termIds: number[];
  terms: Array<{ id: number; text: string; sourceLang: string }>;
  targetLang: string;
  config?: AIConfig;
  mode?: 'standard' | 'quick';
}

export interface BatchTranslationResult {
  term_id: number;
  text: string;
  confidence: number;
  source: string;
  error?: string;
}

export class BatchTranslationService {
  /**
   * 批量获取AI翻译建议
   */
  static async batchGetAITranslationSuggestions(
    request: BatchTranslationRequest
  ): Promise<BatchTranslationResult[]> {
    const { termIds, terms, targetLang, config, mode = 'standard' } = request;
    
    console.log(`[Batch Translation] Starting batch translation for ${termIds.length} terms, mode: ${mode}`);
    
    // 如果没有AI配置，返回降级结果
    if (!config?.apiKey) {
      console.warn('[Batch Translation] No AI config, returning fallback suggestions');
      return this.generateFallbackSuggestions(termIds, terms, targetLang);
    }
    
    try {
      // 1. 准备批量翻译数据
      const termTexts = terms.map(t => t.text);
      const sourceLang = terms[0]?.sourceLang || 'en'; // 假设所有术语同源语言
      
      // 2. 检查缓存（相同术语列表、相同翻译方向）
      const cacheKey = `${JSON.stringify(termTexts)}:${sourceLang}:${targetLang}:${mode}`;
      const cachedResults = aiCacheWrapper['cacheManager'].get<BatchTranslationResult[]>('batch-translation', cacheKey);
      if (cachedResults) {
        console.log(`[Batch Translation] Cache hit for ${termTexts.length} terms`);
        return cachedResults;
      }
      
      // 3. 构建批量提示词
      const promptConfig = mode === 'quick' 
        ? PromptManager.createQuickModeConfig()
        : { mode: 'standard' as const };
      
      const prompt = PromptManager.getBatchTranslationPrompt(
        termTexts,
        sourceLang,
        targetLang,
        promptConfig
      );
      
      // 4. 调用AI API
      const { endpoint, model, provider } = getFullEndpoint(config);
      const apiKey = config.apiKey!;
      
      console.log(`[Batch Translation] Sending batch request to ${provider}, ${termTexts.length} terms`);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey, provider),
        body: JSON.stringify(this.buildRequestBody(prompt, model, provider))
      });
      
      // 5. 验证响应
      const validation = await APIResponseHandler.validateResponse(response);
      if (!validation.valid) {
        throw new Error(`批量翻译请求失败: ${validation.error}`);
      }
      
      const data = await response.json();
      const content = APIResponseHandler.extractContentFromResponse(data, provider);
      
      if (!content) {
        throw new Error('AI API返回空内容');
      }
      
      // 6. 解析批量响应
      const parsedResponse = APIResponseHandler.parseJsonResponse(content);
      const translations = this.parseBatchResponse(parsedResponse, termTexts);
      
      // 7. 映射回术语ID
      const results: BatchTranslationResult[] = [];
      for (let i = 0; i < Math.min(termIds.length, translations.length); i++) {
        const termId = termIds[i];
        const translation = translations[i];
        
        results.push({
          term_id: termId,
          text: APIResponseHandler.normalizeTranslationText(translation.text),
          confidence: translation.confidence || 0.8,
          source: 'ai_batch_suggestion'
        });
      }
      
      // 8. 处理剩余术语（如果数量不匹配）
      if (results.length < termIds.length) {
        console.warn(`[Batch Translation] Response count mismatch: expected ${termIds.length}, got ${results.length}`);
        
        for (let i = results.length; i < termIds.length; i++) {
          const termId = termIds[i];
          const term = terms.find(t => t.id === termId);
          
          results.push({
            term_id: termId,
            text: term?.text || '[翻译失败]',
            confidence: 0.1,
            source: 'fallback',
            error: '响应数量不匹配'
          });
        }
      }
      
      // 9. 缓存结果（5分钟内相同批量请求不重复调用API）
      if (results.length > 0) {
        aiCacheWrapper['cacheManager'].set('batch-translation', cacheKey, results, { ttl: 5 * 60 * 1000 });
      }
      
      console.log(`[Batch Translation] Completed, ${results.length} suggestions generated`);
      return results;
      
    } catch (error) {
      console.error('[Batch Translation] Error:', error);
      
      // 错误时返回降级建议
      return this.generateFallbackSuggestions(termIds, terms, targetLang, error);
    }
  }
  
  /**
   * 构建请求头
   */
  private static buildHeaders(apiKey: string, provider: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    return headers;
  }
  
  /**
   * 构建请求体
   */
  private static buildRequestBody(prompt: string, model: string, provider: string): any {
    const baseBody: any = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1000
    };
    
    if (provider === 'anthropic') {
      baseBody.max_tokens = 500;
    }
    
    return baseBody;
  }
  
  /**
   * 解析批量响应
   */
  private static parseBatchResponse(parsedResponse: any, originalTerms: string[]): Array<{text: string; confidence?: number}> {
    // 支持多种响应格式
    
    // 格式1: 简单数组 ["翻译1", "翻译2", ...]
    if (Array.isArray(parsedResponse) && parsedResponse.every(item => typeof item === 'string')) {
      return parsedResponse.map((text, index) => ({
        text,
        confidence: 0.8
      }));
    }
    
    // 格式2: 对象数组 [{original: "...", translated: "...", confidence: ...}]
    if (Array.isArray(parsedResponse) && parsedResponse.every(item => item && typeof item === 'object')) {
      return parsedResponse.map((item, index) => ({
        text: item.translated || item.text || item.translation || originalTerms[index] || '',
        confidence: item.confidence || 0.8
      }));
    }
    
    // 格式3: 包含translations字段的对象
    if (parsedResponse.translations && Array.isArray(parsedResponse.translations)) {
      return parsedResponse.translations.map((item: any, index: number) => ({
        text: typeof item === 'string' ? item : (item.translated || item.text || item.translation || ''),
        confidence: item.confidence || 0.8
      }));
    }
    
    // 格式4: 简单对象 {term1: "翻译1", term2: "翻译2"}
    if (parsedResponse && typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)) {
      const translations: Array<{text: string; confidence?: number}> = [];
      
      for (let i = 0; i < originalTerms.length; i++) {
        const term = originalTerms[i];
        const translation = parsedResponse[term] || parsedResponse[`term${i + 1}`] || parsedResponse[i] || '';
        translations.push({
          text: translation,
          confidence: 0.8
        });
      }
      
      return translations;
    }
    
    // 默认：返回原始术语作为降级
    console.warn('[Batch Translation] Unrecognized response format:', parsedResponse);
    return originalTerms.map(term => ({
      text: term,
      confidence: 0.1
    }));
  }
  
  /**
   * 生成降级建议
   */
  private static generateFallbackSuggestions(
    termIds: number[],
    terms: Array<{ id: number; text: string; sourceLang: string }>,
    targetLang: string,
    error?: any
  ): BatchTranslationResult[] {
    console.log('[Batch Translation] Generating fallback suggestions');
    
    return termIds.map(termId => {
      const term = terms.find(t => t.id === termId);
      const errorMessage = error ? APIResponseHandler.normalizeError(error) : 'AI服务不可用';
      
      // 简单的降级翻译：添加语言标记
      let fallbackText = term?.text || '';
      if (targetLang === 'zh' && term?.sourceLang === 'en') {
        fallbackText = `${fallbackText}（英文）`;
      } else if (targetLang === 'en' && term?.sourceLang === 'zh') {
        fallbackText = `${fallbackText} (Chinese)`;
      }
      
      return {
        term_id: termId,
        text: fallbackText,
        confidence: 0.3,
        source: 'fallback',
        error: errorMessage
      };
    });
  }
  
  /**
   * 智能分批次处理大量术语
   */
  static async batchGetAITranslationSuggestionsWithChunking(
    request: BatchTranslationRequest,
    chunkSize: number = 20
  ): Promise<BatchTranslationResult[]> {
    const { termIds, terms, targetLang, config, mode } = request;
    
    if (termIds.length <= chunkSize) {
      // 小批量直接处理
      return this.batchGetAITranslationSuggestions(request);
    }
    
    console.log(`[Batch Translation] Large batch detected (${termIds.length} terms), chunking into ${Math.ceil(termIds.length / chunkSize)} chunks`);
    
    const allResults: BatchTranslationResult[] = [];
    
    // 分批次处理
    for (let i = 0; i < termIds.length; i += chunkSize) {
      const chunkTermIds = termIds.slice(i, i + chunkSize);
      const chunkTerms = terms.filter(t => chunkTermIds.includes(t.id));
      
      console.log(`[Batch Translation] Processing chunk ${Math.floor(i / chunkSize) + 1}, ${chunkTermIds.length} terms`);
      
      try {
        const chunkRequest: BatchTranslationRequest = {
          termIds: chunkTermIds,
          terms: chunkTerms,
          targetLang,
          config,
          mode
        };
        
        const chunkResults = await this.batchGetAITranslationSuggestions(chunkRequest);
        allResults.push(...chunkResults);
        
        // 添加延迟避免API限制（除了最后一批）
        if (i + chunkSize < termIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (chunkError) {
        console.error(`[Batch Translation] Chunk ${Math.floor(i / chunkSize) + 1} failed:`, chunkError);
        
        // 对失败的批次生成降级建议
        const fallbackResults = this.generateFallbackSuggestions(chunkTermIds, chunkTerms, targetLang, chunkError);
        allResults.push(...fallbackResults);
      }
    }
    
    console.log(`[Batch Translation] All chunks processed, total ${allResults.length} results`);
    return allResults;
  }
}