import { ExtractedTerm } from './term-engine';
import { APIResponseHandler } from './api-response-handler';

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// 支持的AI提供商配置
const AI_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat'
  },
  anthropic: {
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-haiku-20240307'
  }
} as const;

// 旧的设置键名映射到新的AIConfig字段名
const SETTINGS_KEY_MAP = {
  // 新字段（优先）
  'apiKey': 'apiKey',
  'endpoint': 'endpoint',
  'promptTemplate': 'promptTemplate',
  'model': 'model',
  'dataPath': 'dataPath',
  'data_path': 'dataPath',

  // 旧字段（兼容）
  'ai_api_key': 'apiKey',
  'ai_endpoint': 'endpoint',
  'ai_model': 'model',
  'ai_prompt_template': 'promptTemplate'
} as const;

export interface AIConfig {
  apiKey?: string;
  endpoint?: string;
  promptTemplate?: string;
  model?: string;
  dataPath?: string;
}

// 根据端点推断AI提供商和模型
function inferProviderFromEndpoint(endpoint: string): { provider: string; model: string } {
  const lowerEndpoint = endpoint.toLowerCase().trim();
  
  // 检查是否是常见的提供商关键字
  if (lowerEndpoint.includes('deepseek')) {
    return { provider: 'deepseek', model: AI_PROVIDERS.deepseek.defaultModel };
  }
  if (lowerEndpoint.includes('anthropic') || lowerEndpoint.includes('claude')) {
    return { provider: 'anthropic', model: AI_PROVIDERS.anthropic.defaultModel };
  }
  if (lowerEndpoint.includes('openai') || lowerEndpoint.includes('api.openai.com')) {
    return { provider: 'openai', model: AI_PROVIDERS.openai.defaultModel };
  }
  
  // 如果是模型名称而不是端点URL，需要特殊处理
  const modelNamePatterns = [
    { pattern: /gpt-?[34]/, provider: 'openai', model: 'gpt-4o-mini' },
    { pattern: /claude/, provider: 'anthropic', model: AI_PROVIDERS.anthropic.defaultModel },
    { pattern: /deepseek/, provider: 'deepseek', model: AI_PROVIDERS.deepseek.defaultModel }
  ];
  
  for (const { pattern, provider, model } of modelNamePatterns) {
    if (pattern.test(lowerEndpoint)) {
      return { provider, model };
    }
  }
  
  // 默认使用OpenAI
  return { provider: 'openai', model: AI_PROVIDERS.openai.defaultModel };
}

// 获取完整的端点URL
export function getFullEndpoint(config?: AIConfig): { endpoint: string; model: string; provider: string } {
  let endpoint = config?.endpoint || '';
  let model = config?.model || '';
  
  // 如果没有配置端点，使用默认OpenAI
  if (!endpoint) {
    return { 
      endpoint: DEFAULT_OPENAI_URL, 
      model: model || AI_PROVIDERS.openai.defaultModel,
      provider: 'openai'
    };
  }
  
  // 推断提供商和模型
  const inferred = inferProviderFromEndpoint(endpoint);
  
  // 如果endpoint看起来像是模型名称而不是URL，转换为正确的端点
  if (!endpoint.startsWith('http')) {
    // 这是模型名称，需要转换为对应的端点
    endpoint = AI_PROVIDERS[inferred.provider as keyof typeof AI_PROVIDERS]?.endpoint || DEFAULT_OPENAI_URL;
    model = config?.endpoint || endpoint; // 使用用户输入的模型名称
  } else {
    model = model || inferred.model;
  }
  
  return { endpoint, model, provider: inferred.provider };
}

function parseAIResponse(text: string): ExtractedTerm[] {
  try {
    // 使用统一的API响应处理器解析JSON
    const parsed = APIResponseHandler.parseJsonResponse(text);
    if (!Array.isArray(parsed)) return [];

    const terms: ExtractedTerm[] = [];
    
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      
      // 格式1: 新的增强格式，包含完整的AI字段
      if (typeof item.source_term === 'string' || typeof item.term_text === 'string') {
        const term: ExtractedTerm = {
          term_text: String(item.term_text || item.source_term || '').trim(),
          source_lang: String(item.source_lang || 'en'),
          score: Number(item.score) || 1
        };
        
        // 添加AI增强字段（如果存在）
        if (item.target_term && typeof item.target_term === 'string') {
          (term as any).target_term = item.target_term.trim();
        }
        if (item.target_lang && typeof item.target_lang === 'string') {
          (term as any).target_lang = item.target_lang.trim();
        }
        if (item.translation_source && typeof item.translation_source === 'string') {
          (term as any).translation_source = item.translation_source.trim();
        }
        if (item.translation_confidence !== undefined) {
          (term as any).translation_confidence = Number(item.translation_confidence);
        }
        // domain_suggestion 和 domain_confidence 已移除，不再从AI响应中提取
        if (item.abbreviation_suggestion && typeof item.abbreviation_suggestion === 'string') {
          (term as any).abbreviation_suggestion = item.abbreviation_suggestion.trim();
        }
        
        // 确保source_term也存在（用于前端兼容性）
        if (!item.source_term && item.term_text) {
          (term as any).source_term = item.term_text.trim();
        }
        
        terms.push(term);
      }
      // 格式2: 术语, 定义, 领域, 重要性评分 (旧格式)
      else if (typeof item.术语 === 'string') {
        terms.push({
          term_text: item.术语.trim(),
          source_lang: 'zh', // 旧格式默认为中文
          score: Math.max(1, Math.min(10, Number(item.重要性评分) || 5)) // 转换为1-10分
        });
      }
      // 格式3: 可能还有其他格式，尝试通用字段
      else {
        // 尝试找到可能是术语的字段
        const possibleTermFields = ['term', 'text', 'name', 'word', 'phrase'];
        for (const field of possibleTermFields) {
          if (item[field] && typeof item[field] === 'string') {
            terms.push({
              term_text: String(item[field]).trim(),
              source_lang: 'en',
              score: Number(item.score) || Number(item.rating) || 1
            });
            break;
          }
        }
      }
    }
    
    return terms.filter((item) => item.term_text.length > 0);
  } catch (e) {
    console.warn('AI response parse failed', e);
    return [];
  }
}

