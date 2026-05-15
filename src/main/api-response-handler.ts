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