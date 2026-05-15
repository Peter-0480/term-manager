// JavaScript渲染器 - 用于处理需要JavaScript渲染的网页
// 支持微信公众号等动态内容网站
// ========== 优化: 增强反检测能力、添加Cookie注入、支持验证页面检测重试 ==========

import { app, BrowserView, BrowserWindow } from 'electron';
import { advancedFetch, FetchOptions, FetchResult } from './advanced-fetcher';

interface RenderOptions {
  url: string;
  timeout?: number;
  waitForSelector?: string;
  waitForTimeout?: number;
  evaluateScript?: string;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  /** ========== 优化: 传递给BrowserView的Cookies ========== */
  cookies?: string;
}

interface RenderResult {
  success: boolean;
  html: string;
  text?: string;
  error?: string;
  screenshot?: string; // Base64编码的截图
  metrics?: {
    loadTime: number;
    contentSize: number;
    scriptCount: number;
  };
  /** ========== 优化: 标记是否为验证页面 ========== */
  isVerificationPage?: boolean;
}

// 全局BrowserView实例管理
let rendererView: BrowserView | null = null;
let rendererWindow: BrowserWindow | null = null;

/**
 * 获取微信专用User-Agent
 */
function getWeChatUserAgent(): string {
  const wechatUserAgents = [
    'Mozilla/5.0 (Linux; Android 12; SM-G9980) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 Mobile Safari/537.36 MMWEBID/9364 MicroMessenger/8.0.44.2580(0x28002C51) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c29) NetType/WIFI Language/zh_CN',
    'Mozilla/5.0 (Linux; Android 13; 2201123C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 EdgA/108.0.1462.54 MicroMessenger/8.0.44.2580(0x28002C51)',
  ];
  return wechatUserAgents[Math.floor(Math.random() * wechatUserAgents.length)];
}

/**
 * 判断是否为微信公众号URL
 */
function isWeChatUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('mp.weixin.qq.com') || 
           urlObj.hostname.includes('weixin.qq.com');
  } catch {
    return false;
  }
}

/**
 * ========== 优化: 获取网站特定的User-Agent ==========
 */
function getSiteSpecificUserAgent(url: string): string {
  if (isWeChatUrl(url)) return getWeChatUserAgent();
  
  // 知乎专栏 - 使用桌面端UA
  if (url.includes('zhuanlan.zhihu.com') || url.includes('zhihu.com')) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  
  // CSDN
  if (url.includes('csdn.net')) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  
  return '';
}

/**
 * ========== 优化: 获取网站特定的视口尺寸 ==========
 */
function getSiteSpecificViewport(url: string): { width: number; height: number } {
  if (isWeChatUrl(url)) {
    return { width: 375, height: 812 }; // 模拟移动端
  }
  return { width: 1280, height: 800 };
}

/**
 * ========== 优化: 验证页面关键词检测 ==========
 */
function isVerificationPage(html: string, text: string): boolean {
  const lowerHtml = html.toLowerCase();
  
  // 硬性验证关键词
  const hardKeywords = [
    '环境异常', '去验证', 'captcha', '验证码', '请输入验证码',
    '当前环境异常', '完成验证后即可继续',
    'environment exception', 'just a moment', 'checking your browser',
    'cf-browser-verification', 'challenge-platform', 'ddos protection',
    'rate limit exceeded', 'access denied',
  ];
  
  const hasHardKeyword = hardKeywords.some(k => lowerHtml.includes(k.toLowerCase()));
  
  // 验证页面特征：标题为空或很短，且内容很少
  const hasNoTitle = !/<title[^>]*>[^<]{2,}<\/title>/i.test(html);
  const textLength = (text || '').replace(/\s+/g, '').length;
  const isVeryShort = textLength < 200;
  
  if (hasHardKeyword) {
    console.log(`[JavaScript Renderer] Verification page detected by keyword`);
    return true;
  }
  
  if (hasNoTitle && isVeryShort) {
    console.log(`[JavaScript Renderer] Verification page suspected: no title + short content (${textLength} chars)`);
    return true;
  }
  
  return false;
}

