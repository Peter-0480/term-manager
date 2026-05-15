/**
 * HTML内容提取器
 * 从HTML中提取正文内容，过滤导航/版权/广告等非正文噪声
 */
export interface HtmlContentResult {
  /** 提取的纯文本 */
  text: string;
  /** 原始HTML长度 */
  originalLength: number;
  /** 提取后的文本长度 */
  extractedLength: number;
  /** 是否包含有意义的正文 */
  hasContent: boolean;
}

// 噪声关键词（用于文本级别的行过滤）
const NOISE_KEYWORDS: (string | RegExp)[] = [
  // 版权
  'copyright', 'Copyright', '©', 'All Rights Reserved', 'All rights reserved',
  // ICP备案
  'ICP备', 'ICP证', '沪ICP', '京ICP', '粤ICP', '苏ICP', '浙ICP',
  // 举报
  '举报', '投诉', '违法', '不良信息',
  // 语言相关
  'English', 'Deutsch', 'Français', '日本語', '한국어', 'Español',
  '中文', '繁體', '简体',
  // 按钮文字
  '登录', '注册', '忘记密码', '立即下载', '打开App', '查看全文',
  '分享', '点赞', '收藏', '评论', '转发',
  'Login', 'Register', 'Sign in', 'Sign up', 'Subscribe',
  // 分页
  '上一页', '下一页', '第1页', '首页', '末页',
  'Previous', 'Next', 'Page 1', 'Page 1 of',
  // 广告引导
  '广告', '推广', '赞助', '推荐',
  'Advertisement', 'Sponsored', 'Promoted',
  // 统计数据
  '阅读', '阅读量', '浏览量', '播放', '点赞数',
  '阅读 10万+', '阅读量 10万+',
  // 版权年份模式（如 2000-2025）
  /\d{4}-\d{4}.*(Rights|Reserved|com|cn)/i,
  // ICP备案号模式
  /[京沪粤苏浙]ICP[备证]\d+号/i,
];

// 正文内容的选择器（优先使用）
// 注意：ID 选择器（如 #js_content）比 Class 选择器（如 .rich_media_content）更具体，
// 且某些网站（如微信公众号）的 .rich_media_content 是外层容器，内部 #js_content 才是正文。
// 因此将 ID 选择器排列在 Class 选择器之前，避免容器 div 被优先匹配。
const CONTENT_SELECTORS = [
  // 通用 HTML5 语义标签
  'article',
  '[role="main"]',
  'main',
  // 微信专用 - ID 选择器先于 Class，确保匹配到正文而非外层壳
  '#js_content',
  // 通用 CMS 正文 Class
  '.article-content', '.article_content',
  '.post-content', '.post_content',
  '.entry-content', '.entry_content',
  '.content-article', '#content-article',
  '.rich_media_content',
  '.detail-content', '.detail_content',
  '.news-content', '.news_content',
  '.text-content', '.text_content',
  '.main-content', '.main_content',
  '#main-content', '#main_content',
  '.page-content', '.page_content',
  '.detail', '.article',
  '#article',
  // ────── 中国网站常见 Class（政府、学校、CMS） ──────
  '.TRS_Editor', '.TRS_PreAppend',
  '.bt_content', '.cont', '.text',
  '#Zoom', '#zoom',
  '#content', '#news_content',
  '#UCAP-CONTENT',
  '.pcont', '.p_content',
  '.Custom_UnionStyle',
  '.xxgk_content', '.info_content',
  '[name="Content"]', '[name="Article"]',
].join(',');

/**
 * 清理HTML文本，提取正文内容
 * 策略：优先提取语义内容区，然后过滤噪声元素，最后过滤噪声关键词
 */
