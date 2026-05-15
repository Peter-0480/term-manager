/**
 * 统一的 AI API Fetch 工具
 * 集中管理超时、重试、错误处理，消除冗余 fetch 代码
 */

export interface AIFetchOptions {
  timeout?: number;       // 超时时间（毫秒），默认 30000
  retries?: number;       // 重试次数，默认 1
  retryDelay?: number;    // 重试延迟（毫秒），默认 1000
  signal?: AbortSignal;   // 外部信号（用于合并）
  retryOnTimeout?: boolean; // 超时是否重试，默认 false
}

/**
 * 统一的 AI API 请求
 * 支持超时、自动重试、多提供商格式
 */
export async function aiFetch(
  endpoint: string,
  apiKey: string,
  body: any,
  options: AIFetchOptions = {}
): Promise<Response> {
  const {
    timeout = 30000,
    retries = 1,
    retryDelay = 1000,
    signal: externalSignal,
    retryOnTimeout = false,
  } = options;

  // 创建超时控制器
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  // 合并外部信号
  const combinedSignal = externalSignal
    ? combineAbortSignals(externalSignal, abortController.signal)
    : abortController.signal;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // 根据端点推断提供商
  const lowerEndpoint = endpoint.toLowerCase();
  if (lowerEndpoint.includes('anthropic')) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[AI Fetch] Retry attempt ${attempt}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);
      return response;

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));

      // 超时错误默认不重试（除非显式设置retryOnTimeout=true）
      if (lastError.name === 'AbortError') {
        if (retryOnTimeout && attempt < retries) {
          console.warn(`[AI Fetch] Attempt ${attempt + 1} timed out, retrying (retryOnTimeout enabled)...`);
          continue;
        }
        throw new Error(`AI请求超时（${timeout / 1000}秒）: ${endpoint}`);
      }

      // 最后一次尝试失败，抛出
      if (attempt === retries) {
        throw lastError;
      }

      console.warn(`[AI Fetch] Attempt ${attempt + 1} failed, retrying...`, lastError.message);
    }
  }

  throw lastError || new Error('未知AI请求错误');
}

/**
 * 从 AI 响应中提取文本内容（支持多提供商）
 */
export function extractContentFromResponse(data: any, endpoint: string): string {
  const lowerEndpoint = endpoint.toLowerCase();

  if (lowerEndpoint.includes('anthropic')) {
    return data?.content?.[0]?.text || '';
  }

  // OpenAI 兼容格式（包括 DeepSeek）
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * 构建 AI 请求体（支持多提供商格式）
 */
export function buildAIBody(
  prompt: string,
  model: string,
  endpoint: string,
  options: { maxTokens?: number; temperature?: number } = {}
): any {
  const { maxTokens = 2000, temperature = 0.1 } = options;
  const lowerEndpoint = endpoint.toLowerCase();

  if (lowerEndpoint.includes('anthropic')) {
    return {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    };
  }

  // OpenAI 兼容格式
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
  };
}

/**
 * 合并多个 AbortSignal
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}
