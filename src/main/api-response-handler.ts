/**
 * 统一的API响应处理器
 * 提供标准化的JSON解析、错误处理和文本清理功能
 */

export class APIResponseHandler {
  /**
   * 解析JSON响应，支持多种格式
   * @param content AI返回的文本内容
   * @returns 解析后的JSON对象或数组
   */
  static parseJsonResponse(content: string): any {
    if (!content || typeof content !== 'string') {
      throw new Error('响应内容为空或无效');
    }

    // 尝试多种JSON匹配模式
    const jsonPatterns = [
      /\[\s*\{[\s\S]*?\}\s*\]/s,  // JSON数组
      /\{[\s\S]*\}/s,             // JSON对象
      /\[.*\]/s,                  // 宽松的数组匹配
    ];

    for (const pattern of jsonPatterns) {
      const match = content.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (parseError) {
          console.warn('JSON解析失败，尝试下一个模式:', parseError);
          continue;
        }
      }
    }

    // 如果所有模式都失败，尝试提取可能的JSON片段
    const possibleJson = this.extractPossibleJson(content);
    if (possibleJson) {
      try {
        return JSON.parse(possibleJson);
      } catch (error) {
        console.warn('提取的JSON解析失败:', error);
      }
    }

    // [P1增强] JSON解析容错恢复：尝试修复常见的JSON格式错误
    const recoveredJson = this.recoverMalformedJson(content);
    if (recoveredJson) {
      try {
        const parsed = JSON.parse(recoveredJson);
        console.log('[API Response Handler] Successfully recovered malformed JSON via auto-fix');
        return parsed;
      } catch (error) {
        console.warn('[API Response Handler] JSON recovery also failed:', error);
      }
    }

    // [P1增强] 最后的降级：尝试逐行提取类JSON的key-value对
    // AI有时返回的不是JSON而是类似 "term: translation" 的行格式
    const lineBasedRecovery = this.extractFromLineBasedFormat(content);
    if (lineBasedRecovery) {
      console.log('[API Response Handler] Recovered terms from line-based format fallback');
      return lineBasedRecovery;
    }