export function extractHtmlContent(html: string): HtmlContentResult {
  const originalLength = html.length;
  
  // 如果HTML太短，直接返回
  if (!html || html.length < 50) {
    return { text: '', originalLength, extractedLength: 0, hasContent: false };
  }

  // 第一步：尝试提取内容区
  let contentHtml = extractContentArea(html);
  
  // 第二步：如果没有找到内容区，使用整个HTML
  if (!contentHtml) {
    contentHtml = html;
  }
  
  // 第三步：移除脚本和样式
  let cleanHtml = contentHtml
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  
  // 第四步：块级标签转为换行，再移除标签获取文本
  // [修复] <p> 标签自身也应视为块级分隔（微信文章常用 <p> 而非 </p> 表达段落）
  let text = cleanHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/section>/gi, '\n')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/header>/gi, '\n')
    .replace(/<\/footer>/gi, '\n')
    .replace(/<\/figure>/gi, '\n')
    .replace(/<\/figcaption>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\x26lt;/gi, '<')
    .replace(/\x26gt;/gi, '>')
    .replace(/&/gi, '&')
    .replace(/"/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
  
  // 第五步：规范化空白字符
  text = text
    .replace(/\u00A0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  
  // 第六步：按行过滤噪声
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.length < 4) return false;
    if (isNoiseLine(trimmed)) return false;
    return true;
  });
  
  text = filteredLines.join('\n').trim();
  
  const hasContent = text.length >= 20;
  
  return {
    text,
    originalLength,
    extractedLength: text.length,
    hasContent,
  };
}

/**
 * 计算文本的中文密度（0-1），用于评估内容区域的质量
 */
function getChineseDensity(text: string): number {
  const stripped = text.replace(/<[^>]+>/g, '');
  if (stripped.length < 50) return 0;
  const chineseChars = (stripped.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = stripped.replace(/\s/g, '').length;
  return totalChars > 0 ? chineseChars / totalChars : 0;
}

/**
 * 尝试从HTML中提取内容区
 * 优先级：ID选择器 > 中文密度评分 > 先到先得
 */
function extractContentArea(html: string): string | null {
  const selectors = CONTENT_SELECTORS.split(',');
  let bestContent: string | null = null;
  let bestScore = -1;
  
  for (const selector of selectors) {
    const trimmedSelector = selector.trim();
    if (!trimmedSelector) continue;
    
    const content = extractBySelector(html, trimmedSelector);
    if (!content || content.length <= 200) continue;
    
    // 评分：ID选择器优先（权重3.0）；中文密度加分（0-1）
    const isIdSelector = trimmedSelector.startsWith('#');
    const density = getChineseDensity(content);
    const score = (isIdSelector ? 3.0 : 0) + density;
    
    if (score > bestScore) {
      bestScore = score;
      bestContent = content;
    }
    
    // 如果已经找到高分候选（ID + 中文密度>0.5），提前终止
    if (isIdSelector && density > 0.5 && content.length > 500) {
      return content;
    }
  }
  
  return bestContent;
}

/**
 * 根据选择器提取HTML片段
 * 对ID选择器使用深度感知匹配，正确处理嵌套div等场景
 * [修复] 针对 script/style 标签内文本污染 openRegex 匹配的问题，
 * 当深度匹配失败时自动尝试预剥离后再匹配（微信公众号常见场景）
 */
function extractBySelector(html: string, selector: string): string | null {
  let pattern: RegExp | null = null;
  
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    // 先定位 ID 属性所在的起始标签
    const startPattern = new RegExp(`<([a-zA-Z]+)[^>]*\\s+id\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>`, 'i');
    const startMatch = html.match(startPattern);
    if (startMatch && startMatch.index !== undefined) {
      const tagName = startMatch[1].toLowerCase();
      const startTagEnd = startMatch.index + startMatch[0].length;
      // 使用深度感知匹配：从起始标签后开始，跟踪嵌套层级找到对应的闭合标签
      let content = extractByTagDepth(html, tagName, startTagEnd);
      
      // [修复] 深度匹配失败时的双重降级策略
      // 原因：原始 HTML 中 script/style 标签内的 "<div" 等文本会被 openRegex 误匹配，
      // 导致深度计数错误（多加了嵌套层级），微信公众号等页面常见此问题。
      if (content === null || content.length < 50) {
        // 降级1：预剥离 script/style/noscript（使用等长空格保持位置索引）后重新深度匹配
        const strippedHtml = sanitizeHtmlPreservePositions(html);
        const strippedStartPattern = new RegExp(`<([a-zA-Z]+)[^>]*\\s+id\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>`, 'i');
        const strippedStartMatch = strippedHtml.match(strippedStartPattern);
        if (strippedStartMatch && strippedStartMatch.index !== undefined) {
          const strippedTagName = strippedStartMatch[1].toLowerCase();
          const strippedStartTagEnd = strippedStartMatch.index + strippedStartMatch[0].length;
          content = extractByTagDepth(strippedHtml, strippedTagName, strippedStartTagEnd);
        }
      }
      
      if (content !== null && content.length > 0) {
        return content;
      }
    }
    return null;
  } else if (selector.startsWith('.')) {
    const className = selector.slice(1);
    // 先用宽松正则定位class所在标签
    const startPattern = new RegExp(`<([a-zA-Z]+)[^>]*\\s+class\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`, 'i');
    const startMatch = html.match(startPattern);
    if (startMatch && startMatch.index !== undefined) {
      const tagName = startMatch[1].toLowerCase();
      const startTagEnd = startMatch.index + startMatch[0].length;
      const content = extractByTagDepth(html, tagName, startTagEnd);
      if (content !== null && content.length > 0) {
        return content;
      }
    }
    return null;
  } else if (selector.startsWith('[')) {
    pattern = new RegExp(`<${escapeRegex(selector)}[^>]*>([\\s\\S]*?)<\\/${escapeRegex(selector.split('[')[0])}\\s*>`, 'i');
  } else {
    pattern = new RegExp(`<${escapeRegex(selector)}(\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegex(selector)}\\s*>`, 'i');
  }
  
  if (pattern) {
    const match = html.match(pattern);
    if (match) {
      return match[1] || match[2] || match[0] || null;
    }
  }
  
  return null;
}

