/**
 * Web extraction error classification system
 * Provides specific, user-friendly error messages for different failure scenarios
 */

export enum ExtractionErrorCode {
  // URL related errors
  INVALID_URL = 'INVALID_URL',
  UNREACHABLE_URL = 'UNREACHABLE_URL',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  SSL_ERROR = 'SSL_ERROR',
  TIMEOUT = 'TIMEOUT',
  
  // HTTP status errors
  HTTP_403_FORBIDDEN = 'HTTP_403_FORBIDDEN',
  HTTP_404_NOT_FOUND = 'HTTP_404_NOT_FOUND',
  HTTP_429_RATE_LIMITED = 'HTTP_429_RATE_LIMITED',
  HTTP_5XX_SERVER_ERROR = 'HTTP_5XX_SERVER_ERROR',
  
  // Anti-bot/CDN protection
  VERIFICATION_PAGE = 'VERIFICATION_PAGE',
  VERIFICATION_AFTER_JS_RENDER = 'VERIFICATION_AFTER_JS_RENDER',
  ANTI_BOT_PROTECTION = 'ANTI_BOT_PROTECTION',
  
  // Content issues
  CONTENT_TOO_SHORT = 'CONTENT_TOO_SHORT',
  CONTENT_TOO_SHORT_AFTER_JS = 'CONTENT_TOO_SHORT_AFTER_JS',
  NO_MEANINGFUL_TEXT = 'NO_MEANINGFUL_TEXT',
  CONTENT_TOO_LONG = 'CONTENT_TOO_LONG',
  
  // AI related errors
  AI_POLICY_VIOLATION = 'AI_POLICY_VIOLATION',
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
  AI_EXTRACTION_FAILED = 'AI_EXTRACTION_FAILED',
  
  // JS rendering errors
  JS_RENDER_FAILED = 'JS_RENDER_FAILED',
  JS_RENDER_CRASHED = 'JS_RENDER_CRASHED',
  PUPPETEER_NOT_AVAILABLE = 'PUPPETEER_NOT_AVAILABLE',
  
  // Generic
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  suggestion: string;
  detail?: string;
  isRetryable: boolean;
}

/**
 * Custom Error class that carries structured error information
 * for transmission through the IPC layer to the renderer process.
 */
export class ExtractionErrorClass extends Error {
  code: ExtractionErrorCode;
  suggestion: string;
  isRetryable: boolean;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    suggestion: string,
    isRetryable: boolean,
  ) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.suggestion = suggestion;
    this.isRetryable = isRetryable;
    // Capture proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtractionErrorClass);
    }
  }

  /**
   * Convert to a plain object safe for IPC serialization
   */
  toPlainObject(): ExtractionErrorObj {
    return {
      message: this.message,
      code: this.code,
      suggestion: this.suggestion,
      isRetryable: this.isRetryable,
    };
  }
}

/**
 * Plain object version of extraction error, safe for IPC serialization
 */
export interface ExtractionErrorObj {
  message: string;
  code: ExtractionErrorCode;
  suggestion: string;
  isRetryable: boolean;
}

/**
 * Map error codes to user-friendly messages and troubleshooting suggestions
 */
