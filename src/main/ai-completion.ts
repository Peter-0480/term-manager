// AI补全建议服务
// 为术语提供翻译、领域、缩写等AI建议

import { AIConfig, getAIConfigFromSettings, getFullEndpoint } from './ai-client';
import { translateWithAI } from './ai-language-detection';

/**
 * AI补全建议请求参数
 */
export interface AICompletionRequest {
  termText: string;
  sourceLang: string;
  targetLang: string;
  hasTranslation: boolean;
  hasDomain: boolean;
  context?: string;
  domainId?: number;
}

/**
 * AI补全建议响应
 */
export interface AICompletionResponse {
  translation?: {
    text: string;
    lang: string;
    confidence: number;
    alternatives?: string[];
    explanation?: string;
  };
  domain?: {
    id?: number;
    name: string;
    confidence: number;
    fullPath?: string;
  };
  abbreviation?: {
    text: string;
    confidence: number;
    alternatives?: string[];
  };
  definition?: {
    definition: string;
    background: string;
    confidence: number;
  };
  suggestions?: string[];
}

/**
 * 获取AI补全建议
 * 为术语提供翻译、领域、缩写等AI建议
 */
export async function getAITermCompletionSuggestion(
  request: AICompletionRequest,
  config?: AIConfig
): Promise<AICompletionResponse> {
  const response: AICompletionResponse = {};
  
  // 如果没有AI配置，返回空响应
  if (!config?.apiKey) {
    console.warn('AI配置不完整，无法提供AI补全建议');
    return response;
  }
  
  try {
    // 1. 始终尝试提供翻译建议（即使术语已有译文，AI仍可提供参考译文）
    if (request.sourceLang !== request.targetLang) {
      const translationResult = await getTranslationSuggestion(
        request.termText,
        request.sourceLang,
        request.targetLang,
        config,
        request.context
      );
      
      if (translationResult) {
        response.translation = translationResult;
      } else {
        // AI翻译失败时提供降级翻译建议，确保译文建议槽位始终有内容
        const fallbackText = generateFallbackTranslation(
          request.termText,
          request.sourceLang,
          request.targetLang
        );
        if (fallbackText) {
          response.translation = {
            text: fallbackText,
            lang: request.targetLang,
            confidence: 0.3
          };
        }
      }
    }
    
    // 2. 获取领域建议（如果术语没有领域信息）
    if (!request.hasDomain) {
      const domainResult = await getDomainSuggestion(
        request.termText,
        request.sourceLang,
        config
      );
      if (domainResult) {
        response.domain = domainResult;
      }
    }
    
    // 3. 获取术语定义建议
    const definitionResult = await getTermDefinitionSuggestion(
      request.termText,
      request.sourceLang,
      config
    );
    if (definitionResult) {
      response.definition = definitionResult;
    }
    
    return response;
  } catch (error) {
    console.error('AI补全建议失败:', error);
    // 返回降级建议
    return getFallbackSuggestions(request);
  }
}

/**
 * 获取翻译建议
 */
async function getTranslationSuggestion(
  text: string,
  sourceLang: string,
  targetLang: string,
  config: AIConfig,
  context?: string
) {
  try {
    const translationRequest = {
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
      context: context || `术语翻译: ${text}`
    };
    
    const translationResult = await translateWithAI(translationRequest, config);
    
    if (translationResult.text) {
      // 清理冗余前缀
      const cleanedText = cleanTranslationText(translationResult.text);
      
      return {
        text: cleanedText,
        lang: targetLang,
        confidence: translationResult.confidence,
        alternatives: translationResult.alternatives || [],
        explanation: translationResult.explanation
      };
    }
    
    return null;
  } catch (error) {
    console.warn('翻译建议失败:', error);
    return null;
  }
}

/**
 * 获取领域建议
 */