/**
 * 初始化渲染器环境
 */
function initRenderer(): { view: BrowserView; window: BrowserWindow } {
  if (rendererView && rendererWindow) {
    return { view: rendererView, window: rendererWindow };
  }

  // 创建隐藏的BrowserWindow来承载BrowserView
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      javascript: true,
      webviewTag: false,
    }
  });

  window.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  view.setAutoResize({ width: true, height: true });

  rendererView = view;
  rendererWindow = window;

  return { view, window };
}

/**
 * 清理渲染器资源
 */
function cleanupRenderer(): void {
  if (rendererView) {
    try {
      (rendererView as any).destroy();
    } catch (error) {
      console.error('[JavaScript Renderer] Failed to destroy view:', error);
    }
    rendererView = null;
  }

  if (rendererWindow) {
    try {
      rendererWindow.destroy();
    } catch (error) {
      console.error('[JavaScript Renderer] Failed to destroy window:', error);
    }
    rendererWindow = null;
  }
}

/**
 * 使用BrowserView渲染JavaScript页面
 * ========== 优化: 支持Cookie注入、验证页检测、多策略重试 ==========
 */
export async function renderWithJavaScript(options: RenderOptions): Promise<RenderResult> {
  const {
    url,
    timeout = 30000,
    waitForSelector = 'body',
    waitForTimeout = 5000,
    evaluateScript = '',
    viewport: customViewport,
    userAgent: customUserAgent,
    cookies: customCookies,
  } = options;

  console.log(`[JavaScript Renderer] Starting JavaScript rendering for: ${url}`);

  const startTime = Date.now();
  let view: BrowserView | null = null;
  let window: BrowserWindow | null = null;

  try {
    // 初始化渲染器
    const { view: v, window: w } = initRenderer();
    view = v;
    window = w;

    if (!view || !window) {
      throw new Error('无法初始化JavaScript渲染器');
    }

    // ========== 优化: 使用网站特定的User-Agent和视口 ==========
    const siteUserAgent = customUserAgent || getSiteSpecificUserAgent(url);
    const siteViewport = customViewport || getSiteSpecificViewport(url);

    // 设置视口大小
    view.setBounds({ x: 0, y: 0, width: siteViewport.width, height: siteViewport.height });

    // ========== 优化: 设置User-Agent（优先网站专用UA）= ==========
    if (siteUserAgent) {
      console.log(`[JavaScript Renderer] Setting User-Agent: ${siteUserAgent.substring(0, 60)}...`);
      view.webContents.setUserAgent(siteUserAgent);
    }

    // ========== 优化: 注入Cookies ==========
    if (customCookies) {
      try {
        console.log(`[JavaScript Renderer] Injecting cookies: ${customCookies.substring(0, 100)}...`);
        const cookiePairs = customCookies.split(';').map(c => c.trim()).filter(c => c);
        for (const pair of cookiePairs) {
          const [name, ...valueParts] = pair.split('=');
          const value = valueParts.join('=');
          if (name && value) {
            try {
              await view.webContents.session.cookies.set({
                url: url,
                name: name.trim(),
                value: value.trim(),
                domain: new URL(url).hostname,
                path: '/',
                secure: true,
                httpOnly: false,
              });
            } catch (cookieError) {
              console.warn(`[JavaScript Renderer] Failed to set cookie ${name}:`, cookieError);
            }
          }
        }
      } catch (cookieParseError) {
        console.warn('[JavaScript Renderer] Failed to parse/inject cookies:', cookieParseError);
      }
    }

    // ========== 优化: 设置额外的HTTP请求头（通过webRequest拦截） ==========
    if (isWeChatUrl(url)) {
      try {
        const filter = { urls: [url] };
        
        // 移除旧的拦截器
        view.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
          details.requestHeaders['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
          details.requestHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
          if (siteUserAgent) {
            details.requestHeaders['User-Agent'] = siteUserAgent;
          }
          callback({ requestHeaders: details.requestHeaders });
        });
        console.log(`[JavaScript Renderer] Request header interceptor set for WeChat`);
      } catch (interceptorError) {
        console.warn('[JavaScript Renderer] Failed to set request interceptor:', interceptorError);
      }
    }

    // 监听页面事件
    const loadPromise = new Promise<void>((resolve, reject) => {
      const loadTimeout = setTimeout(() => {
        reject(new Error(`页面加载超时 (${timeout}ms)`));
      }, timeout);

      view!.webContents.on('did-finish-load', () => {
        console.log(`[JavaScript Renderer] Page loaded: ${url}`);
        clearTimeout(loadTimeout);
        resolve();
      });

      view!.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`[JavaScript Renderer] Page load failed: ${errorCode} - ${errorDescription}`);
        clearTimeout(loadTimeout);
        reject(new Error(`页面加载失败: ${errorDescription} (${errorCode})`));
      });
    });

    // 加载URL
    console.log(`[JavaScript Renderer] Loading URL: ${url}`);
    await view.webContents.loadURL(url);

    // 等待页面加载完成
    await loadPromise;

    // 等待指定元素出现（如果有）
    if (waitForSelector) {
      console.log(`[JavaScript Renderer] Waiting for selector: ${waitForSelector}`);
      try {
        const selectorFound = await view.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const selector = ${JSON.stringify(waitForSelector)};
            const timeout = ${waitForTimeout};
            const startTime = Date.now();
            
            function checkElement() {
              const element = document.querySelector(selector);
              if (element && element.textContent.trim().length > 20) {
                resolve(true);
                return;
              }
              
              if (Date.now() - startTime > timeout) {
                resolve(false);
                return;
              }
              
              setTimeout(checkElement, 100);
            }
            
            checkElement();
          });
        `);
        
        if (selectorFound) {
          console.log(`[JavaScript Renderer] Selector found with content: ${waitForSelector}`);
        } else {
          console.warn(`[JavaScript Renderer] Selector not found or empty: ${waitForSelector}`);
        }
      } catch (error) {
        console.warn(`[JavaScript Renderer] Wait for selector failed:`, error);
      }
    }

    // 执行自定义JavaScript（如果有）
    if (evaluateScript) {
      console.log(`[JavaScript Renderer] Executing custom script`);
      try {
        await view.webContents.executeJavaScript(evaluateScript);
      } catch (error) {
        console.warn(`[JavaScript Renderer] Custom script execution failed:`, error);
      }
    }

    // 等待额外时间让动态内容加载
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 获取页面HTML
    const html = await view.webContents.executeJavaScript(`
      (function() {
        const clone = document.documentElement.cloneNode(true);
        const scripts = clone.querySelectorAll('script');
        scripts.forEach(script => script.remove());
        return clone.outerHTML;
      })();
    `);

    // 获取页面文本（增强提取）
    const text = await view.webContents.executeJavaScript(`
      (function() {
        const bodyText = document.body?.innerText || '';
        const articleText = document.querySelector('article')?.innerText || '';
        const mainText = document.querySelector('main')?.innerText || '';
        
        // ========== 优化: 支持更多选择器 ==========
        const selectors = [
          'article',
          'main',
          '#js_content',
          '.rich_media_content',
          '.article-content',
          '.post-content',
          '.content',
          '#article',
          '.article',
          '#post',
          '.post',
          '.entry-content',
          '.post-body',
          '.rich_media_area_primary',
          '.rich_media_wrp',
        ];
        
        let bestText = '';
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const txt = el.innerText || '';
            if (txt.length > bestText.length) {
              bestText = txt;
            }
          }
        }
        
        // 如果没有找到专用内容区，用body中最长的段落
        if (!bestText || bestText.length < 50) {
          const paragraphs = document.querySelectorAll('p, div, section');
          let maxLen = 0;
          let maxText = '';
          paragraphs.forEach(p => {
            const txt = p.innerText || '';
            if (txt.length > maxLen) {
              maxLen = txt.length;
              maxText = txt;
            }
          });
          bestText = maxText || bodyText || articleText || mainText || '';
        }
        
        return bestText.trim();
      })();
    `);

    // ========== 优化: 检测验证页面 ==========
    const detectedVerification = isVerificationPage(html, text);

    // 获取页面指标
    const metrics = await view.webContents.executeJavaScript(`
      (function() {
        const title = document.title || '';
        return {
          loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
          contentSize: document.documentElement.outerHTML.length,
          scriptCount: document.querySelectorAll('script').length,
          elementCount: document.querySelectorAll('*').length,
          textLength: document.body?.innerText?.length || 0,
          pageTitle: title,
        };
      })();
    `);

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    console.log(`[JavaScript Renderer] Rendered page in ${totalTime}ms`);
    console.log(`[JavaScript Renderer] Content size: ${html.length} chars, Text: ${text.length} chars, Title: "${metrics.pageTitle}", Verification: ${detectedVerification}`);

    return {
      success: true,
      html,
      text,
      isVerificationPage: detectedVerification,
      metrics: {
        loadTime: totalTime,
        contentSize: html.length,
        scriptCount: metrics.scriptCount || 0,
      }
    };

  } catch (error) {
    console.error(`[JavaScript Renderer] JavaScript rendering failed:`, error);
    
    return {
      success: false,
      html: '',
      text: '',
      error: `JavaScript渲染失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // 清理页面状态，但不销毁视图以便重用
    if (view) {
      try {
        await view.webContents.loadURL('about:blank');
      } catch (error) {
        console.warn('[JavaScript Renderer] Failed to cleanup view:', error);
      }
    }
  }
}