/**
 * 深度感知的标签内容提取
 * 从指定位置开始，跟踪嵌套层级正确匹配闭合标签
 * [修复] 新增预剥离参数，避免 script/style 内容污染标签匹配计数
 */
/**
 * 将HTML中的script/style/noscript块替换为等长空格，保持原始位置索引不变
 * 避免块内文本污染标签匹配，同时保证位置偏移量完全一致
 */
function sanitizeHtmlPreservePositions(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, (match) => ' '.repeat(match.length))
    .replace(/<style[\s\S]*?<\/style>/gi, (match) => ' '.repeat(match.length))
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, (match) => ' '.repeat(match.length));
}

function extractByTagDepth(html: string, tagName: string, startPos: number): string | null {
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  if (voidElements.has(tagName)) return null;
  
  // [修复] 使用等长空格替换，保持原始HTML的位置索引不变
  // 这样 closeEnd 在 sanitizedHtml 和原始 html 中指向同一位置
  const sanitizedHtml = sanitizeHtmlPreservePositions(html);
  
  const openRegex = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRegex = new RegExp(`<\\/${tagName}\\s*>`, 'gi');
  
  let depth = 1;
  let pos = startPos;
  let closeEnd = -1;
  
  while (depth > 0 && pos < sanitizedHtml.length) {
    openRegex.lastIndex = pos;
    closeRegex.lastIndex = pos;
    
    const openMatch = openRegex.exec(sanitizedHtml);
    const closeMatch = closeRegex.exec(sanitizedHtml);
    
    if (!closeMatch) {
      // 没有找到对应的闭合标签
      break;
    }
    
    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      pos = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      if (depth === 0) {
        closeEnd = closeMatch.index;
      }
      pos = closeMatch.index + closeMatch[0].length;
    }
  }
  
  if (closeEnd > startPos) {
    return html.substring(startPos, closeEnd);
  }
  
  return null;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断一行文本是否为噪声（包含噪声关键词）
 */
function isNoiseLine(line: string): boolean {
  for (const keyword of NOISE_KEYWORDS) {
    if (typeof keyword === 'string') {
      if (line.includes(keyword)) return true;
    } else if (keyword instanceof RegExp) {
      if (keyword.test(line)) return true;
    }
  }
  return false;
}

/**
 * 简化版的HTML文本提取（用于不支持内容区提取的场景）
 * 仅移除脚本/样式/标签，不做内容过滤
 */
export function simpleHtmlToText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
  // [修复] 块级标签转换为换行，防止双语词汇表条目粘连
  const withNewlines = withoutStyles
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/section>/gi, '\n')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/header>/gi, '\n')
    .replace(/<\/footer>/gi, '\n')
    .replace(/<\/figure>/gi, '\n');
  const withoutTags = withNewlines.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}