const ERROR_DETAILS: Record<ExtractionErrorCode, { messageTemplate: string; suggestion: string; isRetryable: boolean }> = {
  [ExtractionErrorCode.INVALID_URL]: {
    messageTemplate: 'URL格式不正确',
    suggestion: '请检查输入的URL是否完整有效，确保包含 http:// 或 https:// 前缀，例如：https://example.com/article',
    isRetryable: false,
  },
  [ExtractionErrorCode.UNREACHABLE_URL]: {
    messageTemplate: '无法访问该URL',
    suggestion: '请检查：1) 您的网络连接是否正常；2) 该网站是否可以在浏览器中正常打开；3) 如果使用了代理或VPN，请检查配置',
    isRetryable: true,
  },
  [ExtractionErrorCode.NETWORK_ERROR]: {
    messageTemplate: '网络连接异常',
    suggestion: '请检查：1) 您的网络连接是否稳定；2) 是否有防火墙或安全软件拦截了程序访问网络；3) 尝试更换网络环境后重试',
    isRetryable: true,
  },
  [ExtractionErrorCode.DNS_RESOLUTION_FAILED]: {
    messageTemplate: 'DNS解析失败，无法找到目标服务器',
    suggestion: '请检查：1) 域名是否正确；2) DNS设置是否正常（可尝试切换至公共DNS如 114.114.114.114）；3) 网络连接是否正常',
    isRetryable: true,
  },
  [ExtractionErrorCode.CONNECTION_REFUSED]: {
    messageTemplate: '目标服务器拒绝连接',
    suggestion: '可能原因：1) 该网站屏蔽了自动抓取工具；2) 目标服务器正在维护中；3) 需要特定的访问权限才能查看内容',
    isRetryable: true,
  },
  [ExtractionErrorCode.CONNECTION_TIMEOUT]: {
    messageTemplate: '连接目标服务器超时',
    suggestion: '可能原因：1) 网络速度较慢；2) 目标服务器响应缓慢；3) 网站位于网络受限区域。建议稍后重试或尝试使用代理',
    isRetryable: true,
  },
  [ExtractionErrorCode.SSL_ERROR]: {
    messageTemplate: 'SSL安全连接失败',
    suggestion: '可能原因：1) 网站SSL证书已过期或无效；2) 系统时间不正确；3) 杀毒软件或防火墙干扰了SSL连接。请检查系统时间是否正确',
    isRetryable: true,
  },
  [ExtractionErrorCode.TIMEOUT]: {
    messageTemplate: '网页抽取操作超时',
    suggestion: '可能原因：1) 网页内容过多加载缓慢；2) 网络速度不稳定；3) AI处理时间过长。建议：1) 检查网络连接；2) 尝试关闭AI增强模式以加快速度；3) 使用「手动文本」方式抽取',
    isRetryable: true,
  },
  [ExtractionErrorCode.HTTP_403_FORBIDDEN]: {
    messageTemplate: '网站拒绝访问（403 Forbidden）',
    suggestion: '该网站主动拒绝了抓取请求。可能原因：1) 网站配置了防盗链策略；2) 需要登录后才能访问；3) 网站限制了IP或地区的访问。建议尝试手动复制网页内容进行文本抽取',
    isRetryable: false,
  },
  [ExtractionErrorCode.HTTP_404_NOT_FOUND]: {
    messageTemplate: '目标网页不存在（404 Not Found）',
    suggestion: '请确认URL是否正确，以及该网页是否仍然存在。建议在浏览器中打开该URL确认页面是否存在',
    isRetryable: false,
  },
  [ExtractionErrorCode.HTTP_429_RATE_LIMITED]: {
    messageTemplate: '请求频率过高，被目标网站限流（429 Too Many Requests）',
    suggestion: '您的请求被目标网站识别为频繁访问而暂时限制。建议：1) 等待几分钟后再重试；2) 降低抽取请求频率；3) 考虑切换至「手动文本」模式',
    isRetryable: true,
  },
  [ExtractionErrorCode.HTTP_5XX_SERVER_ERROR]: {
    messageTemplate: '目标网站服务器异常',
    suggestion: '该问题来自目标网站服务器端，通常非本软件问题。建议：1) 稍后重试；2) 确认目标网站是否正常运行（可在浏览器中打开确认）',
    isRetryable: true,
  },
  [ExtractionErrorCode.VERIFICATION_PAGE]: {
    messageTemplate: '目标网站触发了人机验证页面',
    suggestion: '该网站检测到自动访问并返回了验证码/人机验证页面（如Cloudflare、极验等）。建议：1) 尝试在浏览器中手动访问该页面完成验证；2) 使用「手动文本」方式复制已验证的网页内容进行抽取',
    isRetryable: false,
  },
  [ExtractionErrorCode.VERIFICATION_AFTER_JS_RENDER]: {
    messageTemplate: '即使用JS渲染方式也无法绕过验证页面',
    suggestion: '该网站的反爬虫保护较为严格，无法通过程序自动获取内容。建议：1) 在浏览器中手动打开该网页；2) 复制网页正文内容；3) 使用「手动文本」方式进行术语抽取',
    isRetryable: false,
  },
  [ExtractionErrorCode.ANTI_BOT_PROTECTION]: {
    messageTemplate: '目标网站配置了较强的反爬虫保护',
    suggestion: '该网站检测并阻止了自动化抓取工具。可能原因：1) 网站使用了高级反爬虫技术；2) 需要浏览器Cookie或用户行为验证。建议：1) 手动复制网页内容；2) 更换信息来源；3) 使用浏览器插件导出页面内容后导入',
    isRetryable: false,
  },
  [ExtractionErrorCode.CONTENT_TOO_SHORT]: {
    messageTemplate: '提取到的网页文本内容过少',
    suggestion: '可能原因：1) 网页主要内容通过JavaScript动态加载，普通抓取无法获取；2) 页面为SPA单页应用需要JS渲染；3) 页面内容位于iframe中。建议：1) 确认启用了「AI增强模式」进行JS渲染；2) 手动复制完整网页内容后使用「文本抽取」功能',
    isRetryable: true,
  },
  [ExtractionErrorCode.CONTENT_TOO_SHORT_AFTER_JS]: {
    messageTemplate: '即使启用JS渲染，提取到的内容仍然过少',
    suggestion: '可能原因：1) 页面内容需要用户交互（如滚动加载）才能完全显示；2) 页面使用了特殊的内容加载方式。建议：1) 手动复制完整的页面内容；2) 使用「手动文本」方式进行术语抽取',
    isRetryable: false,
  },
  [ExtractionErrorCode.NO_MEANINGFUL_TEXT]: {
    messageTemplate: '提取到的文本不包含有价值的术语内容',
    suggestion: '该网页可能主要为图片、视频等非文本内容，或文本内容不属于专业领域术语。建议：1) 尝试其他包含技术文档、百科、论文等文本密集型网页；2) 确保网页包含中文或英文专业内容',
    isRetryable: false,
  },
  [ExtractionErrorCode.CONTENT_TOO_LONG]: {
    messageTemplate: '网页文本内容过长，超出处理限制',
    suggestion: '当前页面文本量过大，超出了系统处理上限。建议：1) 使用「手动文本」方式，分批复制文本内容进行抽取；2) 选择页面中核心的技术章节部分进行抽取',
    isRetryable: false,
  },
  [ExtractionErrorCode.AI_POLICY_VIOLATION]: {
    messageTemplate: '网页内容可能违反了AI服务的内容安全政策',
    suggestion: 'AI服务检测到该网页内容可能包含不安全或违规信息，已自动拒绝处理。这可能是因为：1) 网页内容包含敏感信息；2) AI服务的安全策略匹配到了某些关键词。建议尝试使用「非AI模式」或检查网页内容',
    isRetryable: false,
  },
  [ExtractionErrorCode.AI_SERVICE_UNAVAILABLE]: {
    messageTemplate: 'AI服务当前不可用',
    suggestion: '可能原因：1) AI服务配额用尽；2) AI服务正在维护中；3) API密钥配置有误。建议：1) 检查AI配置是否正确；2) 暂时使用「非AI模式」进行抽取；3) 稍后重试AI功能',
    isRetryable: true,
  },
  [ExtractionErrorCode.AI_EXTRACTION_FAILED]: {
    messageTemplate: 'AI术语提取过程出错',
    suggestion: 'AI在分析网页内容时遇到了问题。可能原因：1) 文本格式不适合AI处理；2) AI模型暂时繁忙。建议：1) 重试一次；2) 尝试使用「非AI模式」；3) 使用「手动文本」方式',
    isRetryable: true,
  },
  [ExtractionErrorCode.JS_RENDER_FAILED]: {
    messageTemplate: 'JavaScript渲染失败',
    suggestion: '程序无法启动内置浏览器引擎来渲染动态网页。可能原因：1) 系统缺少必要的运行库；2) 杀毒软件拦截了渲染进程。建议：1) 关闭AI增强模式使用普通抓取；2) 手动复制网页内容',
    isRetryable: false,
  },
  [ExtractionErrorCode.JS_RENDER_CRASHED]: {
    messageTemplate: 'JS渲染引擎意外崩溃',
    suggestion: '内置浏览器引擎在处理该网页时崩溃。可能是页面过于复杂或包含不兼容的脚本。建议：1) 关闭AI增强模式重试；2) 使用「手动文本」方式替代',
    isRetryable: true,
  },
  [ExtractionErrorCode.PUPPETEER_NOT_AVAILABLE]: {
    messageTemplate: 'JS渲染引擎未正确安装',
    suggestion: '程序的浏览器渲染组件可能缺失。这通常发生在首次运行或安装不完整的情况下。建议：1) 重启程序让系统自动安装所需组件；2) 暂时使用非AI模式',
    isRetryable: false,
  },
  [ExtractionErrorCode.UNKNOWN_ERROR]: {
    messageTemplate: '发生未知错误',
    suggestion: '程序遇到了未预期的异常。建议：1) 检查控制台日志了解详情；2) 重启程序后重试；3) 联系技术支持并附上错误详情',
    isRetryable: true,
  },
};