/**
 * ========== 优化: 多策略重试渲染 ==========
 */
async function renderWithRetry(
  url: string,
  baseTimeout: number,
  baseWaitForSelector: string,
  baseWaitForTimeout: number,
  baseViewport: { width: number; height: number },
  cookies?: string,
): Promise<RenderResult> {
  const strategies = [
    // 策略1: 移动端微信UA + 移动视口
    {
      name: 'Mobile WeChat UA',
      userAgent: getWeChatUserAgent(),
      viewport: { width: 375, height: 812 },
    },
    // 策略2: 桌面端Chrome UA + 桌面视口
    {
      name: 'Desktop Chrome UA',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    },
    // 策略3: iPhone Safari UA
    {
      name: 'iPhone Safari UA',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
    },
  ];

  for (const strategy of strategies) {
    console.log(`[JavaScript Renderer] Retrying with strategy: ${strategy.name}`);
    
    const result = await renderWithJavaScript({
      url,
      timeout: baseTimeout,
      waitForSelector: baseWaitForSelector,
      waitForTimeout: baseWaitForTimeout,
      viewport: strategy.viewport,
      userAgent: strategy.userAgent,
      cookies: cookies,
    });

    if (result.success && !result.isVerificationPage) {
      console.log(`[JavaScript Renderer] Strategy ${strategy.name} succeeded`);
      return result;
    }
    
    if (result.isVerificationPage) {
      console.log(`[JavaScript Renderer] Strategy ${strategy.name} got verification page, trying next...`);
      // 短暂等待后重试
      await new Promise(resolve => setTimeout(resolve, 1500));
      continue;
    }
    
    if (!result.success) {
      console.log(`[JavaScript Renderer] Strategy ${strategy.name} failed: ${result.error}`);
      continue;
    }
  }

  // 所有策略都失败，返回最后一个结果
  console.warn(`[JavaScript Renderer] All retry strategies failed for: ${url}`);
  return {
    success: false,
    html: '',
    text: '',
    error: '所有渲染策略均失败，网站可能有严格的反爬虫保护',
    isVerificationPage: true,
  };
}

