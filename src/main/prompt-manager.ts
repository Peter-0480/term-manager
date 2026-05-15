/**
 * 提示词管理器
 * 统一管理所有AI提示词，支持不同场景和优化模式
 */

export interface PromptConfig {
  mode: 'standard' | 'quick' | 'detailed';
  includeExamples: boolean;
  includeContext: boolean;
  maxLength: number;
}

export class PromptManager {
  // 默认配置
  static readonly DEFAULT_CONFIG: PromptConfig = {
    mode: 'standard',
    includeExamples: true,
    includeContext: true,
    maxLength: 15000 // 从3000增加到15000，避免长文本被过度截断
  };

  /**
   * 获取术语抽取提示词
   */
  static getExtractionPrompt(
    text: string,
    language: string,
    existingTerms: string[] = [],
    config: Partial<PromptConfig> = {}
  ): string {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };
    const truncatedText = this.truncateText(text, mergedConfig.maxLength);
    
    let prompt = '';
    
    if (mergedConfig.mode === 'quick') {
      // 快速模式：精简提示词
      prompt = `提取以下文本中的专业术语，返回JSON数组格式：
文本：${truncatedText}
语言：${language}

要求：
1. 只提取真正的专业术语
2. 返回格式：["术语1", "术语2", ...]
3. 不要包含解释或其他文本`;
    } else if (mergedConfig.mode === 'detailed') {
      // 详细模式：包含完整信息
      prompt = `你是一位专业翻译术语专家，请从以下文本中提取具有翻译参考价值的专业术语。

要求：
1. 提取真正的专业概念，而非普通高频词
2. 为每个术语提供以下信息：
   - 源术语文本 (source_term)
   - 源语种判断 (source_lang)
   - 目标术语建议 (target_term) - 可选
   - 目标语种 (target_lang) - 可选
   - 翻译来源 (translation_source) - "file"、"ai"或"none"
   - 翻译置信度 (translation_confidence) - 0-1
   - 术语相关性得分 (score) - 1-10分

${mergedConfig.includeContext ? this.getContextSection(existingTerms) : ''}

文本内容：
${truncatedText}

请以JSON数组格式返回结果，每个元素包含上述字段。
只返回纯JSON数组，不要有其他文本。`;
    } else {
      // 标准模式
      prompt = `请从以下文本中提取专业术语：
文本：${truncatedText}
语言：${language}

${mergedConfig.includeExamples && existingTerms.length > 0 ? 
  `现有术语示例：${existingTerms.slice(0, 5).join(', ')}` : ''}

返回JSON数组，每个术语包含：
- term_text: 术语文本
- source_lang: 源语言
- score: 重要性评分(1-10)

只返回纯JSON数组。`;
    }
    
