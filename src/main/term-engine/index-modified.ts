import fs from 'fs';
import mammoth from 'mammoth';
import { enhanceTermsWithAI, AIConfig } from '../ai-client';
import { 
  smartExtractTerms as smartExtractTermsImpl, 
  ExtractionStrategy, 
  DEFAULT_STRATEGY,
  SmartExtractionResult 
} from './smart-extractor';
import { advancedFetch } from '../advanced-fetcher';

export interface ExtractedTerm {
  term_text: string;
  score: number;
  source_lang: string;
  // AI增强字段（可选）
  target_term?: string;
  target_lang?: string;
  translation_source?: string;
  translation_confidence?: number;
  domain_suggestion?: string;
  domain_confidence?: number;
  abbreviation_suggestion?: string;
}

// 英文停用词表 - 扩展版本
const ENGLISH_STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','when','at','by','from','for','with','without','of','on','in','into','to','as','is','are','was','were','be','been','being','this','that','these','those',
  // 扩展停用词
  'to', 'of', 'in', 'for', 'on', 'with', 'by', 'at', 'from', 'up', 'about', 'into', 'over', 'after', 'other', 'such', 'each', 'which', 'these', 'those',
  'their', 'what', 'his', 'her', 'its', 'our', 'your', 'all', 'any', 'both', 'few', 'more', 'most', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'could', 'would', 'shall', 'may', 'might', 'must', 'also', 'here', 'there',
  'where', 'why', 'how', 'who', 'whom', 'whose', 'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves',
  'am', 'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having',
  // 常见高频非专业词汇
  'terms', 'term', 'concepts', 'concept', 'solutions', 'solution', 'applications', 'application',
  'model', 'models', 'key', 'important', 'related', 'security', 'computing', 'cloud',
  'business', 'technical', 'technology', 'based', 'powered', 'driving', 'time',
  'availability', 'platform', 'source', 'grade', 'critical', 'factor', 'authentication',
  'encryption', 'intelligence', 'learning', 'processing', 'networks', 'things',
  'data', 'integration', 'deployment', 'devops', 'orchestration', 'serverless',
  'microservices', 'container', 'investment', 'indicators', 'management', 'planning'
]);

// 中文停用词表
const CHINESE_STOPWORDS = new Set([
  '的', '在', '了', '是', '和', '与', '及', '或', '就', '这', '那', '个', '种', '些', '之', '其', '而', '以', '但', '却', '并', '且', 
  '因', '为', '所以', '于是', '因此', '然而', '并且', '或者', '虽然', '但是', '如果', '那么', '因为', '所以', '因此', '于是', '以及', 
  '包括', '涉及', '关于', '对于', '关于', '至于', '除了', '除了', '以外', '以外', '除了', '其他', '别的', '一些', '有些', '任何', '所有',
  '每', '各', '本', '该', '此', '彼', '这些', '那些', '什么', '怎么', '如何', '为什么', '哪里', '谁', '哪个', '哪些', '自己', '互相', '彼此',
  '非常', '很', '太', '极', '极其', '十分', '相当', '比较', '稍微', '略微', '大概', '大约', '可能', '也许', '或许', '大概', '大约', '左右',
  '上下', '前后', '内外', '中间', '旁边', '附近', '周围', '之间', '之中', '之内', '之外', '以上', '以下', '以前', '以后', '以来', '以往',
  '今后', '后来', '然后', '接着', '随后', '随即', '立刻', '马上', '顿时', '忽然', '突然', '渐渐', '逐渐', '慢慢', '快快', '缓缓', '匆匆'
]);