export async function enhanceTermsWithAI(
  originalTerms: ExtractedTerm[],
  text: string,
  language: 'en' | 'zh' | 'auto',
  config?: AIConfig
): Promise<ExtractedTerm[]> {
  // 获取API Key，优先使用配置中的
  const apiKey = config?.apiKey || process.env.TERM_MANAGER_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  
  // 如果没有API Key，直接返回原始结果
  if (!apiKey || apiKey.trim() === '') {
    console.warn('AI API Key not configured; skipping AI enhancement');
    return originalTerms;
  }

  // 获取完整的端点配置
  const { endpoint, model, provider } = getFullEndpoint(config);
  console.log(`[AI Enhancement] Using provider: ${provider}, endpoint: ${endpoint}, model: ${model}`);

  // 如果没有候选术语，直接返回空数组
  if (!originalTerms || originalTerms.length === 0) {
    console.warn('No candidate terms for AI enhancement');
    return [];
  }

  // 使用用户自定义的提示词模板或默认模板
  const promptTemplate = config?.promptTemplate ||
    '你是专业术语提取助手。给定文本和候选术语，请筛选出真正的专业术语，并评估其重要性（0.0~1.0分）。返回JSON数组，字段：term_text、score、source_lang、target_term、target_lang（可选）。只返回纯JSON数组，不要有其他文本。\n文本：{text}\n候选：{candidates}';

  // 构建提示词
  const renderedPrompt = promptTemplate
    .replace('{text}', text.slice(0, 2900))
    .replace('{candidates}', originalTerms.map((t) => t.term_text).slice(0, 100).join(', '));

  try {
    console.log(`[AI Enhancement] Sending request to ${provider} API, text length: ${text.length}, candidate terms: ${originalTerms.length}`);
    
    // 构建请求体，注意Anthropic API格式不同
    let requestBody: any;
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider === 'anthropic') {
      // Anthropic API格式
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      requestBody = {
        model: model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: renderedPrompt }],
        temperature: 0.1
      };
    } else {
      // OpenAI兼容格式（包括DeepSeek）
      headers['Authorization'] = `Bearer ${apiKey}`;
      requestBody = {
        model: model,
        messages: [{ role: 'user', content: renderedPrompt }],
        max_tokens: 2000,
        temperature: 0.1
      };
    }

    console.log(`[AI Enhancement] Request body prepared, model: ${model}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Enhancement] API request failed: HTTP ${response.status}, ${errorText.substring(0, 200)}`);
      console.warn(`[AI Enhancement] Falling back to original terms due to API error`);
      return originalTerms;
    }

    const payload = await response.json();
    console.log(`[AI Enhancement] Received response from ${provider} API`);

    let aiText = '';
    if (provider === 'anthropic') {
      aiText = payload?.content?.[0]?.text || '';
    } else {
      aiText = payload?.choices?.[0]?.message?.content || '';
    }
    
    if (!aiText) {
      console.warn(`[AI Enhancement] ${provider} API returned empty result`);
      return originalTerms;
    }

    console.log(`[AI Enhancement] Parsing AI response, length: ${aiText.length}`);
    const aiTerms = parseAIResponse(aiText);
    console.log(`[AI Enhancement] Parsed ${aiTerms.length} terms from AI response`);

    if (aiTerms.length === 0) {
      console.warn('[AI Enhancement] No valid terms parsed from AI response');
      return originalTerms;
    }

    // 标准化目标语言的辅助函数
    const normalizeTargetLang = (sourceLang: string, targetLang?: string): string => {
      // 外文术语 → 中文
      if (sourceLang !== 'zh') {
        return 'zh';
      }
      // 中文术语 → 外文（默认为英文，但保持有效的外文语种）
      if (!targetLang || targetLang === 'zh') {
        return 'en';
      }
      // 验证targetLang是否在支持的外文语种列表中
      const supportedLangs = ['en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];
      return supportedLangs.includes(targetLang) ? targetLang : 'en';
    };

    // 处理AI返回的术语，确保语言标记正确
    const enhancedTerms = aiTerms
      .map((aiItem) => {
        // 确定源语言
        const sourceLang = language === 'auto' ? aiItem.source_lang || 'en' : language;
        
        // 标准化目标语言（如果存在）
        let normalizedTargetLang: string | undefined;
        if (aiItem.target_lang) {
          normalizedTargetLang = normalizeTargetLang(sourceLang, aiItem.target_lang);
          // 检查是否源语言和目标语言相同（禁止同语互译）
          if (normalizedTargetLang === sourceLang) {
            console.warn(`AI返回同语互译，已跳过: ${sourceLang} -> ${aiItem.target_lang}`);
            normalizedTargetLang = undefined;
            // 清除目标术语，因为同语互译无效
            delete aiItem.target_term;
          }
        }
        
        return {
          ...aiItem,
          source_lang: sourceLang,
          ...(normalizedTargetLang && { target_lang: normalizedTargetLang })
        };
      })
      .filter((item) => item.term_text && item.term_text.trim().length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);

    console.log(`[AI Enhancement] Successfully enhanced ${enhancedTerms.length} terms`);
    return enhancedTerms;
  } catch (error) {
    console.error('[AI Enhancement] Error:', error);
    console.warn('[AI Enhancement] Falling back to original terms due to error');
    return originalTerms;
  }
}