    return prompt;
  }

  /**
   * 获取批量翻译提示词
   */
  static getBatchTranslationPrompt(
    terms: string[],
    sourceLang: string,
    targetLang: string,
    config: Partial<PromptConfig> = {}
  ): string {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    if (mergedConfig.mode === 'quick') {
      return `批量翻译以下术语（${terms.length}个）：
源语言：${sourceLang}
目标语言：${targetLang}

术语列表：${JSON.stringify(terms)}

返回格式：{"translations": ["翻译1", "翻译2", ...]}
只返回JSON，不要有其他文本。`;
    }
    
    // 标准/详细模式
    return `请将以下术语从${sourceLang}翻译到${targetLang}：

术语列表（共${terms.length}个）：
${terms.map((term, i) => `${i + 1}. ${term}`).join('\n')}

要求：
1. 提供专业、准确的翻译
2. 保持术语一致性
3. 对于专业术语，优先使用行业标准译法

返回JSON格式：
{
  "translations": [
    {
      "original": "原文",
      "translated": "译文",
      "confidence": 0.95,
      "notes": "翻译说明（可选）"
    }
  ]
}

只返回纯JSON，不要有其他文本。`;
  }

  /**
   * 获取AI补全建议提示词
   */
  static getCompletionPrompt(
    term: string,
    sourceLang: string,
    targetLang: string,
    hasTranslation: boolean,
    hasDomain: boolean,
    config: Partial<PromptConfig> = {}
  ): string {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    const sections: string[] = [];
    
    // 翻译建议部分
    if (!hasTranslation && sourceLang !== targetLang) {
      sections.push(`请提供${sourceLang}到${targetLang}的专业翻译建议。`);
    }
    
    // 领域建议部分
    if (!hasDomain) {
      sections.push(`请提供合适的学科领域分类建议。`);
    }
    
    // 缩写建议部分
    sections.push(`请提供合适的缩写建议。`);
    
    if (mergedConfig.mode === 'quick') {
      return `术语：${term}
语言：${sourceLang}

${sections.join('\n')}

返回JSON格式：
{
  ${!hasTranslation && sourceLang !== targetLang ? '"translation": "译文",' : ''}
  ${!hasDomain ? '"domain": "领域名称",' : ''}
  "abbreviation": "缩写"
}

只返回JSON。`;
    }
    
    // 标准/详细模式
    return `你是一位专业术语专家，请为以下术语提供AI补全建议：

术语：${term}
源语言：${sourceLang}
目标语言：${targetLang}

需要提供的建议：
${sections.map((section, i) => `${i + 1}. ${section}`).join('\n')}

返回JSON格式：
{
  ${!hasTranslation && sourceLang !== targetLang ? `
  "translation": {
    "text": "译文",
    "lang": "${targetLang}",
    "confidence": 0.9,
    "explanation": "翻译说明"
  },` : ''}
  ${!hasDomain ? `
  "domain": {
    "name": "领域名称",
    "confidence": 0.8,
    "reasoning": "分类理由"
  },` : ''}
  "abbreviation": {
    "text": "缩写",
    "confidence": 0.7,
    "alternatives": ["备选缩写1", "备选缩写2"]
  }
}

只返回纯JSON，不要有其他文本。`;
  }

  /**
   * 获取语言检测提示词
   */
  static getLanguageDetectionPrompt(text: string, config: Partial<PromptConfig> = {}): string {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };
    const truncatedText = this.truncateText(text, 500);
    
    if (mergedConfig.mode === 'quick') {
      return `检测文本语言：${truncatedText}
返回语言代码（如zh、en、ja等）。`;
    }
    
    return `请识别以下文本的语言：

文本：${truncatedText}

返回JSON格式：
{
  "language": "语言代码",
  "confidence": 0.95,
  "alternatives": [
    {"language": "备选语言", "confidence": 0.05}
  ]
}

只返回纯JSON。`;
  }

  /**
   * 获取统一的JSON响应指令
   */
  static getJsonResponseInstruction(): string {
    return '只返回纯JSON格式，不要包含其他任何文本、解释或标记。';
  }

  /**
   * 获取上下文信息部分
   */
  private static getContextSection(existingTerms: string[]): string {
    if (existingTerms.length === 0) {
      return '';
    }
    
    const sampleTerms = existingTerms.slice(0, 10).join(', ');
    return `现有术语库示例：${sampleTerms}${existingTerms.length > 10 ? '...' : ''}`;
  }

  /**
   * 截断文本到指定长度
   */
  private static truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    
    const truncated = text.substring(0, maxLength);
    return `${truncated}...（截断，原文本${text.length}字符）`;
  }

  /**
   * 创建快速模式配置
   */
  static createQuickModeConfig(): PromptConfig {
    return {
      mode: 'quick',
      includeExamples: false,
      includeContext: false,
      maxLength: 1500
    };
  }

  /**
   * 创建详细模式配置
   */
  static createDetailedModeConfig(): PromptConfig {
    return {
      mode: 'detailed',
      includeExamples: true,
      includeContext: true,
      maxLength: 4000
    };
  }
}