// 判断是否是专业术语
function isProfessionalTerm(word: string): boolean {
  if (!word || word.length < 2) return false;
  
  // 大写开头
  if (/^[A-Z][a-z]*$/.test(word)) return true;
  
  // 包含数字
  if (/\d/.test(word)) return true;
  
  // 常见专业词汇后缀
  const professionalSuffixes = [
    'tion', 'ment', 'ity', 'ness', 'ance', 'ence', 'ism', 'logy', 'graphy', 'metry', 'scope',
    'ology', 'onomy', 'ics', 'sis', 'itis', 'osis', 'emia', 'oma', 'pathy', 'phobia', 'philia',
    'cracy', 'archy', 'cide', 'vore', 'gen', 'genesis', 'meter', 'gram', 'graph', 'phone', 'scope',
    'able', 'ible', 'al', 'ial', 'ical', 'ual', 'ant', 'ent', 'ary', 'ory', 'ful', 'less', 'ish',
    'ive', 'ous', 'ious', 'eous', 'uous', 'ic', 'tic', 'atic', 'istic', 'istic', 'istic', 'istic'
  ];
  
  const lowerWord = word.toLowerCase();
  for (const suffix of professionalSuffixes) {
    if (lowerWord.endsWith(suffix) && lowerWord.length > suffix.length) {
      return true;
    }
  }
  
  // 缩写（全大写字母）
  if (/^[A-Z]{2,}$/.test(word)) return true;
  
  // 包含连字符的专业术语
  if (word.includes('-') && word.length > 3) {
    const parts = word.split('-');
    if (parts.every(part => part.length >= 2)) {
      return true;
    }
  }
  
  return false;
}

function generateNgrams(tokens: string[], minLen: number, maxLen: number): string[] {
  const items: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let len = minLen; len <= maxLen && i + len <= tokens.length; len++) {
      const slice = tokens.slice(i, i + len);
      if (slice.some((w) => !w)) continue;
      items.push(slice.join(' '));
    }
  }
  return items;
}

function countWords(words: string[]) {
  const counter: Record<string, number> = {};
  words.forEach((w) => {
    const norm = w.trim().toLowerCase();
    if (!norm || norm.length === 0) return;
    counter[norm] = (counter[norm] || 0) + 1;
  });
  return counter;
}

/**
 * Extract text from a PDF buffer using pdfjs-dist.
 */
async function extractTextFromPDF(dataBuffer: Buffer): Promise<string> {
  const loadPdfjs: any = new Function("return require('pdfjs-dist/legacy/build/pdf.js')");
  const pdfjsLib: any = loadPdfjs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) });
  const pdf = await loadingTask.promise;
  const maxPages = pdf.numPages;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map((item: any) => item.str ?? '');
    pageTexts.push(strings.join(' '));
  }

  return pageTexts.join('\n');
}