async function getDomainSuggestion(
  text: string,
  sourceLang: string,
  config: AIConfig
) {
  try {
    const { endpoint, model, provider } = getFullEndpoint(config);
    const apiKey = config.apiKey!;
    
    const prompt = `请分析以下术语，并给出最合适的学科领域分类。
    
术语: ${text}
语言: ${sourceLang}

请根据《中国学科分类与代码国家标准（GB/T 13745-2009）》或国际通用的学科分类体系，提供最合适的领域分类。

返回JSON格式，例如：
{
  "name": "计算机科学技术>软件工程>人工智能",
  "confidence": 0.9,
  "reasoning": "该术语属于计算机科学的人工智能领域"
}

或对于更通用的分类：
{
  "name": "计算机科学技术",
  "confidence": 0.8,
  "reasoning": "该术语与计算机技术相关"
}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(provider === 'anthropic' ? { 'x-api-key': apiKey } : {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 200
      })
    });
    
    if (!response.ok) {
      throw new Error(`领域建议请求失败: ${response.status}`);
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
        name: parsed.name || '未分类',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        fullPath: parsed.name
      };
    } catch (parseError) {
      console.warn('领域建议解析失败:', parseError);
      // 返回默认领域建议
      return getDefaultDomainSuggestion(text);
    }
  } catch (error) {
    console.warn('领域建议失败:', error);
    return getDefaultDomainSuggestion(text);
  }
}

/**
 * 获取默认领域建议（基于关键词）
 */
function getDefaultDomainSuggestion(text: string) {
  const termLower = text.toLowerCase();
  
  // 领域关键词映射
  const domainKeywords = [
    { name: '计算机科学技术>软件工程>人工智能', keywords: ['神经', '网络', '算法', '机器学习', '深度学习', 'ai', '人工智能'] },
    { name: '计算机科学技术>软件工程', keywords: ['软件', '程序', '代码', '开发', '测试', '系统'] },
    { name: '计算机科学技术>计算机网络', keywords: ['网络', '互联网', '协议', '传输', '连接', '服务器'] },
    { name: '医学>临床医学', keywords: ['医学', '疾病', '治疗', '药物', '健康', '医院', '医生'] },
    { name: '语言学>应用语言学>翻译学', keywords: ['翻译', '语言', '术语', '词汇', '语法', '词典'] },
    { name: '经济学', keywords: ['经济', '金融', '市场', '投资', '价格', '货币'] },
    { name: '法律', keywords: ['法律', '法规', '合同', '条款', '权利', '义务'] }
  ];
  
  for (const domain of domainKeywords) {
    if (domain.keywords.some(keyword => termLower.includes(keyword))) {
      return {
        name: domain.name.split('>')[0], // 只返回一级分类
        confidence: 0.7,
        fullPath: domain.name
      };
    }
  }
  
  // 默认返回计算机科学
  return {
    name: '计算机科学技术',
    confidence: 0.5,
    fullPath: '计算机科学技术'
  };
}

/**
 * 获取缩写建议
 */
function getAbbreviationSuggestion(text: string, config?: AIConfig) {
  if (!text) return null;
  
  // 简单缩写生成：取每个单词的首字母
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return null;
  
  const abbreviation = words.map(word => word[0]?.toUpperCase() || '').join('');
  
  if (abbreviation.length >= 2 && abbreviation.length <= 5) {
    return {
      text: abbreviation,
      confidence: 0.7,
      alternatives: generateAbbreviationAlternatives(text)
    };
  }
  
  return null;
}

/**
 * 获取术语定义建议
 * 为术语提供专业的定义和背景信息
 */
async function getTermDefinitionSuggestion(
  text: string,
  sourceLang: string,
  config: AIConfig
) {
  try {
    const { endpoint, model, provider } = getFullEndpoint(config);
    const apiKey = config.apiKey!;
    
    const prompt = `请为以下术语提供专业的定义和背景信息：

术语: ${text}
源语言: ${sourceLang}

要求：
1. 定义：提供简洁、准确的专业定义
2. 背景信息：包括术语的来源、应用领域、重要性、相关概念等
3. 请用中文回答（无论术语的源语言是什么）
4. 不要包含术语本身、翻译建议、缩写建议、源语言等信息

返回JSON格式：
{
  "definition": "术语的专业定义...",
  "background": "术语的背景信息...",
  "confidence": 0.9
}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(provider === 'anthropic' ? { 'x-api-key': apiKey } : {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 300
      })
    });
    
    if (!response.ok) {
      throw new Error(`术语定义建议请求失败: ${response.status}`);
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
        definition: parsed.definition || text + '的专业定义（AI未提供）',
        background: parsed.background || '背景信息未提供',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7))
      };
    } catch (parseError) {
      console.warn('术语定义建议解析失败:', parseError);
      // 返回降级定义建议
      return getFallbackDefinitionSuggestion(text);
    }
  } catch (error) {
    console.warn('术语定义建议失败:', error);
    return getFallbackDefinitionSuggestion(text);
  }
}

/**
 * 降级术语定义建议（当AI服务不可用时使用）
 */
function getFallbackDefinitionSuggestion(text: string) {
  const termLower = text.toLowerCase();
  
  // 简单定义映射（仅用于演示和降级）
  const definitionMap: Record<string, { definition: string; background: string }> = {
    '神经网络': {
      definition: '一种模仿生物神经网络结构和功能的计算模型，由大量互联的处理单元（神经元）组成',
      background: '神经网络是机器学习的重要分支，广泛应用于图像识别、自然语言处理、预测分析等领域。起源于1943年McCulloch和Pitts提出的神经元数学模型，经过多次发展，现已成为人工智能的核心技术之一。'
    },
    '人工智能': {
      definition: '研究、开发用于模拟、延伸和扩展人的智能的理论、方法、技术及应用系统的一门新的技术科学',
      background: '人工智能是计算机科学的一个分支，旨在创建能够执行通常需要人类智能的任务的机器。它包括机器学习、自然语言处理、计算机视觉、机器人技术等多个子领域，正在深刻改变各行各业。'
    },
    '机器学习': {
      definition: '一门多领域交叉学科，专门研究计算机怎样模拟或实现人类的学习行为，以获取新的知识或技能，重新组织已有的知识结构使之不断改善自身的性能',
      background: '机器学习是人工智能的核心，使计算机能够从数据中学习而无需明确编程。主要分为监督学习、无监督学习和强化学习三大类，广泛应用于推荐系统、金融风控、医疗诊断等领域。'
    },
    '计算机': {
      definition: '能够按照程序运行，自动、高速处理海量数据的现代化智能电子设备',
      background: '计算机是现代信息技术的核心，从20世纪40年代的第一台电子计算机ENIAC发展至今，经历了电子管、晶体管、集成电路和大规模集成电路四个时代，深刻改变了人类社会的生产和生活方式。'
    },
    '软件': {
      definition: '一系列按照特定顺序组织的计算机数据和指令的集合',
      background: '软件是计算机系统中与硬件相对应的部分，包括系统软件、应用软件和中间件。软件工程作为一门学科，研究如何以系统化、规范化、可量化的方式开发和维护软件。'
    }
  };
  
  if (definitionMap[text]) {
    return {
      definition: definitionMap[text].definition,
      background: definitionMap[text].background,
      confidence: 0.5
    };
  }
  
  // 如果没有预定义的定义，返回通用定义
  return {
    definition: `${text}的专业术语定义`,
    background: `${text}是该领域的重要概念，具有广泛的应用价值和研究意义。`,
    confidence: 0.3
  };
}