/**
 * 从设置转换为AIConfig对象
 * 支持两种格式：
 * 1. 数组格式：[{key: string, value: string}, ...] - 从数据库原始格式
 * 2. 对象格式：Record<string, string> - 从getSettings()返回
 * @param settings 设置数据
 * @returns 结构化的AIConfig对象
 */
export function getAIConfigFromSettings(settings: Array<{key: string, value: string}> | Record<string, string>): AIConfig {
  const config: AIConfig = {};
  const valueMap = new Map<string, string>();
  
  // 首先将所有设置放入Map中，处理两种输入格式
  if (Array.isArray(settings)) {
    // 数组格式：[{key: string, value: string}, ...]
    for (const setting of settings) {
      if (setting.key && typeof setting.value === 'string') {
        valueMap.set(setting.key, setting.value);
      }
    }
  } else if (typeof settings === 'object' && settings !== null) {
    // 对象格式：Record<string, string>
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'string') {
        valueMap.set(key, value);
      }
    }
  }
  
  // 映射配置字段，优先使用新字段，回退到旧字段
  for (const [settingsKey, configKey] of Object.entries(SETTINGS_KEY_MAP)) {
    if (valueMap.has(settingsKey) && valueMap.get(settingsKey)?.trim()) {
      // 确保不覆盖已设置的值（新字段优先）
      if (!(configKey in config) || config[configKey as keyof AIConfig] === '') {
        (config as any)[configKey] = valueMap.get(settingsKey);
      }
    }
  }
  
  console.log(`[AI Config] Loaded from settings: ${Object.keys(config).join(', ')}`);
  return config;
}

/**
 * 验证AI配置是否完整
 */
export function validateAIConfig(config: AIConfig): { valid: boolean; reason?: string } {
  if (!config.apiKey || config.apiKey.trim() === '') {
    return { valid: false, reason: 'API Key未配置' };
  }
  
  // 检查API Key格式（基本验证）
  if (config.apiKey.length < 10) {
    return { valid: false, reason: 'API Key格式不正确' };
  }
  
  // 如果有endpoint但不是URL格式，检查是否是有效的模型名称
  if (config.endpoint && !config.endpoint.startsWith('http')) {
    // 检查是否是已知的模型名称
    const validModelPatterns = [
      /gpt-?[34]/,
      /claude/,
      /deepseek/i,
      /^[a-zA-Z0-9_-]+$/ // 基本模型名称格式
    ];
    
    const isValidModel = validModelPatterns.some(pattern => pattern.test(config.endpoint || ''));
    if (!isValidModel) {
      return { valid: false, reason: '模型名称格式不正确' };
    }
  }
  
  return { valid: true };
}

/**
 * 测试AI配置连接
 */
export async function testAIConnection(config: AIConfig): Promise<{ success: boolean; message: string }> {
  const validation = validateAIConfig(config);
  if (!validation.valid) {
    return { success: false, message: `配置验证失败: ${validation.reason}` };
  }
  
  try {
    const { endpoint, model, provider } = getFullEndpoint(config);
    
    // 发送一个简单的测试请求
    const testPrompt = 'Hello, please respond with "OK" if you can read this message.';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = config.apiKey!;
    
    let requestBody: any;
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      requestBody = {
        model: model,
        max_tokens: 10,
        messages: [{ role: 'user', content: testPrompt }],
        temperature: 0
      };
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
      requestBody = {
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 10,
        temperature: 0
      };
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });
    
    if (response.ok) {
      return { success: true, message: `成功连接到 ${provider} (${model})` };
    } else {
      const errorText = await response.text();
      return { success: false, message: `连接失败 (HTTP ${response.status}): ${errorText.substring(0, 100)}` };
    }
  } catch (error) {
    return { success: false, message: `连接错误: ${error instanceof Error ? error.message : String(error)}` };
  }
}