export async function extractTermsFromText(
  text: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig
): Promise<ExtractedTerm[]> {
  console.log(`[Term Engine] Starting extraction, text length: ${text?.length || 0}, language: ${language}, useAI: ${useAI}`);
  
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('[Term Engine] Invalid or empty text input for extraction');
    return [];
  }

  const trimmedText = text.trim();

  // 自动检测语言
  if (language === 'auto') {
    const zhMatch = trimmedText.match(/[\u4e00-\u9fa5]/g);
    language = zhMatch && zhMatch.length > trimmedText.length / 10 ? 'zh' : 'en';
    console.log(`[Term Engine] Auto-detected language: ${language}, Chinese chars: ${zhMatch?.length || 0}, Total: ${trimmedText.length}`);
  }

  if (language === 'zh') {
    // 中文提取：支持多种模式
    const matches: string[] = [];
    
    // 1. 提取连续汉字序列（2-10个字）
    const segments = trimmedText.match(/[\u4e00-\u9fa5]{2,10}/g) || [];
    matches.push(...segments);
    console.log(`[Term Engine] Found ${segments.length} Chinese segments`);
    
    // 2. 提取夹在汉字中的英数组合
    const mixedPatterns = trimmedText.match(/[\u4e00-\u9fa5]{1,5}[a-zA-Z0-9]{1,3}[\u4e00-\u9fa5]{0,5}/g) || [];
    matches.push(...mixedPatterns);
    console.log(`[Term Engine] Found ${mixedPatterns.length} mixed patterns`);
    
    // 3. 提取中文短语（包含标点分隔）
    const phrases = trimmedText.match(/[\u4e00-\u9fa5]{2,20}(?:[\s,;:.!?()[\]{}'"&|/\\]+[\u4e00-\u9fa5]{2,20})*/g) || [];
    // 分割短语为单个术语
    phrases.forEach(phrase => {
      const words = phrase.split(/[\s,;:.!?()[\]{}'"&|/\\]+/);
      words.forEach(word => {
        if (word.length >= 2 && word.length <= 10 && /[\u4e00-\u9fa5]/.test(word)) {
          matches.push(word);
        }
      });
    });
    console.log(`[Term Engine] Found ${phrases.length} Chinese phrases`);

    if (matches.length === 0) {
      console.warn('No Chinese terms extracted');
      return [];
    }

    const freq = countWords(matches);
    console.log(`Total unique terms: ${Object.keys(freq).length}`);
    
    // 放宽频率限制：只要出现1次以上就计入，后续可调整
    let results = Object.entries(freq)
      .map(([term_text, count]) => ({ term_text, score: count, source_lang: 'zh' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    if (useAI && aiConfig) {
      try {
        console.log('[Term Engine] Starting AI-enhanced extraction for Chinese text');
        console.log(`[Term Engine] AI config: ${Object.keys(aiConfig).join(', ')}`);
        console.log(`[Term Engine] API Key present: ${!!aiConfig.apiKey}`);
        console.log(`[Term Engine] Endpoint: ${aiConfig.endpoint || 'default'}`);
        
        const strategy = {
          ...DEFAULT_STRATEGY,
          aiConfig: aiConfig,
          mode: 'hybrid' as const
        };
        
        console.log('[Term Engine] Calling smartExtractTermsImpl...');
        const smartResults = await smartExtractTermsImpl(trimmedText, 'zh', strategy);
        console.log(`[Term Engine] AI extraction completed, got ${smartResults.length} smart terms`);
        
        // 转换为通用格式并限制数量
        results = smartResults
          .map(term => ({
            term_text: term.term_text,
            score: Math.round(term.score),
            source_lang: term.source_lang,
          }))
          .slice(0, 100);
        
        console.log(`[Term Engine] Final AI-enhanced results: ${results.length} terms`);
      } catch (error) {
        console.error('[Term Engine] AI extraction failed, using rule-based results:', error);
        console.error('[Term Engine] Error details:', error instanceof Error ? error.message : String(error));
        console.error('[Term Engine] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      }
    }
    return results;
  }

  // English extraction
  if (language === 'en') {
    // 改进英文术语抽取逻辑
    console.log(`[Term Engine] Starting English extraction, text length: ${trimmedText.length}`);
    
    // 步骤1: 提取连字符术语（如 "cloud-based", "AI-powered"）
    const hyphenatedTerms = Array.from(new Set(
      (trimmedText.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) || [])
        .map(term => term.toLowerCase())
        .filter(term => term.length >= 3 && !ENGLISH_STOPWORDS.has(term))
    ));
    console.log(`[Term Engine] Found ${hyphenatedTerms.length} hyphenated terms: ${hyphenatedTerms.slice(0, 5).join(', ')}`);
    
    // 步骤2: 智能分词 - 保护连字符术语
    const normalizedText = trimmedText.toLowerCase();
    
    // 临时标记连字符术语，避免被分割
    let protectedText = normalizedText;
    const hyphenMarkers: Record<string, string> = {};
    hyphenatedTerms.forEach((term, index) => {
      const marker = `__HYPHEN_${index}__`;
      hyphenMarkers[marker] = term;
      protectedText = protectedText.replace(new RegExp(`\\b${term.replace(/-/g, '\\-')}\\b`, 'g'), marker);
    });
    
    // 步骤3: 分割为token（基于空格和标点）
    const tokens = protectedText
      .split(/[\s,;:.!?()[\]{}'"&|/\\]+/)
      .map(token => {
        // 还原标记的连字符术语
        if (token.startsWith('__HYPHEN_') && token.endsWith('__') && hyphenMarkers[token]) {
          return hyphenMarkers[token];
        }
        return token;
      })
      .filter((w) => {
        // 过滤有效token：长度>=2，包含字母或数字
        if (w.length < 2) return false;
        if (!/[a-z0-9]/.test(w)) return false;
        return true;
      });

    console.log(`[Term Engine] Extracted ${tokens.length} tokens after processing`);
    
    if (tokens.length === 0) {
      console.warn('No English terms extracted');
      return [];
    }

    // 步骤4: 生成n-gram候选词（1-4个词）
    const ngramCandidates = generateNgrams(tokens, 1, 4)
      .filter((term) => term.length >= 2)
      .filter((term) => {
        // 专业术语检查
        if (isProfessionalTerm(term)) return true;
        
        // 停用词过滤
        const wordsList = term.split(' ');
        if (wordsList.length > 1) {
          const nonStop = wordsList.filter((w) => !ENGLISH_STOPWORDS.has(w));
          return nonStop.length > 0;
        }
        return !ENGLISH_STOPWORDS.has(term);
      });
    
    // 步骤5: 合并所有候选词（包括连字符术语）
    const allCandidates = [...hyphenatedTerms, ...ngramCandidates];
    console.log(`[Term Engine] Total candidates: ${allCandidates.length} (${hyphenatedTerms.length} hyphenated + ${ngramCandidates.length} ngrams)`);

    const freq = countWords(allCandidates);
    console.log(`Total unique English terms (phrases included): ${Object.keys(freq).length}`);
    
    // 步骤6: 根据频率和重要性排序
    let results = Object.entries(freq)
      .map(([term_text, count]) => {
        let score = count;
        // 专业术语加分
        if (isProfessionalTerm(term_text)) {
          score *= 2;
        }
        // 连字符术语加分
        if (term_text.includes('-') && term_text.length > 3) {
          score *= 1.5;
        }
        // 多词短语加分
        if (term_text.includes(' ')) {
          score *= 1.2;
        }
        return { term_text, score: Math.round(score), source_lang: 'en' };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    console.log(`[Term Engine] Top 5 English terms: ${results.slice(0, 5).map(r => `${r.term_text} (${r.score})`).join(', ')}`);

    if (useAI && aiConfig) {
      try {
        console.log('[Term Engine] Starting AI-enhanced extraction for English text');
        console.log(`[Term Engine] AI config keys: ${Object.keys(aiConfig).join(', ')}`);
        console.log(`[Term Engine] API Key present: ${!!aiConfig.apiKey}`);
        console.log(`[Term Engine] Endpoint: ${aiConfig.endpoint || 'default'}`);
        console.log(`[Term Engine] Model: ${aiConfig.model || 'default'}`);
        
        const strategy = {
          ...DEFAULT_STRATEGY,
          aiConfig: aiConfig,
          mode: 'hybrid' as const
        };
        
        console.log('[Term Engine] Calling smartExtractTermsImpl for English...');
        const smartResults = await smartExtractTermsImpl(trimmedText, 'en', strategy);
        console.log(`[Term Engine] AI extraction completed, got ${smartResults.length} smart terms`);
        
        if (smartResults.length === 0) {
          console.warn('[Term Engine] AI extraction returned empty results');
        } else {
          console.log('[Term Engine] First few AI results:', smartResults.slice(0, 3).map(r => r.term_text));
        }
        
        // 转换为通用格式并限制数量
        results = smartResults
          .map(term => ({
            term_text: term.term_text,
            score: Math.round(term.score),
            source_lang: term.source_lang,
          }))
          .slice(0, 100);
        
        console.log(`[Term Engine] Final AI-enhanced English results: ${results.length} terms`);
      } catch (error) {
        console.error('[Term Engine] AI extraction failed, using rule-based results:', error);
        console.error('[Term Engine] Error details:', error instanceof Error ? error.message : String(error));
        console.error('[Term Engine] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      }
    }
    return results;
  }

  console.warn(`Unsupported language: ${language}`);
  return [];
}

export async function extractTermsFromFile(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false
  , aiConfig?: AIConfig
): Promise<ExtractedTerm[]> {
  console.log(`[Term Engine] extractTermsFromFile called: ${filePath}, language: ${language}, useAI: ${useAI}`);
  
  const ext = filePath.split('.').pop()?.toLowerCase();
  console.log(`[Term Engine] File extension: ${ext}`);
  
  if (!ext) {
    console.error('[Term Engine] Unable to determine file extension');
    throw new Error('Invalid file path: cannot determine file type');
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`[Term Engine] File does not exist: ${filePath}`);
    throw new Error('Invalid file path: file not found');
  }
  
  console.log(`[Term Engine] File exists, reading content...`);

  let text = '';
  try {
    if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'rtf' || ext === 'xml' || ext === 'doc' || ext === 'xls' || ext === 'xlsx') {
      console.log(`[Term Engine] Reading plain text file: ${ext}`);
      text = fs.readFileSync(filePath, 'utf-8');
      console.log(`[Term Engine] Successfully read ${text.length} characters from text file`);
    } else if (ext === 'docx') {
      console.log('[Term Engine] Reading DOCX file with mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
      console.log(`[Term Engine] Successfully extracted ${text.length} characters from DOCX`);
    } else if (ext === 'pdf') {
      console.log('[Term Engine] Reading PDF file with pdfjs-dist');
      const dataBuffer = fs.readFileSync(filePath);
      text = await extractTextFromPDF(dataBuffer);
      console.log(`[Term Engine] Successfully extracted ${text.length} characters from PDF`);
    } else if (ext === 'html' || ext === 'htm') {
      console.log('[Term Engine] Reading HTML file');
      const html = fs.readFileSync(filePath, 'utf-8');
      console.log(`[Term Engine] HTML content length: ${html.length} characters`);
      // 简化HTML文本提取，避免引入cheerio（cheerio内部依赖undici可能会导致node:sqlite加载问题）
      const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
      const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
      const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ');
      text = withoutTags.replace(/\s+/g, ' ').trim();
      console.log(`[Term Engine] Extracted text length after cleaning: ${text.length} characters`);
    } else {
      console.error(`[Term Engine] Unsupported file type: ${ext}`);
      throw new Error('Unsupported file type for extraction: ' + ext);
    }
  } catch (error) {
    console.error(`[Term Engine] Error reading/extracting text from file:`, error);
    throw new Error(`Failed to extract text from file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!text || text.trim().length === 0) {
    console.warn('[Term Engine] Extracted text is empty or too short');
  } else {
    console.log(`[Term Engine] Final extracted text: ${text.length} characters, preview: "${text.substring(0, 100)}..."`);
  }

  console.log(`[Term Engine] Calling extractTermsFromText with useAI=${useAI}`);
  const result = await extractTermsFromText(text, language, useAI, aiConfig);
  console.log(`[Term Engine] extractTermsFromText returned ${result.length} terms`);
  
  if (result.length === 0) {
    console.warn('[Term Engine] No terms extracted from file content');
  }
  
  return result;
}

export async function extractTermsFromUrl(
  url: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig
): Promise<ExtractedTerm[]> {
  try {
    // 使用高级抓取器
    const result = await advancedFetch({
      url,
      timeout: 45000, // 45秒超时
      retryCount: 3,
      useJavaScript: false,
    });
    
    if (!result.success) {
      throw new Error(result.error || '网页抓取失败');
    }
    
    const html = result.html;
    console.log(`[Term Engine] Successfully extracted ${html.length} chars from URL: ${url}`);
    
    // Simple HTML text extraction
    const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
    const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ');
    const text = withoutTags.replace(/\s+/g, ' ').trim();
    
    return extractTermsFromText(text, language, useAI, aiConfig);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，网站响应过慢或无法访问。');
    }
    throw new Error('网页抽取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 智能抽取API - 使用新的智能抽取引擎
 */
export async function smartExtractTerms(
  text: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  return smartExtractTermsImpl(text, language, strategy);
}

/**
 * 智能从文件抽取
 */
export async function smartExtractTermsFromFile(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || !fs.existsSync(filePath)) {
    throw new Error('Invalid file path');
  }

  let text = '';
  if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'rtf' || ext === 'xml' || ext === 'doc' || ext === 'xls' || ext === 'xlsx') {
    text = fs.readFileSync(filePath, 'utf-8');
  } else if (ext === 'docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else if (ext === 'pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    text = await extractTextFromPDF(dataBuffer);
  } else if (ext === 'html' || ext === 'htm') {
    const html = fs.readFileSync(filePath, 'utf-8');
    const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
    const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ');
    text = withoutTags.replace(/\s+/g, ' ').trim();
  } else {
    throw new Error('Unsupported file type for extraction: ' + ext);
  }

  return smartExtractTerms(text, language, strategy);
}

/**
 * 智能从URL抽取
 */
export async function smartExtractTermsFromUrl(
  url: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  try {
    // 使用高级抓取器
    const result = await advancedFetch({
      url,
      timeout: 45000, // 45秒超时
      retryCount: 3,
      useJavaScript: false,
    });
    
    if (!result.success) {
      throw new Error(result.error || '网页抓取失败');
    }
    
    const html = result.html;
    console.log(`[Term Engine] Successfully extracted ${html.length} chars from URL: ${url}`);
    
    // Simple HTML text extraction
    const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
    const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ');
    const text = withoutTags.replace(/\s+/g, ' ').trim();
    
    return smartExtractTerms(text, language, strategy);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，网站响应过慢或无法访问。');
    }
    throw new Error('网页抽取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}