/**
 * Classify an error into a specific ExtractionError with user-friendly details
 */
export function classifyExtractionError(
  error: Error | string,
  fallbackCode: ExtractionErrorCode = ExtractionErrorCode.UNKNOWN_ERROR,
): ExtractionError {
  const errorMessage = typeof error === 'string' ? error : error.message || 'Unknown error';
  const lowerMessage = errorMessage.toLowerCase();
  
  // Try to detect error code from known patterns
  let code = fallbackCode;
  
  if (lowerMessage.includes('dns') || lowerMessage.includes('enotfound') || lowerMessage.includes('getaddrinfo')) {
    code = ExtractionErrorCode.DNS_RESOLUTION_FAILED;
  } else if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
    code = ExtractionErrorCode.CONNECTION_REFUSED;
  } else if (lowerMessage.includes('econnreset') || lowerMessage.includes('socket hang up')) {
    code = ExtractionErrorCode.CONNECTION_REFUSED;
  } else if (lowerMessage.includes('etimedout') || lowerMessage.includes('timeout')) {
    code = ExtractionErrorCode.CONNECTION_TIMEOUT;
  } else if (lowerMessage.includes('certificate') || lowerMessage.includes('ssl') || lowerMessage.includes('tls')) {
    code = ExtractionErrorCode.SSL_ERROR;
  } else if (lowerMessage.includes('econnaborted') || lowerMessage.includes('aborted')) {
    code = ExtractionErrorCode.NETWORK_ERROR;
  } else if (lowerMessage.includes('403') || lowerMessage.includes('forbidden')) {
    code = ExtractionErrorCode.HTTP_403_FORBIDDEN;
  } else if (lowerMessage.includes('404') || lowerMessage.includes('not found')) {
    code = ExtractionErrorCode.HTTP_404_NOT_FOUND;
  } else if (lowerMessage.includes('429') || lowerMessage.includes('too many requests') || lowerMessage.includes('rate limit')) {
    code = ExtractionErrorCode.HTTP_429_RATE_LIMITED;
  } else if (lowerMessage.includes('500') || lowerMessage.includes('502') || lowerMessage.includes('503')) {
    code = ExtractionErrorCode.HTTP_5XX_SERVER_ERROR;
  } else if (lowerMessage.includes('verification') || lowerMessage.includes('captcha') || lowerMessage.includes('cloudflare') || lowerMessage.includes('验证')) {
    code = ExtractionErrorCode.VERIFICATION_PAGE;
  } else if (lowerMessage.includes('anti-bot') || lowerMessage.includes('反爬') || lowerMessage.includes('blocked')) {
    code = ExtractionErrorCode.ANTI_BOT_PROTECTION;
  } else if (lowerMessage.includes('policy') || lowerMessage.includes('safety') || lowerMessage.includes('安全') || lowerMessage.includes('违规')) {
    code = ExtractionErrorCode.AI_POLICY_VIOLATION;
  } else if (lowerMessage.includes('too short') || lowerMessage.includes('content too short') || lowerMessage.includes('内容过少')) {
    code = ExtractionErrorCode.CONTENT_TOO_SHORT;
  } else if (lowerMessage.includes('too long') || lowerMessage.includes('内容过长') || lowerMessage.includes('超出')) {
    code = ExtractionErrorCode.CONTENT_TOO_LONG;
  } else if (lowerMessage.includes('empty') || lowerMessage.includes('no content') || lowerMessage.includes('空白') || lowerMessage.includes('无内容')) {
    code = ExtractionErrorCode.NO_MEANINGFUL_TEXT;
  } else if (lowerMessage.includes('puppeteer') || lowerMessage.includes('browser') || lowerMessage.includes('chromium') || lowerMessage.includes('not available')) {
    code = ExtractionErrorCode.PUPPETEER_NOT_AVAILABLE;
  } else if (lowerMessage.includes('crash') || lowerMessage.includes('崩溃') || lowerMessage.includes('killed')) {
    code = ExtractionErrorCode.JS_RENDER_CRASHED;
  }

  const details = ERROR_DETAILS[code];
  let message = details.messageTemplate;
  
  // Append the original detail if it's an unknown error, to help debugging
  if (code === ExtractionErrorCode.UNKNOWN_ERROR && errorMessage) {
    message = `${details.messageTemplate}：${errorMessage}`;
  }

  return {
    code,
    message,
    suggestion: details.suggestion,
    detail: errorMessage,
    isRetryable: details.isRetryable,
  };
}

/**
 * Get a formatted error summary string for display in UI
 */
export function getErrorSummary(error: ExtractionError): string {
  let summary = `❌ ${error.message}`;
  if (error.suggestion) {
    summary += `\n\n💡 ${error.suggestion}`;
  }
  return summary;
}