    throw new Error('未在响应中找到有效的JSON格式');
  }

  /**
   * 从文本中提取可能的JSON片段
   */
  private static extractPossibleJson(content: string): string | null {
    // 查找可能的JSON开始和结束位置
    const startIndex = content.indexOf('[');
    const objectStartIndex = content.indexOf('{');
    
    if (startIndex === -1 && objectStartIndex === -1) {
      return null;
    }

    // 优先使用数组格式
    const jsonStart = startIndex !== -1 ? startIndex : objectStartIndex;
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = jsonStart; i < content.length; i++) {
      const char = content[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
        
        // 当所有括号都匹配时，返回JSON片段
        if (braceCount === 0 && bracketCount === 0) {
          return content.substring(jsonStart, i + 1);
        }
      }
    }
    
    return null;
  }

  /**
   * 清理翻译文本中的冗余前缀和后缀
   * @param text 原始翻译文本
   * @returns 清理后的文本
   */
  static normalizeTranslationText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let cleanedText = text.trim();

    // 移除常见的冗余前缀
    const redundantPrefixes = [
      '[AI翻译] ', '[翻译] ', 'AI翻译: ', '翻译: ',
      'AI Translation: ', 'Translation: ',
      'AI翻译结果: ', '翻译结果: ',
      '译文: ', '译: '
    ];

    for (const prefix of redundantPrefixes) {
      if (cleanedText.startsWith(prefix)) {
        cleanedText = cleanedText.substring(prefix.length);
        break; // 只移除第一个匹配的前缀
      }
    }

    // 移除常见的冗余后缀
    const redundantSuffixes = [
      ' (AI翻译)', ' (翻译)', ' (AI Translation)', ' (Translation)',
      ' [AI翻译]', ' [翻译]'
    ];

    for (const suffix of redundantSuffixes) {
      if (cleanedText.endsWith(suffix)) {
        cleanedText = cleanedText.substring(0, cleanedText.length - suffix.length);
        break; // 只移除第一个匹配的后缀
      }
    }

    return cleanedText.trim();
  }

  /**
   * 标准化AI错误响应
   * @param error 原始错误
   * @param context 上下文信息（如API端点、操作类型）
   * @returns 标准化的错误消息
   */
  static normalizeError(error: any, context?: string): string {
    let errorMessage = '未知错误';
    
    if (typeof error === 'string') {
      errorMessage = error;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error.message === 'string') {
      errorMessage = error.message;
    }
    
    // 分类错误类型
    if (errorMessage.includes('API Key') || errorMessage.includes('api key')) {
      return `API密钥错误: ${errorMessage}`;
    }
    
    if (errorMessage.includes('network') || errorMessage.includes('Network') || errorMessage.includes('fetch')) {
      return `网络连接失败: ${errorMessage}`;
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return `请求超时: ${errorMessage}`;
    }
    
    if (errorMessage.includes('rate limit') || errorMessage.includes('Rate Limit')) {
      return `API调用频率限制: ${errorMessage}`;
    }
    
    if (errorMessage.includes('JSON') || errorMessage.includes('json')) {
      return `响应格式错误: ${errorMessage}`;
    }
    
    // 添加上下文信息
    if (context) {
      return `${context}: ${errorMessage}`;
    }
    
    return errorMessage;
  }

  /**
   * 验证API响应是否有效
   * @param response fetch响应对象
   * @returns 验证结果和错误消息
   */
  static async validateResponse(response: Response): Promise<{ valid: boolean; error?: string }> {
    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorText = await response.text();
        if (errorText) {
          errorDetail += `: ${errorText.substring(0, 200)}`;
        }
      } catch (e) {
        // 忽略解析错误
      }
      return { valid: false, error: errorDetail };
    }
    
    return { valid: true };
  }

  /**
   * [P1新增] 修复常见JSON格式错误并尝试恢复
   * 处理AI输出常见问题：尾部多余逗号、未引用的key、单引号替换、注释移除
   */
  private static recoverMalformedJson(content: string): string | null {
    if (!content || content.length < 5) return null;
    
    let jsonCandidate = content;
    
    // 1. 找到JSON结构的起始位置
    const arrayStart = jsonCandidate.indexOf('[');
    const objStart = jsonCandidate.indexOf('{');
    let startIdx = -1;
    if (arrayStart !== -1 && objStart !== -1) {
      startIdx = Math.min(arrayStart, objStart);
    } else if (arrayStart !== -1) {
      startIdx = arrayStart;
    } else if (objStart !== -1) {
      startIdx = objStart;
    }
    if (startIdx === -1) return null;
    
    jsonCandidate = jsonCandidate.substring(startIdx);
    
    // 2. 移除注释（单行 // 和多行 /* */）
    jsonCandidate = jsonCandidate.replace(/\/\*[\s\S]*?\*\//g, '');
    jsonCandidate = jsonCandidate.replace(/\/\/.*$/gm, '');
    
    // 3. 修复尾部多余逗号（JSON最常出现的格式问题）
    jsonCandidate = jsonCandidate.replace(/,(\s*[}\]])/g, '$1');
    
    // 4. 修复单引号为双引号（在JSON结构中）
    // 只在看起来像JSON字符串值的位置替换
    let inDoubleQuote = false;
    let result = '';
    for (let i = 0; i < jsonCandidate.length; i++) {
      const ch = jsonCandidate[i];
      if (ch === '"' && (i === 0 || jsonCandidate[i-1] !== '\\')) {
        inDoubleQuote = !inDoubleQuote;
        result += ch;
      } else if (ch === "'" && !inDoubleQuote) {
        // 检查这个单引号是否在JSON key或value的位置
        const prevNonSpace = jsonCandidate.substring(0, i).replace(/\s/g, '').slice(-1);
        const nextNonSpace = jsonCandidate.substring(i + 1).replace(/\s/g, '').charAt(0);
        // 如果前后是JSON结构字符，很可能是key/value的引号
        if (prevNonSpace === '{' || prevNonSpace === ',' || prevNonSpace === ':' || prevNonSpace === '[' ||
            nextNonSpace === ':' || nextNonSpace === ',' || nextNonSpace === '}' || nextNonSpace === ']') {
          result += '"';
        } else {
          result += ch;
        }
      } else {
        result += ch;
      }
    }
    jsonCandidate = result;
    
    // 5. 尝试平衡括号（brace/bracket matching）
    let braceCount = 0;
    let bracketCount = 0;
    for (let i = 0; i < jsonCandidate.length; i++) {
      const ch = jsonCandidate[i];
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
      if (ch === '[') bracketCount++;
      if (ch === ']') bracketCount--;
    }
    // 补全缺失的闭合括号
    while (braceCount > 0) { jsonCandidate += '}'; braceCount--; }
    while (bracketCount > 0) { jsonCandidate += ']'; bracketCount--; }
    // 如果有负的，说明多了闭合括号，截断
    if (braceCount < 0 || bracketCount < 0) {
      // 简单截断策略：找到最后一个有效位置
      let validEnd = jsonCandidate.length - 1;
      let bc = 0, brc = 0;
      for (let i = 0; i < jsonCandidate.length; i++) {
        const ch = jsonCandidate[i];
        if (ch === '{') bc++;
        if (ch === '}') bc--;
        if (ch === '[') brc++;
        if (ch === ']') brc--;
        if (bc >= 0 && brc >= 0) validEnd = i;
        else break;
      }
      jsonCandidate = jsonCandidate.substring(0, validEnd + 1);
    }
    
    if (jsonCandidate.length < 5) return null;
    return jsonCandidate;
  }

  /**
   * [P1新增] 从逐行格式中提取类JSON数据
   * AI有时返回类似 "term": "translation" 或 term - translation 的行格式
   * 将其转换为标准JSON数组
   */
  private static extractFromLineBasedFormat(content: string): any | null {
    if (!content || content.length < 10) return null;
    
    const lines = content.split(/\n/).filter(l => l.trim().length > 3);
    const entries: Array<Record<string, any>> = [];
    
    // 模式1: "term_text": "target_term" (类似JSON但缺少外层结构)
    const jsonLinePattern = /"([^"]+)"\s*:\s*"([^"]+)"/;
    // 模式2: term_text = target_term 或 term_text - target_term
    const plainLinePattern = /^([^=\-:\n]{2,60})\s*[=\-:]\s*([^=\-:\n]{1,100})$/;
    // 模式3: 中文term | English translation (管道分隔)
    const pipeLinePattern = /^([\u4e00-\u9fa5][\u4e00-\u9fa5\s()（）、，]{1,40})\s*\|\s*([A-Za-z][A-Za-z\s\-',;()]{1,100})$/;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 跳过明显不是数据的行
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      if (/^(terms?|translations?|vocabulary|glossary|dictionary):?\s*$/i.test(trimmed)) continue;
      
      let termText = '';
      let targetText = '';
      
      // 尝试JSON格式
      const jsonMatch = trimmed.match(jsonLinePattern);
      if (jsonMatch) {
        termText = jsonMatch[1].trim();
        targetText = jsonMatch[2].trim();
      } else {
        // 尝试管道分隔（中文术语 | 英文翻译）
        const pipeMatch = trimmed.match(pipeLinePattern);
        if (pipeMatch) {
          termText = pipeMatch[1].trim();
          targetText = pipeMatch[2].trim();
        } else {
          // 尝试等号/破折号/冒号分隔
          const plainMatch = trimmed.match(plainLinePattern);
          if (plainMatch) {
            termText = plainMatch[1].trim();
            targetText = plainMatch[2].trim();
          }
        }
      }
      
      if (termText && targetText && termText.length >= 2 && termText.length <= 50) {
        const zhChars = (termText.match(/[\u4e00-\u9fa5]/g) || []).length;
        const isChineseTerm = zhChars >= 2;
        
        entries.push({
          term_text: termText,
          source_lang: isChineseTerm ? 'zh' : 'en',
          target_term: targetText,
          target_lang: isChineseTerm ? 'en' : 'zh',
          score: 8,
          translation_source: 'line-based-recovery',
          translation_confidence: 0.6,
        });
      }
    }
    
    if (entries.length >= 2) {
      console.log(`[API Response Handler] Line-based recovery extracted ${entries.length} entries from ${lines.length} lines`);
      return entries;
    }
    
    return null;
  }

  /**
   * 从AI响应中提取文本内容（支持不同提供商格式）
   * @param data API响应数据
   * @param provider AI提供商
   * @returns 提取的文本内容
   */
  static extractContentFromResponse(data: any, provider: string = 'openai'): string {
    if (provider === 'anthropic') {
      return data?.content?.[0]?.text || '';
    } else {
      // OpenAI兼容格式（包括DeepSeek）
      return data?.choices?.[0]?.message?.content || '';
    }
  }
}