/**
 * 生成缩写备选方案
 */
function generateAbbreviationAlternatives(text: string): string[] {
  const alternatives: string[] = [];
  const words = text.trim().split(/\s+/);
  
  if (words.length > 2) {
    // 取前两个单词的首字母
    const firstTwo = words.slice(0, 2).map(word => word[0]?.toUpperCase() || '').join('');
    if (firstTwo.length === 2) {
      alternatives.push(firstTwo);
    }
    
    // 取每个单词的前两个字母
    const firstTwoChars = words.map(word => word.slice(0, 2).toUpperCase()).join('');
    if (firstTwoChars.length >= 4 && firstTwoChars.length <= 8) {
      alternatives.push(firstTwoChars);
    }
  }
  
  return alternatives;
}

/**
 * 清理翻译文本中的冗余前缀
 */
function cleanTranslationText(text: string): string {
  if (!text) return '';
  
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
    }
  }
  
  return cleanedText.trim();
}

/**
 * 降级建议（当AI服务不可用时使用）
 */
function getFallbackSuggestions(request: AICompletionRequest): AICompletionResponse {
  const response: AICompletionResponse = {};
  
  // 降级翻译建议 - 始终尝试提供译文建议
  if (request.sourceLang !== request.targetLang) {
    const fallbackTranslation = generateFallbackTranslation(
      request.termText,
      request.sourceLang,
      request.targetLang
    );
    
    if (fallbackTranslation) {
      response.translation = {
        text: fallbackTranslation,
        lang: request.targetLang,
        confidence: 0.5
      };
    }
  }
  
  // 降级领域建议
  if (!request.hasDomain) {
    const fallbackDomain = getDefaultDomainSuggestion(request.termText);
    response.domain = fallbackDomain;
  }
  
  // 降级缩写建议
  const fallbackAbbreviation = getAbbreviationSuggestion(request.termText);
  if (fallbackAbbreviation) {
    response.abbreviation = fallbackAbbreviation;
  }
  
  return response;
}

/**
 * 生成降级翻译（简单的语言对映射）
 */
function generateFallbackTranslation(text: string, sourceLang: string, targetLang: string): string {
  // 简单的翻译映射（仅用于演示和降级）
  const translationMap: Record<string, Record<string, Record<string, string>>> = {
    'zh': {
      'en': {
        '神经网络': 'Neural Network',
        '人工智能': 'Artificial Intelligence',
        '机器学习': 'Machine Learning',
        '深度学习': 'Deep Learning',
        '计算机': 'Computer',
        '软件': 'Software',
        '程序': 'Program',
        '代码': 'Code'
      }
    },
    'en': {
      'zh': {
        'Neural Network': '神经网络',
        'Artificial Intelligence': '人工智能',
        'Machine Learning': '机器学习',
        'Deep Learning': '深度学习',
        'Computer': '计算机',
        'Software': '软件',
        'Program': '程序',
        'Code': '代码'
      }
    }
  };
  
  // 检查是否有预定义的翻译
  if (translationMap[sourceLang]?.[targetLang]?.[text]) {
    return translationMap[sourceLang][targetLang][text];
  }
  
  // 如果没有预定义的翻译，返回原始文本（不添加前缀）
  return text;
}

/**
 * 测试AI补全建议服务
 */
export async function testAICompletionService(config: AIConfig): Promise<{ success: boolean; message: string }> {
  try {
    const testRequest: AICompletionRequest = {
      termText: '神经网络',
      sourceLang: 'zh',
      targetLang: 'en',
      hasTranslation: false,
      hasDomain: false
    };
    
    const result = await getAITermCompletionSuggestion(testRequest, config);
    
    if (result.translation || result.domain || result.abbreviation) {
      return {
        success: true,
        message: 'AI补全建议服务测试成功'
      };
    } else {
      return {
        success: false,
        message: 'AI补全建议服务未返回任何建议'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `AI补全建议服务测试失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}