/**
 * 智能网页抓取 - 自动选择普通抓取或JavaScript渲染
 * ========== 优化: 支持反爬虫自动降级到JavaScript渲染 ==========
 */
export async function smartWebFetch(options: FetchOptions & {
  forceJavaScript?: boolean;
  fallbackToSimple?: boolean;
}): Promise<FetchResult> {
  const {
    url,
    forceJavaScript = false,
    fallbackToSimple = true,
    ...fetchOptions
  } = options;

  console.log(`[Smart Web Fetch] Starting smart fetch for: ${url}, forceJavaScript: ${forceJavaScript}`);

  // ========== 优化: 支持更多需要强制JS渲染的网站 ==========
  const jsRenderSites = [
    'mp.weixin.qq.com',
    'weixin.qq.com',
    'zhuanlan.zhihu.com',
    'juejin.cn',
    'toutiao.com',
    'csdn.net',
    'cnblogs.com',
    'jianshu.com',
    'segmentfault.com',
  ];
  
  const needsJavaScript = forceJavaScript || jsRenderSites.some(site => url.includes(site));
  const isWeChat = url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com');

  if (!needsJavaScript) {
    // 使用普通抓取
    console.log(`[Smart Web Fetch] Using standard fetch for: ${url}`);
    const fetchResult = await advancedFetch({ url, ...fetchOptions });
    
    // ========== 优化: 检测到验证页面时自动降级到JavaScript渲染 ==========
    if (!fetchResult.success && fetchResult.error?.includes('VERIFICATION_PAGE_NEED_JS_RENDER')) {
      console.log(`[Smart Web Fetch] Verification page detected, falling back to JavaScript rendering for: ${url}`);
      
      try {
        const renderResult = await renderWithRetry(
          url,
          fetchOptions.timeout || 60000,
          isWeChat ? '#js_content, .rich_media_content, article' : 'body',
          10000,
          isWeChat ? { width: 375, height: 812 } : { width: 1280, height: 800 },
        );

        if (!renderResult.success) {
          throw new Error(renderResult.error || 'JavaScript渲染失败');
        }

        const textWithoutTags = renderResult.text || 
          renderResult.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        
        if (textWithoutTags.length < 100) {
          throw new Error('JavaScript渲染后内容过少');
        }

        if (renderResult.isVerificationPage) {
          throw new Error('JavaScript渲染后仍为验证页面，网站反爬虫保护较强');
        }

        console.log(`[Smart Web Fetch] JavaScript rendering fallback successful, content length: ${renderResult.html.length} chars`);

        return {
          success: true,
          html: renderResult.html,
          statusCode: 200,
          redirected: false,
          finalUrl: url,
        };
      } catch (jsError) {
        console.error(`[Smart Web Fetch] JavaScript rendering fallback also failed:`, jsError);
        return {
          success: false,
          html: '',
          error: `网页抓取失败：该网站触发了反爬虫保护，且JavaScript渲染也未能获取内容。请尝试：1) 手动复制网页内容进行文本抽取；2) 更换其他网页URL。`,
        };
      }
    }
    
    return fetchResult;
  }

  // 使用JavaScript渲染
  console.log(`[Smart Web Fetch] Using JavaScript rendering for: ${url}`);
  
  try {
    // ========== 优化: 根据不同网站选择不同的等待选择器 ==========
    let waitForSelector: string;
    if (isWeChat) {
      waitForSelector = '#js_content, .rich_media_content, article';
    } else if (url.includes('zhihu.com')) {
      waitForSelector = '.Post-RichText, .RichText, .RichContent-inner';
    } else if (url.includes('csdn.net')) {
      waitForSelector = '#content_views, .article_content';
    } else if (url.includes('cnblogs.com')) {
      waitForSelector = '#cnblogs_post_body, .postBody';
    } else if (url.includes('jianshu.com')) {
      waitForSelector = '._2rhmJa, article';
    } else if (url.includes('segmentfault.com')) {
      waitForSelector = '.article-content';
    } else if (url.includes('juejin.cn')) {
      waitForSelector = '.article-content, .markdown-body';
    } else if (url.includes('toutiao.com')) {
      waitForSelector = '.article-content, .article-body';
    } else {
      waitForSelector = 'article, main, .content, .article, .post';
    }
    
    // ========== 优化: 使用多策略重试 ==========
    const renderResult = await renderWithRetry(
      url,
      fetchOptions.timeout || 45000,
      waitForSelector,
      10000,
      isWeChat ? { width: 375, height: 812 } : { width: 1280, height: 800 },
    );

    if (!renderResult.success) {
      throw new Error(renderResult.error || 'JavaScript渲染失败');
    }

    // ========== 优化: 验证页面检测 ==========
    if (renderResult.isVerificationPage) {
      console.warn(`[Smart Web Fetch] All retry strategies got verification page for: ${url}`);
      
      if (fallbackToSimple) {
        console.log(`[Smart Web Fetch] Falling back to simple fetch as last resort`);
        const simpleResult = await advancedFetch({ url, ...fetchOptions });
        if (simpleResult.success) {
          console.log(`[Smart Web Fetch] Simple fetch succeeded, returning result`);
          return simpleResult;
        }
      }
      
      throw new Error('所有渲染策略均返回验证页面，网站反爬虫保护较强。请尝试手动复制网页内容进行文本抽取。');
    }

    // 检查内容是否有效
    const textWithoutTags = renderResult.text || 
      renderResult.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (textWithoutTags.length < 100) {
      console.warn(`[Smart Web Fetch] JavaScript rendered content is too short (${textWithoutTags.length} chars)`);
      
      if (fallbackToSimple) {
        console.log(`[Smart Web Fetch] Falling back to simple fetch`);
        return advancedFetch({ url, ...fetchOptions });
      } else {
        throw new Error('JavaScript渲染后内容过少');
      }
    }

    console.log(`[Smart Web Fetch] JavaScript rendering successful, content length: ${renderResult.html.length} chars, text: ${textWithoutTags.length} chars`);

    return {
      success: true,
      html: renderResult.html,
      statusCode: 200,
      redirected: false,
      finalUrl: url,
    };

  } catch (error) {
    console.error(`[Smart Web Fetch] JavaScript rendering failed:`, error);
    
    if (fallbackToSimple) {
      console.log(`[Smart Web Fetch] Falling back to simple fetch after JavaScript failure`);
      return advancedFetch({ url, ...fetchOptions });
    }

    return {
      success: false,
      html: '',
      error: `智能网页抓取失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 测试JavaScript渲染功能
 */
export async function testJavaScriptRendering(url: string): Promise<{
  success: boolean;
  message: string;
  metrics?: any;
}> {
  try {
    console.log(`[JavaScript Renderer Test] Testing rendering for: ${url}`);
    
    const result = await renderWithJavaScript({
      url,
      timeout: 15000,
      waitForSelector: 'body',
      waitForTimeout: 5000,
    });

    if (!result.success) {
      return {
        success: false,
        message: `渲染失败: ${result.error}`,
      };
    }

    if (result.isVerificationPage) {
      return {
        success: false,
        message: `渲染成功但获取到验证页面，网站可能触发反爬虫保护`,
        metrics: result.metrics,
      };
    }

    return {
      success: true,
      message: `渲染成功: 获取到${result.html.length}字符内容，${result.text?.length || 0}字符文本`,
      metrics: result.metrics,
    };

  } catch (error) {
    return {
      success: false,
      message: `测试失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 清理所有渲染器资源
 */
export function cleanupAllRenderers(): void {
  console.log('[JavaScript Renderer] Cleaning up all renderer resources');
  cleanupRenderer();
}

// 应用退出时自动清理（安全防护：仅在 Electron app 可用时注册）
if (app && typeof app.on === 'function') {
  app.on('before-quit', () => {
    cleanupAllRenderers();
  });
}
