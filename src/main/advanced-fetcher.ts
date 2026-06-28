import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { ExtractionErrorCode, classifyExtractionError, type ExtractionError } from '../types/errors';

export interface FetchOptions {
  url: string;
  timeout?: number;
  retryCount?: number;
  useJavaScript?: boolean;
  userAgent?: string;
  referer?: string;
}

export interface FetchResult {
  success: boolean;
  html: string;
  error?: string;
  errorCode?: ExtractionErrorCode;
  errorSummary?: string;
  errorSuggestion?: string;
  isRetryable?: boolean;
  statusCode?: number;
  redirected?: boolean;
  finalUrl?: string;
}

// 本地Cookie存储路径（延迟初始化）
let COOKIE_DIR: string | null = null;
let COOKIE_FILE: string | null = null;

function initCookiePaths() {
  if (!COOKIE_DIR || !COOKIE_FILE) {
    COOKIE_DIR = path.join(app.getPath('userData'), 'cookies');
    COOKIE_FILE = path.join(COOKIE_DIR, 'cookies.json');
  }
}

function getCookieDir(): string {
  initCookiePaths();
  return COOKIE_DIR!;
}

function getCookieFile(): string {
  initCookiePaths();
  return COOKIE_FILE!;
}

// 扩展的浏览器User-Agent列表（20+个）
const USER_AGENTS = [
  // Chrome Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
  
  // Chrome Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  
  // Firefox Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
  
  // Firefox Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
  
  // Safari Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  
  // Edge Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  
  // Chrome Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  
  // Mobile User Agents
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  
  // 国内浏览器
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 2345Explorer/10.21.0.21453',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 SE 2.X MetaSr 1.0',
  
  // 微信内置浏览器User-Agent（关键）
  'Mozilla/5.0 (Linux; Android 12; SM-G9980) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 Mobile Safari/537.36 MMWEBID/9364 MicroMessenger/8.0.44.2580(0x28002C51) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c29) NetType/WIFI Language/zh_CN',
  'Mozilla/5.0 (Linux; Android 13; 2201123C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 EdgA/108.0.1462.54 MicroMessenger/8.0.44.2580(0x28002C51)',
];

// 常见Referer来源
const COMMON_REFERERS = [
  'https://www.google.com/',
  'https://www.google.com.hk/',
  'https://www.baidu.com/',
  'https://www.bing.com/',
  'https://www.yahoo.com/',
  'https://duckduckgo.com/',
  'https://www.so.com/',
  'https://www.sogou.com/',
  'https://cn.bing.com/',
];

// 加载Cookies
function loadCookies(): Record<string, string> {
  try {
    const cookieFile = getCookieFile();
    const cookieDir = getCookieDir();
    
    if (!fs.existsSync(cookieFile)) {
      if (!fs.existsSync(cookieDir)) {
        fs.mkdirSync(cookieDir, { recursive: true });
      }
      return {};
    }
    const data = fs.readFileSync(cookieFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Advanced Fetcher] Failed to load cookies:', error);
    return {};
  }
}

// 保存Cookies
function saveCookies(cookies: Record<string, string>): void {
  try {
    const cookieDir = getCookieDir();
    const cookieFile = getCookieFile();
    
    if (!fs.existsSync(cookieDir)) {
      fs.mkdirSync(cookieDir, { recursive: true });
    }
    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Advanced Fetcher] Failed to save cookies:', error);
  }
}

// 从URL提取域名，用于Cookie管理
function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

// 检查是否为微信公众号URL
function isWeChatUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('mp.weixin.qq.com') || 
           urlObj.hostname.includes('weixin.qq.com');
  } catch {
    return false;
  }
}

// 获取微信专用User-Agent
function getWeChatUserAgent(): string {
  const wechatUserAgents = [
    'Mozilla/5.0 (Linux; Android 12; SM-G9980) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 Mobile Safari/537.36 MMWEBID/9364 MicroMessenger/8.0.44.2580(0x28002C51) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c29) NetType/WIFI Language/zh_CN',
    'Mozilla/5.0 (Linux; Android 13; 2201123C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 EdgA/108.0.1462.54 MicroMessenger/8.0.44.2580(0x28002C51)',
  ];
  return wechatUserAgents[Math.floor(Math.random() * wechatUserAgents.length)];
}

// 获取微信专用Referer
function getWeChatReferer(): string {
  return 'https://mp.weixin.qq.com/';
}

// 随机延迟函数
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// 获取随机User-Agent
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 获取随机Referer
function getRandomReferer(): string {
  return COMMON_REFERERS[Math.floor(Math.random() * COMMON_REFERERS.length)];
}

// 生成完整的浏览器头部
function generateHeaders(options: FetchOptions): Record<string, string> {
  let userAgent = options.userAgent;
  let referer = options.referer;
  
  // 如果是微信公众号URL，使用专门的微信User-Agent和Referer
  if (isWeChatUrl(options.url)) {
    if (!userAgent) userAgent = getWeChatUserAgent();
    if (!referer) referer = getWeChatReferer();
    console.log(`[Advanced Fetcher] Using WeChat-specific User-Agent for URL: ${options.url}`);
  } else {
    if (!userAgent) userAgent = getRandomUserAgent();
    if (!referer) referer = getRandomReferer();
  }
  
  const domain = getDomainFromUrl(options.url);
  
  // 加载该域名的Cookies
  const cookies = loadCookies();
  const domainCookies = cookies[domain] || '';
  
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6,ko;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Referer': referer,
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    ...(domainCookies ? { 'Cookie': domainCookies } : {}),
  };
}

// 从响应中提取Cookies
function extractCookiesFromResponse(headers: Headers, domain: string): void {
  try {
    const cookieHeader = headers.get('set-cookie');
    if (!cookieHeader) return;
    
    const cookies = loadCookies();
    const existingCookies = cookies[domain] || '';
    
    // 简单的Cookie合并逻辑（实际应更复杂）
    cookies[domain] = existingCookies ? `${existingCookies}; ${cookieHeader}` : cookieHeader;
    
    saveCookies(cookies);
  } catch (error) {
    console.error('[Advanced Fetcher] Failed to extract cookies:', error);
  }
}

// 主抓取函数
export async function advancedFetch(options: FetchOptions): Promise<FetchResult> {
  const {
    url,
    timeout = 45000, // 45秒超时
    retryCount = 3,
    useJavaScript = false,
  } = options;
  
  console.log(`[Advanced Fetcher] Starting fetch for: ${url}, timeout: ${timeout}ms, retries: ${retryCount}`);
  
  // 如果有需要，可以在这里添加JavaScript渲染支持
  if (useJavaScript) {
    console.warn('[Advanced Fetcher] JavaScript rendering requested but not yet implemented');
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      // 随机延迟（除了第一次尝试）
      if (attempt > 1) {
        const delayMs = attempt === 2 ? 2000 : 5000; // 第二次2秒，后续5秒
        console.log(`[Advanced Fetcher] Retry attempt ${attempt}, waiting ${delayMs}ms...`);
        await randomDelay(delayMs, delayMs + 1000);
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const headers = generateHeaders(options);
      const domain = getDomainFromUrl(url);
      
      console.log(`[Advanced Fetcher] Attempt ${attempt}/${retryCount}, User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
        redirect: 'follow',
        // 添加更多fetch选项以提高兼容性
        credentials: 'omit', // 不使用凭证，避免CORS问题
        referrerPolicy: 'no-referrer-when-downgrade',
      });
      
      clearTimeout(timeoutId);
      
      // 提取和保存Cookies
      extractCookiesFromResponse(response.headers, domain);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      }
      
      const html = await response.text();
      const finalUrl = response.url;
      
      // 调试：记录前500个字符（仅当检测到问题时）
      if (attempt === 1) {
        console.log(`[Advanced Fetcher] First 500 chars of response: ${html.substring(0, 500).replace(/\n/g, ' ').replace(/\s+/g, ' ')}`);
      }
      
      // ========== 优化: 分级反爬虫检测，减少误判 ==========
      // 硬性关键词：几乎确定是验证页面
      const hardVerificationKeywords = [
        'captcha', 'verify you are human', 'please verify', 'security check',
        'access denied', 'cloudflare', 'ddos protection', 'rate limit exceeded',
        '环境异常', '反爬虫', '请输入验证码', '请完成验证', '完成验证后即可继续访',
        'environment exception', 'just a moment', 'checking your browser',
        'cf-browser-verification', 'challenge-platform',
      ];
      
      // 软性关键词：需要结合其他条件判断
      const softVerificationKeywords = [
        '验证', '人机验证', '机器人检测', '访问限制', '安全验证',
        '去验证', '验证身份',
      ];
      
      const lowerHtml = html.toLowerCase();
      const hasHardKeyword = hardVerificationKeywords.some(keyword => 
        lowerHtml.includes(keyword.toLowerCase())
      );
      const hasSoftKeyword = softVerificationKeywords.some(keyword => 
        lowerHtml.includes(keyword.toLowerCase())
      );
      
      // 判断是否为验证页面：硬性关键词直接判定，软性关键词需结合页面特征
      let isVerificationPage = false;
      
      if (hasHardKeyword) {
        isVerificationPage = true;
        console.warn(`[Advanced Fetcher] Detected verification page (hard keyword match) on attempt ${attempt}`);
      } else if (hasSoftKeyword) {
        // 软性关键词需要结合以下条件：
        // 1. 页面内容较短（验证页面通常内容少）
        // 2. 没有正常的文章内容结构
        const textWithoutTags = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const hasArticleContent = /<article|<main|<div class="content|<div id="article|<div class="post/.test(lowerHtml);
        const isShortPage = textWithoutTags.length < 500;
        
        if (isShortPage && !hasArticleContent) {
          isVerificationPage = true;
          console.warn(`[Advanced Fetcher] Detected verification page (soft keyword + short content) on attempt ${attempt}`);
        } else {
          console.log(`[Advanced Fetcher] Soft keyword matched but page has normal content, not treating as verification page`);
        }
      }
      
      if (isVerificationPage) {
        console.log(`[Advanced Fetcher] Response preview (1000 chars): ${html.substring(0, 1000).replace(/\n/g, ' ').replace(/\s+/g, ' ')}`);
        
        // 如果不是最后一次尝试，继续重试
        if (attempt < retryCount) {
          continue;
        }
        
        // 最后一次尝试失败，返回错误但提供JavaScript渲染降级提示
        const errorMsg = isWeChatUrl(url) 
          ? '微信公众号文章需要JavaScript渲染才能获取完整内容。请尝试：1) 使用AI增强模式（可能支持JavaScript渲染）；2) 手动复制文章内容到文本抽取功能；3) 使用浏览器访问后复制内容。'
          : '该网站触发了反爬虫保护，无法直接抓取。系统将尝试使用JavaScript渲染模式重新获取...';
        
        // 对于非微信URL，返回特殊错误码让上层可以尝试JavaScript渲染降级
        if (!isWeChatUrl(url)) {
          throw new Error('VERIFICATION_PAGE_NEED_JS_RENDER');
        }
        throw new Error(errorMsg);
      }
      
      // 检查内容是否过少
      const textWithoutTags = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (textWithoutTags.length < 100) {
        console.warn(`[Advanced Fetcher] Extracted text is too short (${textWithoutTags.length} chars) on attempt ${attempt}`);
        
        if (attempt === retryCount) {
          throw new Error('网页内容提取过少，可能页面依赖JavaScript动态加载。请尝试：1) 使用AI增强模式；2) 手动复制网页内容进行文本抽取。');
        }
        
        continue;
      }
      
      console.log(`[Advanced Fetcher] Successfully fetched ${html.length} chars from URL: ${url}`);
      
      return {
        success: true,
        html,
        statusCode: response.status,
        redirected: response.redirected,
        finalUrl,
      };
      
    } catch (error) {
      lastError = error as Error;
      console.error(`[Advanced Fetcher] Attempt ${attempt} failed:`, error);
      
      if (attempt === retryCount) {
        break;
      }
    }
  }
  
  // 所有尝试都失败 - 使用错误分类系统生成详细提示
  const rawMessage = lastError?.message || '未知错误';
  console.error(`[Advanced Fetcher] All ${retryCount} attempts failed for URL: ${url}`);
  
  // 根据HTTP状态码从rawMessage中提取状态码信息
  const statusMatch = rawMessage.match(/HTTP (\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : undefined;
  
  let errorCode: ExtractionErrorCode;
  if (statusCode === 403) {
    errorCode = ExtractionErrorCode.HTTP_403_FORBIDDEN;
  } else if (statusCode === 404) {
    errorCode = ExtractionErrorCode.HTTP_404_NOT_FOUND;
  } else if (statusCode === 429) {
    errorCode = ExtractionErrorCode.HTTP_429_RATE_LIMITED;
  } else if (statusCode && statusCode >= 500) {
    errorCode = ExtractionErrorCode.HTTP_5XX_SERVER_ERROR;
  } else if (rawMessage.includes('VERIFICATION_PAGE_NEED_JS_RENDER') || rawMessage.includes('验证') || rawMessage.includes('反爬虫')) {
    errorCode = ExtractionErrorCode.VERIFICATION_PAGE;
  } else if (rawMessage.includes('内容提取过少') || rawMessage.includes('too short')) {
    errorCode = ExtractionErrorCode.CONTENT_TOO_SHORT;
  } else {
    // 对于其他错误，使用分类器分析错误消息
    const classified = classifyExtractionError(lastError || rawMessage);
    errorCode = classified.code;
  }
  
  const classifiedError = classifyExtractionError(lastError || rawMessage, errorCode);
  
  return {
    success: false,
    html: '',
    error: `网页抽取失败: ${classifiedError.message}`,
    errorCode: classifiedError.code,
    errorSummary: `网页抽取失败: ${classifiedError.message}`,
    errorSuggestion: classifiedError.suggestion,
    isRetryable: classifiedError.isRetryable,
  };
}

// 清理特定域名的Cookies
export function clearCookiesForDomain(domain: string): void {
  const cookies = loadCookies();
  delete cookies[domain];
  saveCookies(cookies);
  console.log(`[Advanced Fetcher] Cleared cookies for domain: ${domain}`);
}

// 清理所有Cookies
export function clearAllCookies(): void {
  try {
    const cookieFile = getCookieFile();
    if (fs.existsSync(cookieFile)) {
      fs.unlinkSync(cookieFile);
    }
    console.log('[Advanced Fetcher] Cleared all cookies');
  } catch (error) {
    console.error('[Advanced Fetcher] Failed to clear cookies:', error);
  }
}

// ========== 优化: 获取特定域名的Cookies（供JavaScript渲染器使用） ==========
export function getCookiesForDomain(domain: string): string {
  try {
    const cookies = loadCookies();
    return cookies[domain] || '';
  } catch (error) {
    console.error('[Advanced Fetcher] Failed to get cookies for domain:', error);
    return '';
  }
}