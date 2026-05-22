import fs from 'fs';
import mammoth from 'mammoth';
import { AIConfig } from '../ai-client';
import { 
  smartExtractTerms as smartExtractTermsImpl, 
  ExtractionStrategy, 
  DEFAULT_STRATEGY,
  SmartExtractionResult 
} from './smart-extractor';
import { smartWebFetch } from '../javascript-renderer';
import { ProgressReporter, ProgressStages, defaultProgressEstimator } from '../progress-reporter';
import { extractHtmlContent, simpleHtmlToText, extractBilingualTableRows, formatBilingualPairsForExtraction, sanitizeHtmlForAI } from '../html-content-extractor';
import { getCanvasDiagnostics } from '../pdf-polyfills';
import { 
  extractTermsFromPDFViaAI, 
  type AIExtractionProgressCallback
} from '../pdf-ai-extractor';
export interface ExtractedTerm {
  term_text: string;
  score: number;
  source_lang: string;
  // AI增强字段（可选）
  target_term?: string;
  target_lang?: string;
  translation_source?: string;
  translation_confidence?: number;
  abbreviation_suggestion?: string;
}

// ═══════════════════════════════════════════
// 统一抽取常量配置
// ═══════════════════════════════════════════

/** 文本篇幅阈值（字符数）：超过此阈值需分块处理 */
const MAX_TEXT_LENGTH_FOR_DIRECT_PROCESSING = 8000;

/** 规则路径分块大小（字符数） */
const RULE_CHUNK_SIZE = 3000;

/** 英文停用词表 - 扩展版本 */
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
  ];
  for (const suffix of professionalSuffixes) {
    if (word.endsWith(suffix)) return true;
  }
  
  // 常见专业词汇前缀
  const professionalPrefixes = [
    'anti', 'auto', 'bi', 'co', 'counter', 'de', 'dis', 'down', 'extra', 'hyper', 'il', 'im', 'in',
    'inter', 'ir', 'mal', 'micro', 'mid', 'mini', 'mis', 'mono', 'multi', 'non', 'out', 'over', 'poly',
    'post', 'pre', 'pro', 're', 'semi', 'sub', 'super', 'tele', 'trans', 'tri', 'ultra', 'un', 'under',
    'up',
  ];
  for (const prefix of professionalPrefixes) {
    if (word.startsWith(prefix) && word.length > prefix.length + 2) return true;
  }
  
  return false;
}

// 生成n-gram
function generateNgrams(tokens: string[], minN: number, maxN: number): string[] {
  const ngrams: string[] = [];
  
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const ngram = tokens.slice(i, i + n).join(' ');
      ngrams.push(ngram);
    }
  }
  
  return ngrams;
}

// 计数函数
function countWords(words: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  return freq;
}

/**
 * 检测文本的语言
 * 返回语种代码和是否双语标记
 * 支持：zh(中文)、en(英文)、fr(法文)、de(德文)、es(西班牙文)、
 *       ja(日文)、ko(韩文)、ru(俄文)、ar(阿拉伯文)、it(意大利文)、pt(葡萄牙文)
 * 混合语言时返回 'mixed'，并通过 isBilingual 标记
 * 
 * [改进v2] 支持非英文拉丁语系识别 + 多语种混合检测
 */
function detectTextLanguage(text: string): { lang: string; isBilingual: boolean } {
  if (!text || text.length < 10) {
    return { lang: 'en', isBilingual: false };
  }

  // 去除空白字符后统计
  const cleanText = text.replace(/\s+/g, '');
  const totalChars = cleanText.length || 1;

  // === 各语种字符计数 ===
  const zhCount = (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const jaCount = (cleanText.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length; // 日文假名
  const koCount = (cleanText.match(/[\uac00-\ud7af]/g) || []).length; // 韩文
  const ruCount = (cleanText.match(/[\u0400-\u04ff]/g) || []).length; // 俄文
  const arCount = (cleanText.match(/[\u0600-\u06ff]/g) || []).length; // 阿拉伯文
  const latinCount = (cleanText.match(/[a-zA-Z]/g) || []).length; // 所有拉丁字母（英文/法文/德文/西班牙文/意大利文/葡萄牙文共用）

  // === 非拉丁语系判定（基于特有字符集，高置信度）===
  const zhRatio = zhCount / totalChars;
  const jaRatio = jaCount / totalChars;
  const koRatio = koCount / totalChars;
  const ruRatio = ruCount / totalChars;
  const arRatio = arCount / totalChars;

  // === 非拉丁语系单语判定（日/韩/俄/阿等） ===
  // 非拉丁语系具有独特的Unicode字符集，高置信度优先判定
  if (jaRatio > 0.4) return { lang: 'ja', isBilingual: false };
  if (koRatio > 0.4) return { lang: 'ko', isBilingual: false };
  if (ruRatio > 0.4) return { lang: 'ru', isBilingual: false };
  if (arRatio > 0.4) return { lang: 'ar', isBilingual: false };

  // === 双语检测：中文 + 其他语种混合 ===
  // [修复] 双语检测必须在"中文占绝对主导"判定之前运行
  // 否则中文字符≥200且比例>0.5时会错误地覆盖双语标签
  if (zhRatio > 0.15) {
    if (jaRatio > 0.05) return { lang: 'mixed', isBilingual: true };  // 中日混合
    if (koRatio > 0.05) return { lang: 'mixed', isBilingual: true };  // 中韩混合
    if (ruRatio > 0.05) return { lang: 'mixed', isBilingual: true };  // 中俄混合
    if (arRatio > 0.05) return { lang: 'mixed', isBilingual: true };  // 中阿混合
    if (latinCount / totalChars > 0.15) return { lang: 'mixed', isBilingual: true }; // 中+拉丁语系混合
  }

  // === 中文占绝对主导（在双语检测不命中时生效） ===
  if (zhCount >= 200 && zhRatio > 0.5) {
    return { lang: 'zh', isBilingual: false };
  }
  if (zhRatio > 0.7) {
    return { lang: 'zh', isBilingual: false };
  }

  // === 拉丁语系：检测具体语种的专用词/特征来区分 ===
  if (latinCount > 50) {
    const detectedLatinLang = detectLatinScriptLanguage(cleanText);
    if (detectedLatinLang) return { lang: detectedLatinLang, isBilingual: false };
  }

  // 中文少量+拉丁语系主导 → mixed
  if (zhRatio > 0.05 && latinCount / totalChars > 0.3) {
    return { lang: 'mixed', isBilingual: true };
  }

  // 默认：拉丁字母为主 → 英文（保守）
  return { lang: 'en', isBilingual: false };
}

/**
 * 拉丁字母语系细粒度识别
 * 通过高置信度功能词/常见词区分英文、法文、德文、西班牙文、意大利文、葡萄牙文
 */
function detectLatinScriptLanguage(text: string): string | null {
  const lower = text.toLowerCase();
  
  // 各语种高置信度功能词/常见词集合（特征词）
  const langFeatures: { lang: string; words: string[] }[] = [
    { lang: 'fr', words: [' le ', ' la ', ' les ', ' des ', ' une ', ' et ', ' dans ', ' pour ', ' avec ', ' sur ', ' que ', ' qui ', ' sont ', ' cette ', ' aussi ', ' plus ', ' mais ', ' tout ', ' leur ', ' deux ', ' france', 'développement', 'gouvernement', 'politique', 'économie', 'croissance', 'emploi', 'formation', 'entreprise'] },
    { lang: 'de', words: [' und ', ' die ', ' der ', ' das ', ' mit ', ' von ', ' für ', ' auf ', ' ist ', ' sich ', ' ein ', 'eine ', ' werden ', ' auch ', ' nicht', 'Deutschland', 'Entwicklung', 'Regierung', 'Wirtschaft'] },
    { lang: 'es', words: [' el ', ' la ', ' los ', ' las ', ' que ', ' una ', ' por ', ' con ', ' para ', ' del ', ' las ', ' más ', ' como ', ' este ', ' entre ', 'desarrollo', 'gobierno', 'economía', 'empresa', 'formación', 'España'] },
    { lang: 'it', words: [' il ', ' la ', ' che ', ' una ', ' per ', ' con ', ' del ', ' sono ', ' come ', ' questa ', ' più ', 'Italia', 'sviluppo', 'governo', 'economia', 'impresa', 'formazione'] },
    { lang: 'pt', words: [' o ', ' a ', ' os ', ' as ', ' que ', ' uma ', ' para ', ' com ', ' não ', ' mais ', ' como ', ' entre ', 'desenvolvimento', 'governo', 'economia', 'empresa', 'Brasil', 'formação', 'crescimento'] },
    { lang: 'en', words: [' the ', ' and ', ' for ', ' with ', ' that ', ' this ', ' have ', ' they ', ' are ', ' from ', ' their ', ' which ', ' about ', ' there ', ' would ', 'development', 'government', 'economy', 'growth', 'policy', 'education'] },
  ];

  const scores: Record<string, number> = {};
  for (const feat of langFeatures) {
    scores[feat.lang] = 0;
    for (const word of feat.words) {
      if (lower.includes(word)) {
        scores[feat.lang] += 1;
      }
    }
  }

  // 找到最高分
  let bestLang = 'en';
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  // 最低3个特征词命中才算高置信度
  if (bestScore >= 3) {
    return bestLang;
  }

  return null; // 无法确定
}

/**
 * [改进] URL/网页文本额外清洗：移除残留的导航、版权、纯数字行等
 * 在 extractHtmlContent 之后、提交抽取之前二次净化
 */
function cleanWebText(text: string): string {
  if (!text || text.length < 10) return text;
   
  const lines = text.split('\n');
  const needsSplitSet = new Set<string>(); // 用 Set 跟踪需要分段的行，避免在原始字符串上设属性
  
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
     
    // 纯数字/日期行（如 "2024-06-01" "123456"）
    if (/^[\d\s\/\-\.,:：]+$/.test(trimmed)) return false;
     
    // 纯URL行
    if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed)) return false;
     
    // 纯邮箱/电话号码行
    if (/^[\d\-\+\(\)\s@\.]+$/.test(trimmed)) return false;
     
    // 明显的导航/页脚行（中文不足3个但英文超过20个字符）
    const zhChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
    const enChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (zhChars < 3 && enChars > 20) return false;
     
    // 单行过长（>300字）：不直接丢弃，而是智能分段
    // 常见于微信公众号、学习平台词汇列表等将内容以 section 分隔无 <br> 的场景
    if (trimmed.length > 300) {
      // 检查是否是可分段的内容（包含中文且行数=1）
      if (zhChars >= 20) {
        // 标记为需要分段处理，暂时保留（后续由智能分段处理）
        needsSplitSet.add(line);
        return true;
      }
      // 不包含中文的超长行 → 标签剥除后的粘合垃圾 → 丢弃
      return false;
    }
     
    // 全标点/符号行
    if (/^[^\u4e00-\u9fa5a-zA-Z0-9]+$/.test(trimmed)) return false;
     
    return true;
  });
   
  // 对超长行做智能分段处理
  const processedLines: string[] = [];
  for (const line of filteredLines) {
    if (needsSplitSet.has(line)) {
      // 按中英文标点边界将超长行智能分段为可处理的小段
      const splitPattern = /([。；;，,！!？?、]|(?<=[\u4e00-\u9fa5])(?=[A-Za-z])|(?<=[A-Za-z])(?=[\u4e00-\u9fa5]))/g;
      const segments = line.split(splitPattern).filter(s => {
        const trimmed = s.trim();
        if (trimmed.length < 4) return false;
        const zhChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
        return zhChars >= 4;
      });
      processedLines.push(...segments);
    } else {
      processedLines.push(line);
    }
  }
  
  const cleaned = processedLines.join('\n').trim();
  
  if (cleaned.length < text.length) {
    console.log(`[Term Engine] Web text cleaning: ${text.length} → ${cleaned.length} chars (removed ${text.length - cleaned.length} noise chars)`);
  }
  
  return cleaned;
}

/**
 * [新增] 检测文本是否为"编号词汇列表"格式（如微信公众号词汇表）
 * 典型格式: "01.计划生育 family planning02.计划生育基本国策 the basic state policy of family planning03...."
 * 特征：以两位数字编号 + 中文术语 + 英文解释 + 紧接下一条编号的密集排列
 */
function detectNumberedVocabList(text: string): boolean {
  if (!text || text.length < 100) return false;
  
  // 统计编号模式 "01." "02." "001." 等出现的次数
  // [修复] \s+ → \s* 允许中英文间无空格（微信公众号词汇表常见格式）
  const numberedPattern = /\b\d{1,3}\.\s*[\u4e00-\u9fa5]+\s*[A-Za-z]/g;
  const matches = text.match(numberedPattern);
  
  if (!matches || matches.length < 3) return false;
  
  // 如果找到≥3条编号词汇模式，且占总字符数的一定密度，判定为编号词汇列表
  const zhChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  
  // 同时包含中英文。宽松比例校验：英文不超过中文的5倍（词汇表中英文解释通常比中文术语长）
  if (zhChars < 50 || enChars < 50) return false;
  if (enChars > zhChars * 5) return false; // 纯英文文章 + 少量中文字符的噪声
  
  return true;
}

/**
 * [新增] 解析"编号词汇列表"格式为逐行条目文本
 * 输入: "01.计划生育 family planning02.计划生育基本国策 the basic state policy..."
 * 输出: "计划生育\tfamily planning\n计划生育基本国策\tthe basic state policy..."
 * 处理后再交给现有的术语抽取流程
 */
function parseNumberedVocabList(text: string): string | null {
  if (!text || text.length < 20) return null;
  
  // 匹配编号+中文术语+英文解释的模式
  // 编号可能是 01. 或 1. 或 001. 等格式
  // 英文解释到下一个编号之前
  // [修复] \s+ → \s* 允许中英文间无空格（微信公众号词汇表常见格式）
  // [修复] 中文术语字符类增加引号支持，如 "走出去"(战略)
  // [修复] 英文翻译字符类增加引号支持，如 the "211 Project"
  const entryPattern = /(\d{1,3})\.\s*([\u4e00-\u9fa5（）()、，\u201c\u201d\u300c\u300d]+)\s*([A-Za-z][A-Za-z0-9\s\-',;\(\)\.\u201c\u201d]*?)(?=\s*\d{1,3}\.\s*[\u4e00-\u9fa5]|$)/g;
  
  const entries: string[] = [];
  let match;
  let lastIndex = 0;
  
  while ((match = entryPattern.exec(text)) !== null) {
    const chineseTerm = match[2].trim();
    const englishTranslation = match[3].trim();
    
    // 过滤掉过短或过长的中文术语
    if (chineseTerm.length >= 2 && chineseTerm.length <= 30 && englishTranslation.length >= 1) {
      // 使用 Tab 分隔，方便后续处理
      entries.push(`${chineseTerm}\t${englishTranslation}`);
    }
    lastIndex = match.index + match[0].length;
  }
  
  if (entries.length < 2) return null;
  
  console.log(`[Term Engine] Detected numbered vocabulary list, parsed ${entries.length} entries`);
  
  // 将解析出的条目用换行连接，形成标准的多行词汇表格式
  // 这种格式可以被现有的 extractChineseTerms 和 extractEnglishTerms 更好地处理
  return entries.join('\n');
}

/**
 * [新增] 将解析出的词汇表条目转换为 ExtractedTerm 数组
 * 这是针对编号词汇列表的专用快速通道，不依赖AI也不依赖规则模式
 */
function extractFromVocabEntries(entriesText: string): ExtractedTerm[] {
  const lines = entriesText.split('\n').filter(l => l.trim().length > 0);
  const terms: ExtractedTerm[] = [];
  const seen = new Set<string>();
  
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    
    const chineseTerm = parts[0].trim();
    const englishTranslation = parts.slice(1).join(' ').trim();
    
    if (!chineseTerm || !englishTranslation) continue;
    if (chineseTerm.length < 2 || chineseTerm.length > 30) continue;
    if (englishTranslation.length < 1 || englishTranslation.length > 200) continue;
    
    const key = chineseTerm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    
    const targetLang = detectLatinScriptLanguage(englishTranslation) || 'en';
    terms.push({
      term_text: chineseTerm,
      score: 10,
      source_lang: 'zh',
      target_term: englishTranslation,
      target_lang: targetLang,
      translation_source: 'numbered-vocab-list',
      translation_confidence: 0.85,
    });
  }
  
  console.log(`[Term Engine] Extracted ${terms.length} terms from numbered vocabulary list`);
  return terms;
}

/**
 * ====================================================================
 * 改进的中文术语提取
 * ====================================================================
 * [修复] 废除字符级滑动窗口算法
 * 原问题：将非汉字字符替换为空格后对超长汉字块执行2-4字滑动窗口，
 * 导致产生"治现代化"、"式法治现"、"华优秀传"等无意义片语。
 * 
 * 新方案：
 * 1. 保留标点分隔，利用自然边界切分
 * 2. 使用专业术语前后缀模式匹配
 * 3. 最小长度限制为4字
 * 4. 基于专业特征评分而非出现频率
 * ====================================================================
 */

/**
 * [新增] UI常见排版噪声（抽取前剔除）
 */
const UI_NOISE_PATTERNS = [
  '小中大分享到', '小中大', '分享到', '字体',
  '摘要', '关键字', '关键词', '下载文献', '参考文献',
  '阅读全文', '点击阅读', '分享到', '收藏本文',
  '来源', '作者', '责任编辑', '编辑', '校对',
  '版权', '声明', '广告', '推广', '赞助',
  '时间', '日期', '分享', '收藏', '点赞', '在看',
  '关注我们', '扫码', '二维码', '阅读原文',
];

/**
 * [新增] 动词/介词/虚词 开头黑名单——以这些词开头的候选直接过滤
 * [修复] 增加了"了"、"着"、"过"等粒子词，防止截断碎片被当作术语
 */
const VERB_BLACKLIST = [
  // 动词
  '推动', '促进', '提出', '包括', '探索', '分析', '应当', '具有', '坚持',
  '通过', '根据', '按照', '关于', '对于', '为了', '经过', '利用', '采用',
  '加强', '提升', '推进', '建立', '完善', '健全', '优化', '强化', '深化',
  '表示', '发现', '证明', '提出', '指出', '认为', '说明', '显示', '阐述',
  '研究', '考察', '讨论', '回顾', '总结', '归纳', '概括', '综述', '展望',
  '成为', '作为', '进入', '开始', '实现', '建设', '提供', '达到', '确保',
  '重视', '注重', '强调', '突出', '加大', '加快', '提高', '扩大', '减少',
  '也是', '这是', '那是', '这些', '那些', '有的', '可以', '需要', '进行',
  '还有', '同时', '此外', '另外', '如', '例如', '比如', '比如', '诸如',
  // [修复] 增加虚词/粒子，防止"了传承..."这类截断碎片进入术语
  '了', '着', '过', '所', '被', '把', '将', '从', '对', '向', '到', '用',
  '并', '而', '且', '或', '与', '及', '既',
  // 增加常见的截断词开头
  '本文', '文章', '该书', '这篇', '这个', '一种', '一些', '其中',
];

/**
 * [新增] 含"的"/"之"结构加分
 */
const STRUCTURE_WORDS = ['的', '之', '与', '及', '和'];

/**
 * 常见中文专业术语后缀（用于模式匹配）
 */
const CHINESE_TERM_SUFFIXES = [
  '化', '法', '制', '度', '性', '率', '量', '值', '数', '体', '系', '统',
  '学', '论', '观', '说', '派', '主义', '理论', '模式', '机制', '体系',
  '结构', '功能', '工程', '技术', '手段', '方法', '方式', '路径', '策略',
  '战略', '制度', '政策', '法律', '法规', '条例', '规范', '标准',
  '能力', '水平', '质量', '效率', '效益', '价值', '意义', '影响',
  '建设', '管理', '治理', '监督', '评估', '评价', '分析', '研究',
  '发展', '改革', '创新', '传承', '保护', '开发', '利用', '应用',
  '文化', '文明', '理念', '原则', '精神', '思想', '观念', '意识',
  '关系', '结构', '功能', '要素', '因素', '指标', '数据', '信息',
  '风险', '安全', '保障', '支撑', '驱动', '导向', '目标', '任务',
  '资源', '环境', '条件', '基础', '体系',
  '中心', '核心', '关键', '重点', '根本', '基本', '主要', '重要',
];

/**
 * 常见中文专业术语前缀（用于模式匹配）
 */
const CHINESE_TERM_PREFIXES = [
  '反', '非', '超', '跨', '多', '双', '单', '微', '宏', '亚', '准', '伪', 
  '本', '前', '后', '总', '副', '主', '次', '零', '全', '半', '子',
  '再', '可', '自', '互', '共', '联', '分', '合',
  '软', '硬', '轻', '重', '高', '低', '大', '小', '新', '旧', '老',
  '无', '有', '去', '复', '增', '减',
];

/**
 * 判断中文术语是否具有专业价值
 * 基于前后缀匹配而非简单的统计频率
 */
function isChineseProfessionalTerm(candidate: string): boolean {
  if (!candidate || candidate.length < 4) return false; // 至少4个字才有术语价值
  
  // [新增] 语义完整性检查：如果术语包含明显的断词边界（非完整词汇片段），拒绝
  // 例如"式法治现"虽然以"现"结尾但中间"法治"是独立词，但"式"开头的截断特征明显
  // 不拒绝形如"法治现代化"（以"现代化"结尾）的合法术语
  const hasTruncationSigns = (
    // 以常见截断词开头（语气词、连接词等，不应该作为术语开头）
    (candidate.startsWith('了') || candidate.startsWith('的') || candidate.startsWith('着') ||
     candidate.startsWith('过') || candidate.startsWith('而') || candidate.startsWith('且') ||
     candidate.startsWith('其') || candidate.startsWith('但') || candidate.startsWith('还') ||
     candidate.startsWith('也') || candidate.startsWith('就') || candidate.startsWith('都') ||
     candidate.startsWith('所') || candidate.startsWith('被') || candidate.startsWith('把') ||
     candidate.startsWith('将') || candidate.startsWith('从') || candidate.startsWith('对'))
  );
  if (hasTruncationSigns) return false;
  
  // 检查是否包含专业后缀
  for (const suffix of CHINESE_TERM_SUFFIXES) {
    if (candidate.endsWith(suffix)) return true;
  }
  
  // 检查是否包含专业前缀
  for (const prefix of CHINESE_TERM_PREFIXES) {
    if (candidate.startsWith(prefix) && candidate.length >= 4) return true;
  }
  
  return false;
}


/**
 * 从中文文本中提取术语（改进版）
 * 
 * 核心改进：
 * - 废除字符级滑动窗口 → 使用标点自然分段 + 模式匹配
 * - 最小术语长度从2提升到4，杜绝2-3字的无意义片语
 * - 评分基于专业特征而非出现频率（避免高频连接词被误判为术语）
 * - 保留文本分隔符，利用自然语言边界
 */
/**
 * [改进] 中文规则抽取前文本预处理：移除URL、邮箱、电话号码等英文噪声
 * 防止这些HTML残余干扰语言检测和抽取质量
 */
function preprocessChineseText(text: string): string {
  if (!text || text.length < 10) return text;
  
  let cleaned = text;
  
  // 移除URL (http://, https://, www.)
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, ' ');
  
  // 移除独立域名（如 example.com）
  cleaned = cleaned.replace(/\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?\b/g, (match) => {
    // 保留可能是缩写的情况（如 "U.S.", "e.g."）
    if (/^[A-Za-z]\.[A-Za-z]\.$/.test(match)) return match;
    return ' ';
  });
  
  // 移除邮箱地址
  cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ' ');
  
  // 移除纯数字+符号行（如电话号码、日期等）
  cleaned = cleaned.replace(/^[\d\s\-\+\(\)\.\,\;\:\/\\]+$/gm, ' ');
  
  // 移除连续过长的英文单词（>20个字母，很可能是编码噪声）
  cleaned = cleaned.replace(/\b[a-zA-Z]{21,}\b/g, ' ');
  
  // 移除纯英文且中文不足的行（可能是导航残留）
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.length < 4) return false;
    const zhChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
    const enChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
    // 如果英文字符是中文的3倍以上（说明是英文导航/页脚残留），过滤
    if (enChars > zhChars * 3 && zhChars < 5) return false;
    return true;
  });
  cleaned = filteredLines.join('\n');
  
  // 规范化空白
  cleaned = cleaned.replace(/\s{3,}/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  if (cleaned.length < text.length) {
    console.log(`[Term Engine] Chinese text preprocessing: ${text.length} → ${cleaned.length} chars (removed ${text.length - cleaned.length} noise chars)`);
  }
  
  return cleaned;
}

function extractChineseTerms(text: string): ExtractedTerm[] {
  if (!text || text.trim().length < 2) return [];

  // ===== [改进] 步骤0：中文文本预处理——移除URL、邮箱等英文噪声 =====
  text = preprocessChineseText(text);
  
  // ===== [新增] 步骤0.5：预清理——剔除UI排版噪声 =====
  let cleanedText = text;
  for (const pattern of UI_NOISE_PATTERNS) {
    // 全局替换所有UI噪声模式
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    cleanedText = cleanedText.replace(regex, '');
  }
  // 额外清理常见的排版残渣
  cleanedText = cleanedText.replace(/[：:]\s*[A-Za-z0-9_:/-]+\s*$/gm, ''); // 去除尾部"字体：小中大"之类
  cleanedText = cleanedText.replace(/^[\s\dA-Za-z：:；;，,。.、]+/gm, ''); // 去除行首噪声

  // 如果没有有效内容，使用原文本
  text = cleanedText.trim() || text.trim();

  // ---- 步骤1：按标点符号分段，保持自然边界 ----
  // 保留中英文标点、括号、引号等作为分隔符
  const segments = text.split(/[，,。．；;：:、！!？?（）()【】\[\]《》<>""''「」『』\n\r\t]+/)
    .map(s => s.trim())
    .filter(s => {
      const pure = s.replace(/[^\u4e00-\u9fa5]/g, '');
      return pure.length >= 4; // 至少4个连续汉字才考虑
    })
    // [新增] 对每段进行二次噪声过滤——剔除UI排版残留
    .map(s => {
      let cleaned = s;
      for (const pattern of UI_NOISE_PATTERNS) {
        const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        cleaned = cleaned.replace(regex, '');
      }
      cleaned = cleaned.trim();
      return cleaned;
    })
    .filter(s => {
      // 过滤掉噪声清理后变空的段
      const pure = s.replace(/[^\u4e00-\u9fa5]/g, '');
      return pure.length >= 4;
    });


  if (segments.length === 0) return [];

  // ---- 步骤2：从每个片段中提取有意义的术语候选 ----
  const candidates: string[] = [];
  const candidateSet = new Set<string>(); // 用于去重

  for (const segment of segments) {
    // 提取纯汉字部分
    const pureChinese = segment.replace(/[^\u4e00-\u9fa5]/g, '');
    if (!pureChinese || pureChinese.length < 4) continue;

    // --- 模式A：整段作为候选（如果长度≤12且符合专业术语前后缀特征） ---
    // [优化] 最大长度限制为12，防止完整句子被当作术语
    if (pureChinese.length <= 12 && isChineseProfessionalTerm(pureChinese)) {
      if (!candidateSet.has(pureChinese)) {
        candidates.push(pureChinese);
        candidateSet.add(pureChinese);
      }
    }

    // --- 模式B：按功能词切分为更小的语义单元 ---
    // 功能词（连接词、介词等）前后的独立名词短语通常更有术语价值
    const funcWords = /(的|和|与|及|或|在|于|以|而|之|则|为|所|被|把|将|从|对|向|到|用|通过|根据|按照|关于|对于|除了)/g;
    
    let lastEnd = 0;
    let funcMatch;
    while ((funcMatch = funcWords.exec(pureChinese)) !== null) {
      const before = pureChinese.substring(lastEnd, funcMatch.index);
      if (before.length >= 4 && before.length <= 12 && !candidateSet.has(before) && isChineseProfessionalTerm(before)) {
        candidates.push(before);
        candidateSet.add(before);
      }
      lastEnd = funcMatch.index + funcMatch[0].length;
    }
    // 处理最后一段
    const lastPart = pureChinese.substring(lastEnd);
    if (lastPart.length >= 4 && lastPart.length <= 12 && !candidateSet.has(lastPart) && isChineseProfessionalTerm(lastPart)) {
      candidates.push(lastPart);
      candidateSet.add(lastPart);
    }

    // --- 模式C（重构）：基于后缀逆向扫描的专业术语匹配 ---
    // [修复] 原惰性量词{3,5}?从任意位置开始匹配最短3字，导致"治现代化"等无意义片语
    // 新方案：从专业后缀位置逆向扫描到语义边界，提取完整术语
    // 语义边界包括：功能词之后、动词黑名单开头词之后、或距后缀最多12字
    // 此模式在整段长度>12时也运行（原版限制4-12字导致超长段落跳过）
    {
      // [修复] 长后缀优先排序 + 增加更多组合后缀（避免"现代化"被"化"先匹配）
      // 使用长后缀优先（长度降序），确保"传统法律文化"优先于"法律"被匹配
      const suffixList = [...CHINESE_TERM_SUFFIXES].sort((a, b) => b.length - a.length);
      // [修复] 功能边界词 增加"了"——防止"探索了中华优秀传统法律文化"被提取成"了中华优秀传统法律文化"
      const boundaryWords = ['的', '与', '及', '或', '在', '于', '而', '之', '则', '为', '所', '被', '把', '将', '从', '对', '向', '到', '用', '了', '着', '过', '通过', '根据', '按照', '关于', '对于', '除了'];
      
      let scanPos = 0;
      while (scanPos < pureChinese.length) {
        // 查找最近的后缀位置
        let nearestSuffixIdx = -1;
        let nearestSuffixLen = 0;
        for (const suffix of suffixList) {
          const pos = pureChinese.indexOf(suffix, scanPos);
          if (pos !== -1 && (nearestSuffixIdx === -1 || pos < nearestSuffixIdx)) {
            nearestSuffixIdx = pos;
            nearestSuffixLen = suffix.length;
          }
        }
        if (nearestSuffixIdx === -1) break;
        
        // 从后缀位置逆向搜索语义边界（最多反向12字）
        let termStart = -1;
        const maxLookback = Math.max(0, nearestSuffixIdx - 12);
        for (let i = nearestSuffixIdx - 1; i >= maxLookback; i--) {
          // 检查是否遇到功能边界词
          let foundBoundary = false;
          for (const bw of boundaryWords) {
            if (i - bw.length + 1 >= maxLookback) {
              const slice = pureChinese.substring(i - bw.length + 1, i + 1);
              if (slice === bw) {
                termStart = i + 1;
                foundBoundary = true;
                break;
              }
            }
          }
          if (foundBoundary) break;
          
          // 检查是否遇到动词黑名单开头的词
          for (const verb of VERB_BLACKLIST) {
            if (i - verb.length + 1 >= maxLookback) {
              const slice = pureChinese.substring(i - verb.length + 1, i + 1);
              if (slice === verb) {
                termStart = i + 1;
                foundBoundary = true;
                break;
              }
            }
          }
          if (foundBoundary) break;
        }
        
        // 如果没找到语义边界，从maxLookback位置取
        if (termStart === -1) termStart = maxLookback;
        
        // 提取完整术语
        const term = pureChinese.substring(termStart, nearestSuffixIdx + nearestSuffixLen);
        const termLen = term.length;
        
        if (termLen >= 4 && termLen <= 12 && !candidateSet.has(term)) {
          // 额外校验：术语不能以动词黑名单/虚词开头
          let startsWithBadWord = false;
          // 先检查完全匹配黑名单词
          for (const verb of VERB_BLACKLIST) {
            if (term.startsWith(verb)) { startsWithBadWord = true; break; }
          }
          // [修复] 额外检查单字符虚词开头
          if (!startsWithBadWord) {
            const badStarts = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对'];
            for (const bs of badStarts) {
              if (term.startsWith(bs)) { startsWithBadWord = true; break; }
            }
          }
          if (!startsWithBadWord) {
            candidates.push(term);
            candidateSet.add(term);
          }
        }
        
        scanPos = nearestSuffixIdx + 1;
      }
    }


    // --- 模式D：提取包含数字的专业术语（如"十四五规划"、"一带一路"等） ---
    const numPatterns = pureChinese.match(/[\u4e00-\u9fa5]*[一二三四五六七八九十百千万亿][\u4e00-\u9fa5]+/g);
    if (numPatterns) {
      for (const matched of numPatterns) {
        if (matched.length >= 4 && matched.length <= 12 && !candidateSet.has(matched)) {
          candidates.push(matched);
          candidateSet.add(matched);
        }
      }
    }

    // --- 模式E：提取中英文混合术语（如"AI技术"、"Web应用"等） ---
    const mixedMatches = segment.match(/[\u4e00-\u9fa5]{2,6}[A-Za-z]{2,10}|[A-Za-z]{2,10}[\u4e00-\u9fa5]{2,6}/g);
    if (mixedMatches) {
      for (const matched of mixedMatches) {
        if (matched.length >= 4 && matched.length <= 12 && !candidateSet.has(matched)) {
          candidates.push(matched);
          candidateSet.add(matched);
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  // ---- [新增] 步骤2.5：过滤动词/介词/虚词开头的候选 ----
  const filteredCandidates = candidates.filter(term_text => {
    for (const verb of VERB_BLACKLIST) {
      if (term_text.startsWith(verb)) {
        return false;
      }
    }
    // [修复] 额外检查单字符虚词开头
    const badStarts = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对'];
    for (const bs of badStarts) {
      if (term_text.startsWith(bs)) return false;
    }
    return true;
  });

  if (filteredCandidates.length === 0) return [];

  // ---- 步骤3：基于专业特征评分而非出现频率 ----
  const results = filteredCandidates
    .map(term_text => {
      let score = 0;
      
      // [优化] 评分：5-8字最高分，6-8字加分
      if (term_text.length === 4) score += 7;      // 四字术语加分
      if (term_text.length >= 5 && term_text.length <= 6) score += 9; // 五到六字最高分
      if (term_text.length >= 7 && term_text.length <= 8) score += 8;
      if (term_text.length > 8) score += 4;        // 超长术语分值降低
      
      // 包含专业后缀加分
      for (const suffix of CHINESE_TERM_SUFFIXES) {
        if (term_text.endsWith(suffix)) {
          score += 6;
          break;
        }
      }
      
      // 包含专业前缀加分
      for (const prefix of CHINESE_TERM_PREFIXES) {
        if (term_text.startsWith(prefix)) {
          score += 4;
          break;
        }
      }
      
      // [新增] 含"的"/"之"/"与"/"及"/"和"结构加分（如"德法共治"中的结构词）
      for (const structWord of STRUCTURE_WORDS) {
        if (term_text.includes(structWord)) {
          score += 2;
          break;
        }
      }
      
      // 中英混合加分（如"HTTP协议"、"API接口"）
      if (/[\u4e00-\u9fa5].*[a-zA-Z]|[a-zA-Z].*[\u4e00-\u9fa5]/.test(term_text)) {
        score += 5;
      }
      
      // 包含数字加分（如"十四五规划"）
      if (/[一二三四五六七八九十百千万亿]/.test(term_text)) {
        score += 4;
      }
      
      // 不包含停用词加分
      const stopwordArray = Array.from(CHINESE_STOPWORDS);
      const containsStopword = stopwordArray.some(stop => term_text.includes(stop));
      if (!containsStopword) score += 3;
      
      return { term_text, score: Math.max(1, score), source_lang: 'zh' };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  console.log(`[Term Engine] Chinese extraction (improved v2): ${results.length} terms from ${segments.length} segments`);
  if (results.length > 0) {
    console.log(`[Term Engine] Top Chinese terms: ${results.slice(0, 10).map(r => `${r.term_text}(${r.score})`).join(', ')}`);
  }
  return results;
}

/**
 * [新增] 审查后过滤 — 对AI/规则抽取的最终结果做语义完整性过滤
 * 防止"了传承中华优秀传统法律"、"现代法治理"等碎片进入最终输出
 */
function filterFragmentaryTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
  return terms.filter(term => {
    const text = term.term_text;
    
    // 以虚词/粒子开头的（这些通常是截断碎片）
    const badPrefixes = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对', '贵'];
    for (const bp of badPrefixes) {
      if (text.startsWith(bp)) {
        console.log(`[Term Engine] Post-filter: removed fragment "${text}" (starts with "${bp}")`);
        return false;
      }
    }
    
    // 以常见动词/介词开头的（如"探索了"、"分析了"等）
    const verbPrefixes = ['探索', '分析', '提出', '指出', '认为', '发现', '说明', '阐述', '研究', '考察', '讨论', '回顾', '总结', '归纳'];
    for (const vp of verbPrefixes) {
      if (text.startsWith(vp)) {
        console.log(`[Term Engine] Post-filter: removed fragment "${text}" (starts with verb "${vp}")`);
        return false;
      }
    }
    
    // 长度小于4的（太短不可能是有效术语）
    if (text.length < 4) {
      console.log(`[Term Engine] Post-filter: removed too short "${text}"`);
      return false;
    }
    
    // 看起来是截断的：包含专业后缀但前缀太短或不完整
    // 例如"现代法治理"（应该是"现代法治理念"或"法治"的一部分）
    // 规则：如果术语以"治理"、"法律"、"文化"等可以独立存在的词结束后，
    // 且前面部分不足4字，则可能是截断的
    const truncatedEndings = ['治理', '法律', '法治', '文化', '传承', '价值', '建设'];
    for (const te of truncatedEndings) {
      if (text.endsWith(te) && text.length > te.length) {
        const prefix = text.substring(0, text.length - te.length);
        // 如果前缀部分以虚词结尾或太短（<2字），说明可能是截断
        if (prefix.length < 2) {
          console.log(`[Term Engine] Post-filter: removed truncated "${text}" (prefix "${prefix}" too short before "${te}")`);
          return false;
        }
        // 检查前缀是否以介词/虚词结尾（如"了"、"的"）
        const lastChar = prefix[prefix.length - 1];
        if (['了', '的', '着', '过', '而', '且', '之', '以'].includes(lastChar)) {
          console.log(`[Term Engine] Post-filter: removed truncated "${text}" (prefix ends with particle "${lastChar}")`);
          return false;
        }
      }
    }
    
    return true;
  });
}

/**
 * 对长文本进行规则模式分块
 * 按自然段落边界切分，每块不超过 RULE_CHUNK_SIZE 字符
 */
function chunkTextForRules(text: string): string[] {
  if (text.length <= RULE_CHUNK_SIZE) {
    return [text];
  }
  
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > RULE_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  console.log(`[Term Engine] Rules chunking: ${text.length} chars → ${chunks.length} chunks`);
  return chunks;
}

/**
 * 合并并去重多个分块的规则抽取结果
 */
function mergeAndDedupRuleResults(allResults: ExtractedTerm[][]): ExtractedTerm[] {
  const seen = new Set<string>();
  const merged: ExtractedTerm[] = [];
  
  for (const chunkResults of allResults) {
    for (const term of chunkResults) {
      const normalized = term.term_text.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        merged.push(term);
      }
    }
  }
  
  // 重新按分数排序
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

/**
 * 从文本中提取术语
 * 
 * 统一工作流：
 * 1. 文本篇幅检测 → 超长文本执行分块
 * 2. 未开启AI：纯规则模式抽取（分块规则抽取 → 合并去重 → 后过滤）
 * 3. 开启AI：完整文本提交AI处理（AI自行判断文本类型、语种、对译关系）
 *    - AI内部已包含分块逻辑（>15000字触发）
 *    - AI失败时降级到规则模式
 */
/**
 * 抽取元数据 —— 用于向调用方传递抽取过程中的状态信息（如是否AI降级）
 */
export interface ExtractionMetadata {
  /** 最终使用的抽取模式 */
  mode: 'ai-only' | 'ai-degraded-to-rules' | 'rules-only' | 'numbered-vocab-list' | 'ai-bilingual' | 'bilingual-rules';
  /** AI降级原因（仅在 mode='ai-degraded-to-rules' 时有值） */
  fallbackReason?: string;
  /** 降级前的AI错误信息（诊断用） */
  aiError?: string;
  /** 原始检测到的语言 */
  detectedLanguage?: string;
  /** 是否为双语文本 */
  isBilingual?: boolean;
}

export async function extractTermsFromText(
  text: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig
): Promise<ExtractedTerm[]> {
  const result = await extractTermsFromTextWithMeta(text, language, useAI, aiConfig);
  return result.terms;
}

/**
 * 增强版术语抽取 —— 同时返回术语列表和抽取元数据
 * 调用方可通过 metadata.fallbackReason 判断AI是否降级，并在UI上提示用户
 */
export async function extractTermsFromTextWithMeta(
  text: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig
): Promise<{ terms: ExtractedTerm[]; metadata: ExtractionMetadata }> {
  const emptyMeta: ExtractionMetadata = { mode: 'rules-only' };

  if (!text || text.trim().length === 0) {
    console.warn('[Term Engine] Empty text provided');
    return { terms: [], metadata: { ...emptyMeta, fallbackReason: '空文本' } };
  }

  const trimmedText = text.trim();
  console.log(`[Term Engine] extractTermsFromText called, language: ${language}, useAI: ${useAI}, text length: ${trimmedText.length}`);

  // ═══════════════════════════════════════════
  // [新增] 快速通道：检测是否为"编号词汇列表"格式（微信公众号等）
  // 此类格式的文本不适用于AI或规则模式，使用专用解析器直接提取
  // ═══════════════════════════════════════════
  if (detectNumberedVocabList(trimmedText)) {
    const parsedText = parseNumberedVocabList(trimmedText);
    if (parsedText) {
      const vocabTerms = extractFromVocabEntries(parsedText);
      if (vocabTerms.length > 0) {
        console.log(`[Term Engine] Using numbered vocabulary list fast track: ${vocabTerms.length} terms extracted`);
        return {
          terms: vocabTerms.slice(0, DEFAULT_STRATEGY.maxResults || 300),
          metadata: { mode: 'numbered-vocab-list' }
        };
      }
    }
    // 如果解析失败（如正则不匹配），继续走正常流程
    console.log('[Term Engine] Numbered vocab list detected but parsing failed, continuing to normal flow');
  }

  // ========== 语言检测 ==========
  let actualLang: string = language;
  let detectedIsBilingual = false; // [修复] 保存双语标记，用于AI降级场景
  if (language === 'auto') {
    const detected = detectTextLanguage(trimmedText);
    console.log(`[Term Engine] Language detection result: ${detected.lang}, isBilingual: ${detected.isBilingual}`);
    // [修复v2] mixed双语文本先标记为mixed，由后续流程根据具体语言对处理
    actualLang = detected.lang;
    detectedIsBilingual = detected.isBilingual;
    console.log(`[Term Engine] Using detected language: ${actualLang}`);
  }

  const metadata: ExtractionMetadata = {
    mode: useAI ? 'ai-only' : 'rules-only',
    detectedLanguage: actualLang,
    isBilingual: detectedIsBilingual,
  };

  // ═══════════════════════════════════════════
  // 路径一：AI增强模式
  // 文本直接提交给AI，由AI自行判断文本类型、语种和对译关系
  // 不在AI前套用任何规则模式
  // ═══════════════════════════════════════════
  if (useAI && aiConfig) {
    console.log(`[Term Engine] === AI-Enhanced Path (${actualLang}) ===`);
    
    try {
      const strategy: ExtractionStrategy = {
        ...DEFAULT_STRATEGY,
        aiConfig: aiConfig,
        mode: 'ai-only' as const,
      };
      
      console.log('[Term Engine] Submitting full text to AI for smart extraction...');
      // 始终传 'auto' 让AI自行判断语言场景，不预设 actualLang（双语文本会被强制设为 'zh' 导致丢失外文术语）
      const smartResults = await smartExtractTermsImpl(trimmedText, 'auto', strategy);
      console.log(`[Term Engine] AI extraction completed, got ${smartResults.length} smart terms`);
      
      if (smartResults.length > 0) {
        let results: ExtractedTerm[] = smartResults
          .map(term => ({
            term_text: term.term_text,
            score: Math.round(term.score),
            source_lang: term.source_lang || 'zh', // AI已通过新prompt自行判断source_lang，fallback 用 'zh' 覆盖缺省情况
            target_term: term.target_term,
            target_lang: term.target_lang,
            translation_source: term.translation_source,
            translation_confidence: term.translation_confidence,
            abbreviation_suggestion: term.abbreviation_suggestion,
          }))
          .slice(0, DEFAULT_STRATEGY.maxResults || 300);
        
        // [修复] AI-only 模式：跳过 filterFragmentaryTerms
        // AI 已有内置 Prompt 完成语义完整性判断，后过滤的<4字长度限制、
        // 动词前缀/虚词黑名单等规则会误杀合法术语（如AI、API缩写、
        // "研究型大学""对称加密"等合法复合术语），导致网页抽取几乎全军覆没
        // 仅保留 smart-extractor 内部的 JSON字段名/纯数字等噪声过滤
        console.log(`[Term Engine] AI-only mode: skipping filterFragmentaryTerms (AI self-filters, trust AI quality). ${results.length} terms kept.`);
        
        console.log(`[Term Engine] AI path final results: ${results.length} terms`);

        // [P0] AI结果质量预检：双语文本但AI只返回了单一语言术语
        if (detectedIsBilingual && results.length > 0) {
          const hasTargetTerms = results.filter(t => t.target_term && t.target_term.length > 0).length;
          const hasEnSource = results.filter(t => t.source_lang === 'en' || t.source_lang === 'fr' || t.source_lang === 'de' || t.source_lang === 'es').length;
          if (hasTargetTerms === 0 && hasEnSource === 0) {
            metadata.mode = 'ai-degraded-to-rules';
            metadata.fallbackReason = 'AI returned only single-language terms for bilingual text (no target_term or foreign source_lang)';
            metadata.aiError = `AI returned ${results.length} terms but all source_lang=zh with no target_term`;
            console.warn(`[Term Engine] AI quality check failed: ${metadata.fallbackReason}. Falling back to rules for bilingual extraction.`);
          }
        }

        return { terms: results, metadata };
      }
      
      // AI返回空结果 → 降级到规则模式
      metadata.mode = 'ai-degraded-to-rules';
      metadata.fallbackReason = 'AI returned 0 terms (no results)';
      console.log('[Term Engine] AI returned 0 terms, falling back to rules-only path');
    } catch (error) {
      metadata.mode = 'ai-degraded-to-rules';
      metadata.fallbackReason = 'AI extraction error';
      metadata.aiError = error instanceof Error ? error.message : String(error);
      console.error('[Term Engine] AI extraction failed, falling back to rules-only path:', error);
    }
  }

  // ═══════════════════════════════════════════
  // 路径二：纯规则模式（未开启AI或AI失败降级）
  // ═══════════════════════════════════════════
  
  // [修复] AI降级时，首先尝试编号词汇列表快速通道作为高优先级后备
  // 因为AI可能因PDF紧凑格式（无空格词汇表）而返回空，但规则解析器能正确处理
  if (useAI && aiConfig && detectNumberedVocabList(trimmedText)) {
    const parsedText = parseNumberedVocabList(trimmedText);
    if (parsedText) {
      const vocabTerms = extractFromVocabEntries(parsedText);
      if (vocabTerms.length > 0) {
        console.log(`[Term Engine] AI degradation: numbered vocab list fast track rescued ${vocabTerms.length} terms (AI returned empty/errored)`);
        return {
          terms: vocabTerms.slice(0, DEFAULT_STRATEGY.maxResults || 300),
          metadata: {
            ...metadata,
            mode: 'ai-degraded-to-rules',
            fallbackReason: metadata.fallbackReason || 'AI returned 0 terms, rescued by vocab list fast track',
          }
        };
      }
    }
  }
  
  // [修复P0-2] AI降级时利用原始检测的双语标记
  // 如果原始语言检测判定为双语，但actualLang被设为'zh'/'en'单语 → 强制改为mixed走双语路径
  if (useAI && aiConfig && detectedIsBilingual && actualLang !== 'mixed') {
    console.log(`[Term Engine] AI degradation: original text was bilingual (detectedIsBilingual=true), forcing actualLang from '${actualLang}' to 'mixed' for bilingual rule extraction`);
    actualLang = 'mixed';
  }
  
  // [改进] AI降级时对文本做二次语言检测，避免原始检测被HTML噪声误导
  if (useAI && aiConfig && actualLang === 'en') {
    const reDetected = detectTextLanguage(trimmedText);
    if (reDetected.lang === 'zh' || (reDetected.lang === 'mixed' && reDetected.isBilingual)) {
      // 如果二次检测发现主要是中文，纠正语言
      console.log(`[Term Engine] AI degradation: re-detected language as ${reDetected.lang}, correcting from 'en'`);
      actualLang = reDetected.lang === 'mixed' ? 'zh' : reDetected.lang;
    }
  }
  
  console.log(`[Term Engine] === Rules-Only Path (${actualLang}) ===`);
  
  const isLargeText = trimmedText.length > MAX_TEXT_LENGTH_FOR_DIRECT_PROCESSING;
  let results: ExtractedTerm[];
  
  if (actualLang === 'zh') {
    if (isLargeText) {
      console.log(`[Term Engine] Large Chinese text (${trimmedText.length} chars), chunking for rules extraction`);
      const chunks = chunkTextForRules(trimmedText);
      const chunkResults = chunks.map(chunk => extractChineseTerms(chunk));
      results = mergeAndDedupRuleResults(chunkResults);
      console.log(`[Term Engine] Chunked rules extraction: ${chunks.length} chunks → ${results.length} terms (after dedup)`);
    } else {
      results = extractChineseTerms(trimmedText);
    }
  } else if (actualLang === 'en') {
    if (isLargeText) {
      console.log(`[Term Engine] Large English text (${trimmedText.length} chars), chunking for rules extraction`);
      const chunks = chunkTextForRules(trimmedText);
      const chunkResults = chunks.map(chunk => extractEnglishTerms(chunk));
      results = mergeAndDedupRuleResults(chunkResults);
      console.log(`[Term Engine] Chunked rules extraction: ${chunks.length} chunks → ${results.length} terms (after dedup)`);
    } else {
      results = extractEnglishTerms(trimmedText);
    }
  } else if (actualLang === 'mixed') {
    // [修复v2] 双语混合文本 → 优先尝试词汇表检测器，然后中英分别抽取
    console.log(`[Term Engine] Mixed language text → trying vocab list detector first`);
    const vocabTerms = extractFromVocabEntries(trimmedText);
    if (vocabTerms.length > 0) {
      results = vocabTerms;
    } else {
      // 降级：中英分别抽取
      const zhTerms = extractChineseTerms(trimmedText);
      const enLatinTerms = extractEnglishTerms(trimmedText);
      results = mergeAndDedupRuleResults([zhTerms, enLatinTerms]);
    }
  } else if (['fr','de','es','it','pt'].includes(actualLang)) {
    // [修复v2] 非英文拉丁语系 → 使用通用拉丁语系术语抽取
    console.log(`[Term Engine] Latin-script language (${actualLang}) → generic Latin term extraction`);
    const latinTerms = extractLatinScriptTerms(trimmedText, actualLang);
    results = latinTerms.map(t => ({
      ...t,
      source_lang: actualLang,
    }));
  } else {
    // 其他语种（如 ja, ko, ru, ar）
    console.warn(`[Term Engine] Unhandled language: ${actualLang} — trying generic extraction`);
    const genericTerms = extractLatinScriptTerms(trimmedText, actualLang);
    if (actualLang === 'ja' || actualLang === 'ko' || actualLang === 'ru' || actualLang === 'ar') {
      results = genericTerms.map(t => ({ ...t, source_lang: actualLang }));
    } else {
      return { terms: [], metadata };
    }
  }
  
  // 后过滤：去除碎片化术语
  const beforeFilter = results.length;
  results = filterFragmentaryTerms(results);
  if (results.length < beforeFilter) {
    console.log(`[Term Engine] Post-filter removed ${beforeFilter - results.length} fragmentary terms (kept ${results.length})`);
  }
  
  // 限制结果数量
  results = results.slice(0, DEFAULT_STRATEGY.maxResults || 300);
  
  console.log(`[Term Engine] Rules path final results: ${results.length} terms`);
  return { terms: results, metadata };
}

/**
 * 从英文文本中提取术语（规则模式，提取自 extractTermsFromText 原有逻辑）
 */
function extractEnglishTerms(text: string): ExtractedTerm[] {
  // 步骤1: 找到所有连字符术语并保护它们
  const hyphenatedTerms: string[] = [];
  const hyphenPattern = /\b([A-Za-z]+-[A-Za-z]+(?:\s*[A-Za-z/]+)*)\b/g;
  let match;
  
  while ((match = hyphenPattern.exec(text)) !== null) {
    const term = match[1].trim();
    if (!term.includes('://') && !term.includes('@') && term.length >= 3 && term.length <= 50) {
      hyphenatedTerms.push(term);
    }
  }
  
  // 保护连字符术语内部
  let protectedText = text;
  const hyphenMarkers: Record<string, string> = {};
  hyphenatedTerms.forEach((term, index) => {
    const marker = `__HYPHEN_${index}__`;
    hyphenMarkers[marker] = term;
    protectedText = protectedText.replace(new RegExp(`\\b${term.replace(/-/g, '\\-')}\\b`, 'g'), marker);
  });
  
  // 分割为token
  const tokens = protectedText
    .split(/[\s,;:.!?()[\]{}'"&|/\\]+/)
    .map(token => {
      if (token.startsWith('__HYPHEN_') && token.endsWith('__') && hyphenMarkers[token]) {
        return hyphenMarkers[token];
      }
      return token;
    })
    .filter((w) => {
      if (w.length < 2) return false;
      if (!/[a-z0-9]/.test(w)) return false;
      // Safety: filter out any remaining __HYPHEN_ markers that were not restored
      if (/^__HYPHEN_\d+__$/i.test(w)) return false;
      return true;
    });

  if (tokens.length === 0) return [];

  // 生成n-gram候选词
  const ngramCandidates = generateNgrams(tokens, 1, 4)
    .filter((term) => term.length >= 2)
    .filter((term) => {
      if (isProfessionalTerm(term)) return true;
      
      const wordsList = term.split(' ');
      if (wordsList.length > 1) {
        const nonStop = wordsList.filter((w) => !ENGLISH_STOPWORDS.has(w));
        return nonStop.length > 0;
      }
      return !ENGLISH_STOPWORDS.has(term);
    });
  
  const allCandidates = [...hyphenatedTerms, ...ngramCandidates];
  const freq = countWords(allCandidates);
  
  return Object.entries(freq)
    .map(([term_text, count]) => {
      let score = count;
      if (isProfessionalTerm(term_text)) score *= 2;
      if (term_text.includes('-') && term_text.length > 3) score *= 1.5;
      if (term_text.includes(' ')) score *= 1.2;
      return { term_text, score: Math.round(score), source_lang: 'en' };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * [新增] 通用拉丁语系术语抽取（fr/de/es/it/pt）
 * 由于这些语言共享拉丁字母，规则模式无法像中/英那样依赖字符集区分
 * 采用基于大写字母的专有名词识别 + n-gram + 专业术语特征匹配
 */
function extractLatinScriptTerms(text: string, lang: string): ExtractedTerm[] {
  // 大写专有名词/缩写识别（通用拉丁语系特征）
  const properNouns = new Set<string>();
  
  // 匹配连续大写字母开头的专有名词组（如 "Développement Durable", "Assemblée Nationale"）
  const properPhrasePattern = /((?:[A-ZÀ-Ü][a-zà-ü]+\s*){2,})/g;
  let match;
  while ((match = properPhrasePattern.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase.length >= 3 && phrase.length <= 80) {
      properNouns.add(phrase);
    }
  }

  // 匹配纯大写缩写（2-6字母，含带变音符号的大写字母）
  const uppercasePattern = /\b([A-ZÀ-Ü]{2,8})\b/g;
  while ((match = uppercasePattern.exec(text)) !== null) {
    const abbrev = match[1];
    if (abbrev.length >= 2) {
      properNouns.add(abbrev);
    }
  }

  // 各语种专业后缀匹配（提升召回的专业术语）
  const langSuffixes: Record<string, string[]> = {
    fr: ['tion', 'ment', 'ence', 'ance', 'ique', 'isme', 'logie', 'graphie', 'métrie', 'nomie', 'ité', 'aire', 'sation', 'isement'],
    de: ['tion', 'heit', 'keit', 'ung', 'schaft', 'ismus', 'logie', 'graphie', 'metrie', 'nomie'],
    es: ['ción', 'sión', 'dad', 'tad', 'ismo', 'logía', 'grafía', 'metría', 'nomía', 'miento'],
    it: ['zione', 'mento', 'enza', 'anza', 'ismo', 'logia', 'grafia', 'metria', 'nomia', 'ità'],
    pt: ['ção', 'são', 'dade', 'ismo', 'logia', 'grafia', 'metria', 'nomia', 'mento', 'ência', 'ância'],
  };

  const suffixes = langSuffixes[lang] || langSuffixes['fr'];
  
  // 通用专业术语特征（拉丁语系通用）
  const professionalPatterns = [
    /\b[A-Z][a-zà-ü]+(?:sation|isation|isierung|ización|izzazione|ização)\b/g,
    /\b[A-Za-zà-ü]+(?:développement|entwicklung|desarrollo|sviluppo|desenvolvimento)\b/gi,
    ...suffixes.map(s => new RegExp(`\\b[A-Za-zà-ü]+${s}\\b`, 'gi')),
  ];

  const profTerms = new Set<string>();
  for (const pattern of professionalPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const term = m[0].trim();
      if (term.length >= 4 && term.length <= 50) {
        profTerms.add(term);
      }
    }
  }

  // 2-4元n-gram（基于单词拆分）
  const words = text
    .split(/[\s,;:.!?()[\]{}'"&|/\\]+/)
    .filter(w => w.length >= 2 && /[a-zA-ZÀ-Üà-ü]/.test(w));

  if (words.length === 0) return [];

  const ngrams: string[] = [];
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      if (ngram.length >= 4 && ngram.length <= 80) {
        ngrams.push(ngram);
      }
    }
  }

  const freq = new Map<string, number>();
  for (const term of [...properNouns, ...profTerms, ...ngrams]) {
    freq.set(term, (freq.get(term) || 0) + 1);
  }

  const langStopWords: Record<string, Set<string>> = {
    fr: new Set(['le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'que', 'qui', 'dans', 'pour', 'avec', 'sur', 'pas', 'ne', 'se', 'ce', 'de', 'du', 'au', 'aux', 'est', 'sont', 'plus', 'moins', 'tout', 'tous', 'leur', 'leurs', 'nous', 'vous', 'ils', 'elles', 'lui', 'leur']),
    de: new Set(['der', 'die', 'das', 'und', 'oder', 'mit', 'von', 'für', 'auf', 'ist', 'sind', 'sich', 'ein', 'eine', 'nicht', 'auch', 'werden']),
    es: new Set(['el', 'la', 'los', 'las', 'un', 'una', 'que', 'por', 'con', 'para', 'del', 'las', 'más', 'como', 'este', 'entre', 'pero']),
    it: new Set(['il', 'la', 'i', 'le', 'un', 'una', 'che', 'per', 'con', 'del', 'sono', 'come', 'questa', 'più']),
    pt: new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'que', 'para', 'com', 'não', 'mais', 'como', 'entre']),
  };

  const stopWords = langStopWords[lang] || langStopWords['fr'];

  const results: ExtractedTerm[] = [];
  for (const [term_text, count] of freq) {
    const wordsInTerm = term_text.split(' ');
    const meaningfulWords = wordsInTerm.filter(w => !stopWords.has(w.toLowerCase()));
    if (meaningfulWords.length === 0) continue;

    let score = count;
    if (languageSpecificTermPatterns(term_text, lang)) score *= 2;
    if (/[A-ZÀ-Ü]/.test(term_text[0])) score *= 1.3;
    if (wordsInTerm.length > 1) score *= 1.2;

    results.push({ term_text, score: Math.round(score), source_lang: lang });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 拉丁语系术语领域特征识别
 */
function languageSpecificTermPatterns(term: string, lang: string): boolean {
  const patterns: Record<string, RegExp[]> = {
    fr: [/développement|gouvernement|politique|économ|formation|entreprise|stratég|sécurit|environnement/i],
    de: [/entwicklung|regierung|politik|wirtschaft|bildung|unternehmen|strategie|sicherheit|umwelt/i],
    es: [/desarrollo|gobierno|política|economía|formación|empresa|estrategia|seguridad|medio ambiente/i],
    it: [/sviluppo|governo|politica|economia|formazione|impresa|strategia|sicurezza|ambiente/i],
    pt: [/desenvolvimento|governo|política|economia|formação|empresa|estratégia|segurança|ambiente/i],
  };
  const langPatterns = patterns[lang] || [];
  return langPatterns.some(p => p.test(term));
}

/**
 * 多策略加载 pdfjs-dist legacy 构建，兼容：
 * - electron-vite 开发模式（ESM + "type":"module"）
 * - electron-vite 打包后（CJS 产物，require 可用）
 * 策略优先级：
 *   1. createRequire（ESM 环境最佳方案）
 *   2. 动态 import()（纯 ESM 原生方案）
 *   3. new Function require（打包后 CJS 兜底）
 */
async function loadPdfjsDistLegacy(loadErrors: string[]): Promise<any> {
  // 策略1：createRequire（ESM → CJS 桥接，electron-vite 开发模式下最可靠）
  try {
    const { createRequire } = await import('module');
    const resolveBase = typeof __filename !== 'undefined' ? __filename : process.cwd() + '/dummy.mjs';
    const nodeRequire = createRequire(import.meta.url || resolveBase || process.cwd() + '/dummy.mjs');
    const lib = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs');
    if (lib?.getDocument) {
      console.log('[Term Engine] PDF.js loaded via createRequire');
      return lib;
    }
    loadErrors.push('createRequire: 加载成功但 getDocument 不可用');
  } catch (e) {
    loadErrors.push(`createRequire: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 策略2：动态 import()（纯 ESM 原生方案）
  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const lib = (mod as any).default || mod;
    if (lib?.getDocument) {
      console.log('[Term Engine] PDF.js loaded via dynamic import()');
      return lib;
    }
    loadErrors.push('动态 import(): 加载成功但 getDocument 不可用');
  } catch (e) {
    loadErrors.push(`动态 import(): ${e instanceof Error ? e.message : String(e)}`);
  }

  // 策略3：new Function require（打包后 electron-vite 输出 CJS 环境兜底）
  try {
    const loader = new Function("return require('pdfjs-dist/legacy/build/pdf.mjs')");
    const lib = loader();
    if (lib?.getDocument) {
      console.log('[Term Engine] PDF.js loaded via new Function require');
      return lib;
    }
    loadErrors.push('new Function require: 加载成功但 getDocument 不可用');
  } catch (e) {
    loadErrors.push(`new Function require: ${e instanceof Error ? e.message : String(e)}`);
  }

  return null;
}

/**
 * 解析 pdfjs-dist 的安装路径，用于配置字体文件路径
 */
async function resolvePdfjsDistPath(loadErrors: string[]): Promise<string | null> {
  try {
    const { createRequire } = await import('module');
    const base = typeof __filename !== 'undefined' ? __filename : process.cwd() + '/dummy.mjs';
    const nodeRequire = createRequire(import.meta.url || base);
    return nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    try {
      const loader = new Function("return require.resolve('pdfjs-dist/legacy/build/pdf.mjs')");
      return loader();
    } catch (e) {
      loadErrors.push(`解析 pdfjs-dist 路径失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}

/**
 * 从已加载的 PDF 文档中提取所有页面文本
 */
async function extractPagesText(pdf: any): Promise<string> {
  const maxPages = pdf.numPages;

  if (maxPages <= 0) {
    throw new Error(`PDF 文件解析失败: 页面数为 ${maxPages}`);
  }

  console.log(`[Term Engine] PDF has ${maxPages} pages, extracting text...`);
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    if (!content?.items || content.items.length === 0) {
      console.log(`[Term Engine] Page ${pageNum}: no text items found (可能为图片型PDF页面)`);
      continue;
    }

    const pageText = content.items.map((item: any) => item.str ?? '').join(' ').trim();
    if (pageText.length > 0) {
      pageTexts.push(pageText);
      console.log(`[Term Engine] Page ${pageNum}: extracted ${pageText.length} chars`);
    }
  }

  const fullText = pageTexts.join('\n');

  // 检测是否为图片型PDF
  if (fullText.trim().length === 0) {
    console.warn('[Term Engine] 警告: PDF文本提取为空，这可能是图片型PDF（扫描件），建议使用AI视觉模式或OCR');
  }

  return fullText;
}

/**
 * 使用 pdfjs-dist 4.x legacy 构建加载 PDF 文本提取
 * pdfjs-dist 4.x 将 legacy 构建文件从 .js 改为 .mjs，需要用 new Function 动态 require
 * 在 Electron 打包后环境中可回退到 createRequire 方式
 */
async function extractTextFromPDF(dataBuffer: Buffer): Promise<string> {
  const loadErrors: string[] = [];
  
  // 加载 pdfjs-dist legacy 构建。electron-vite + "type":"module" 环境下
  // 优先使用 createRequire / 动态 import，避免 "require is not defined"。
  const pdfjsLib = await loadPdfjsDistLegacy(loadErrors);

  if (!pdfjsLib) {
    throw new Error(
      `PDF解析引擎加载失败，请确认 pdfjs-dist 依赖已正确安装。\n` +
      `错误详情:\n${loadErrors.map((e, i) => `  [${i + 1}] ${e}`).join('\n')}`
    );
  }

  // 配置标准字体数据 URL，避免中文字体渲染警告
  try {
    if (pdfjsLib.GlobalWorkerOptions) {
      const pdfjsDistPath = await resolvePdfjsDistPath(loadErrors);
      if (pdfjsDistPath) {
        const pdfjsDir = pdfjsDistPath.replace(/[\\/]pdf\.mjs$/, '');
        const cMapUrl = `file://${pdfjsDir}/cmaps/`;
        const standardFontDataUrl = `file://${pdfjsDir}/standard_fonts/`;
        pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = standardFontDataUrl;
        pdfjsLib.GlobalWorkerOptions.cMapUrl = cMapUrl;
        console.log(`[Term Engine] PDF.js font paths configured: cmaps=${cMapUrl}, fonts=${standardFontDataUrl}`);
      }
    }
  } catch (configError) {
    console.warn(`[Term Engine] PDF.js font path configuration failed (non-critical): ${configError instanceof Error ? configError.message : String(configError)}`);
  }

  if (!pdfjsLib?.getDocument) {
    throw new Error('PDF.js 加载成功但 getDocument 方法不可用，可能是版本不兼容');
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) });
    const pdf = await loadingTask.promise;
    return await extractPagesText(pdf);
  } catch (error: any) {
    const msg = error?.message || String(error);
    
    // Worker 加载失败降级：使用 disableWorker: true 重试
    if (
      msg.includes('Setting up fake worker failed') ||
      msg.includes('Cannot find module') ||
      msg.includes('pdf.worker') ||
      msg.includes('worker')
    ) {
      console.warn(
        '[Term Engine] Worker load failed, retrying with disableWorker: true\n' +
        `  Error: ${msg.substring(0, 200)}`
      );
      try {
        const fallbackTask = pdfjsLib.getDocument({
          data: new Uint8Array(dataBuffer),
          disableWorker: true,
        });
        const pdf = await fallbackTask.promise;
        return await extractPagesText(pdf);
      } catch (fallbackError: any) {
        const fbMsg = fallbackError?.message || String(fallbackError);
        throw new Error(`PDF文本提取失败: ${fbMsg}`);
      }
    }
    
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('PDF文件已加密，需要密码才能打开');
    }
    throw new Error(`PDF文本提取失败: ${msg}`);
  }
}

export async function extractTermsFromFile(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig,
  _sourceType?: string
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

  let pdfBuffer: Buffer | null = null;
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
      pdfBuffer = fs.readFileSync(filePath);
      text = await extractTextFromPDF(pdfBuffer);
      console.log(`[Term Engine] Successfully extracted ${text.length} characters from PDF`);
    } else if (ext === 'html' || ext === 'htm') {
      console.log('[Term Engine] Reading HTML file with content extraction');
      const html = fs.readFileSync(filePath, 'utf-8');
      console.log(`[Term Engine] HTML content length: ${html.length} characters`);
      // 使用增强的HTML内容提取，过滤噪声
      const extracted = extractHtmlContent(html);
      text = extracted.text;
      console.log(`[Term Engine] Extracted text: ${text.length} chars (was ${html.length} HTML), hasContent: ${extracted.hasContent}`);
      
      // 如果内容区提取结果太少，fallback到简单提取
      if (text.length < 50 && html.length > 1000) {
        console.log('[Term Engine] Content extraction too short, falling back to simple extraction');
        text = simpleHtmlToText(html);
      }
    } else {
      console.error(`[Term Engine] Unsupported file type: ${ext}`);
      throw new Error('Unsupported file type for extraction: ' + ext);
    }
  } catch (error) {
    console.error(`[Term Engine] Error reading/extracting text from file:`, error);
    throw new Error(`Failed to extract text from file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 对于图片型 PDF（提取文本过短），在 AI 模式下回退到 AI Vision 抽取
  const isPDFWithInsufficientText = ext === 'pdf' && (!text || text.trim().length < 100);
  
  if (isPDFWithInsufficientText && useAI && aiConfig?.apiKey) {
    console.log('[Term Engine] PDF text too short (< 100 chars), falling back to AI Vision extraction');
    
    // 检测 canvas 可用性，提前告知用户
    const canvasDiag = getCanvasDiagnostics();
    if (!canvasDiag.available) {
      console.warn(
        `[Term Engine] ⚠️  PDF 文本提取不足，疑似图片型/扫描型 PDF。\n` +
        `   Canvas 模块不可用 (${canvasDiag.error})，AI Vision 模式将无法渲染页面图像。\n` +
        `   建议：安装 Visual Studio C++ Clang 工具链后运行 npm rebuild canvas，\n` +
        `   或降级 Node.js 到 v20 LTS。`
      );
    }
    
    try {
      const terms = await extractTermsFromPDFWithAI(filePath, language, aiConfig);
      console.log(`[Term Engine] AI Vision extraction returned ${terms.length} terms`);
      return terms;
    } catch (aiError) {
      console.error('[Term Engine] AI Vision extraction failed, falling back to regular text extraction:', aiError);
      // 回退失败，继续走常规文本抽取
    }
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

/**
 * 通过 AI Vision 从 PDF 中抽取术语（支持文本型和图片型 PDF）
 * 
 * @param filePath PDF 文件路径
 * @param language 源语言
 * @param aiConfig AI 配置
 * @param onProgress 进度回调
 * @param maxPages 最大页数
 * @returns 结构化术语数组
 */
export async function extractTermsFromPDFWithAI(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  aiConfig: AIConfig,
  onProgress?: AIExtractionProgressCallback,
  maxPages?: number
): Promise<ExtractedTerm[]> {
  return extractTermsFromPDFViaAI(filePath, language, aiConfig, onProgress, maxPages);
}

export async function extractTermsFromUrl(
  url: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig,
  progressReporter?: ProgressReporter
): Promise<ExtractedTerm[]> {
  try {
    // 更新进度：开始网页抓取
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.FETCHING,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.FETCHING, 10),
        '开始网页抓取...'
      );
    }
    
    // 使用智能网页抓取器（自动选择JavaScript渲染）
    const result = await smartWebFetch({
      url,
      timeout: 45000, // 45秒超时
      retryCount: 3,
      forceJavaScript: url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com'),
      fallbackToSimple: true,
    });
    
    if (!result.success) {
      throw new Error(result.error || '网页抓取失败');
    }
    
    const html = result.html;
    console.log(`[Term Engine] Successfully extracted ${html.length} chars from URL: ${url}`);
    
    // 更新进度：网页抓取完成，开始HTML解析
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.HTML_PARSING,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.HTML_PARSING, 0),
        '解析HTML内容...'
      );
    }
    
    // 更新进度：HTML解析完成，开始文本提取
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.TEXT_EXTRACTION,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.TEXT_EXTRACTION, 0),
        '提取文本内容...'
      );
    }
    
    let text: string;
    
    if (useAI && aiConfig) {
      // [优化] AI路径：使用精简HTML保留结构信息，让AI更准确识别正文/标题/列表
      text = sanitizeHtmlForAI(html);
      console.log(`[Term Engine] AI path: using sanitized HTML (${text.length} chars with structure preserved)`);
    } else {
      // 规则路径：使用增强的HTML内容提取，过滤噪声
      const extracted = extractHtmlContent(html);
      text = extracted.text;
      console.log(`[Term Engine] Rules path: content extraction ${text.length} chars (from ${html.length} HTML), hasContent: ${extracted.hasContent}`);
      
      // 如果内容区提取结果太少，fallback到简单提取
      if (text.length < 50 && html.length > 1000) {
        console.log('[Term Engine] Content extraction too short, falling back to simple extraction');
        text = simpleHtmlToText(html);
      }
      
      // [改进] 对网页文本执行二次清洗，移除残留的导航/版权/纯数字行
      const preCleanLength = text.length;
      text = cleanWebText(text);
      if (text.length < preCleanLength) {
        console.log(`[Term Engine] URL text cleaned: ${preCleanLength} → ${text.length} chars`);
      }
    }
    
    // 调用文本提取函数
    return extractTermsFromText(text, language, useAI, aiConfig);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，网站响应过慢或无法访问。');
    }
    throw new Error('网页抽取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 增强版URL抽取 —— 同时返回术语列表和抽取元数据
 * 调用方可通过 metadata.fallbackReason 判断AI是否降级，并在UI上提示用户
 */
export async function extractTermsFromUrlWithMeta(
  url: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig,
  progressReporter?: ProgressReporter
): Promise<{ terms: ExtractedTerm[]; metadata: ExtractionMetadata }> {
  try {
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.FETCHING,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.FETCHING, 10),
        '开始网页抓取...'
      );
    }
    
    const result = await smartWebFetch({
      url,
      timeout: 45000,
      retryCount: 3,
      forceJavaScript: url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com'),
      fallbackToSimple: true,
    });
    
    if (!result.success) {
      throw new Error(result.error || '网页抓取失败');
    }
    
    const html = result.html;
    console.log(`[Term Engine] Successfully extracted ${html.length} chars from URL: ${url}`);
    
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.HTML_PARSING,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.HTML_PARSING, 0),
        '解析HTML内容...'
      );
    }
    
    // [优化] AI路径优先：使用精简HTML保留结构信息
    let text: string;
    if (useAI && aiConfig) {
      text = sanitizeHtmlForAI(html);
      console.log(`[Term Engine] AI path (withMeta): using sanitized HTML (${text.length} chars with structure preserved)`);
    } else {
      const extracted = extractHtmlContent(html);
      text = extracted.text;
      console.log(`[Term Engine] Rules path (withMeta): content extraction ${text.length} chars (from ${html.length} HTML), hasContent: ${extracted.hasContent}`);
      
      if (text.length < 50 && html.length > 1000) {
        console.log('[Term Engine] Content extraction too short, falling back to simple extraction');
        text = simpleHtmlToText(html);
      }
      
      const preCleanLength = text.length;
      text = cleanWebText(text);
      if (text.length < preCleanLength) {
        console.log(`[Term Engine] URL text cleaned: ${preCleanLength} → ${text.length} chars`);
      }
    }
    
    if (progressReporter) {
      progressReporter.updateStage(
        ProgressStages.TEXT_EXTRACTION,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.TEXT_EXTRACTION, 0),
        '提取文本内容...'
      );
    }
    
    // [P1增强] 检测双语表格/列表结构，用于双语网站的结构化抽取
    const bilingualPairs = extractBilingualTableRows(html);
    if (bilingualPairs.length >= 3) {
      console.log(`[Term Engine] Detected ${bilingualPairs.length} bilingual row pairs from HTML tables/lists`);
      const bilingualText = formatBilingualPairsForExtraction(bilingualPairs);
      console.log(`[Term Engine] Formatted bilingual text: ${bilingualText.length} chars, first 200: ${bilingualText.substring(0, 200)}`);
      
      // 将双语格式化文本通过标准抽取管线处理（保留AI/规则路径）
      // 格式化后的双语文本每行都是 "中文 | 英文"，AI和规则都能更好地处理
      const bilingualResult = await extractTermsFromTextWithMeta(bilingualText, 'auto', useAI, aiConfig);
      console.log(`[Term Engine] Bilingual extraction: ${bilingualResult.terms.length} terms, mode: ${bilingualResult.metadata.mode}`);
      
      // 修正元数据标记为双语来源
      bilingualResult.metadata.mode = bilingualResult.metadata.mode === 'ai-only' ? 'ai-bilingual' :
                                       bilingualResult.metadata.mode === 'ai-degraded-to-rules' ? 'bilingual-rules' :
                                       'bilingual-rules';
      return bilingualResult;
    }
    
    // 调用带元数据的文本提取
    return extractTermsFromTextWithMeta(text, language, useAI, aiConfig);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，网站响应过慢或无法访问。');
    }
    throw new Error('网页抽取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 增强版文件抽取 —— 同时返回术语列表和抽取元数据
 * 调用方可通过 metadata.fallbackReason 判断AI是否降级，并在UI上提示用户
 */
export async function extractTermsFromFileWithMeta(
  filePath: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  useAI = false,
  aiConfig?: AIConfig,
  _sourceType?: string
): Promise<{ terms: ExtractedTerm[]; metadata: ExtractionMetadata }> {
  console.log(`[Term Engine] extractTermsFromFileWithMeta called: ${filePath}, language: ${language}, useAI: ${useAI}`);
  
  const ext = filePath.split('.').pop()?.toLowerCase();
  console.log(`[Term Engine] File extension: ${ext}`);
  
  if (!ext) {
    throw new Error('Invalid file path: cannot determine file type');
  }
  
  if (!fs.existsSync(filePath)) {
    throw new Error('Invalid file path: file not found');
  }
  
  let text = '';
  try {
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
      const extracted = extractHtmlContent(html);
      text = extracted.text;
      if (text.length < 50 && html.length > 1000) {
        text = simpleHtmlToText(html);
      }
    } else {
      throw new Error('Unsupported file type for extraction: ' + ext);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported file type')) {
      throw error;
    }
    console.error(`[Term Engine] Error reading file ${filePath}:`, error);
    throw new Error('文件读取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
  
  console.log(`[Term Engine] Successfully extracted ${text.length} characters`);
  
  // 对于图片型 PDF（提取文本过短），在 AI 模式下回退到 AI Vision 抽取
  if (text.length < 100) {
    const isPDF = ext === 'pdf';
    if (isPDF && useAI && aiConfig?.apiKey) {
      console.log('[Term Engine] withMeta: PDF text too short (< 100 chars), falling back to AI Vision extraction');
      try {
        const terms = await extractTermsFromPDFWithAI(filePath, language, aiConfig);
        console.log(`[Term Engine] withMeta: AI Vision extraction returned ${terms.length} terms`);
        return {
          terms,
          metadata: {
            mode: 'ai-only',
            extractionMethod: 'ai-vision',
          } as ExtractionMetadata,
        };
      } catch (aiError) {
        console.error('[Term Engine] withMeta: AI Vision extraction failed, falling back:', aiError);
        return { terms: [], metadata: { mode: 'rules-only', fallbackReason: `AI Vision抽取失败: ${aiError instanceof Error ? aiError.message : String(aiError)}` } as ExtractionMetadata };
      }
    }
    console.warn('[Term Engine] WARNING: Very short text extracted, likely low-quality');
    return { terms: [], metadata: { mode: 'rules-only', fallbackReason: '文件内容过短，无法提取有效术语' } as ExtractionMetadata };
  }
  
  return extractTermsFromTextWithMeta(text, language, useAI, aiConfig);
}

/**
 * 智能抽取API - 使用新的智能抽取引擎
 */
export async function smartExtractTerms(
  text: string,
  language: 'en' | 'zh' | 'auto' = 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  // 当语言为auto时，检测是否为双语内容，双语则引导到bilingual extractor
  if (language === 'auto') {
    const detected = detectTextLanguage(text);
    if (detected.isBilingual) {
      console.log('[Term Engine] smartExtractTerms: Bilingual detected, including in AI prompt');
    }
  }
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
    console.log('[Term Engine] smartExtractTermsFromFile: Using enhanced HTML content extraction');
    const html = fs.readFileSync(filePath, 'utf-8');
    const extracted = extractHtmlContent(html);
    text = extracted.text;
    // Fallback到简单提取
    if (text.length < 50 && html.length > 1000) {
      text = simpleHtmlToText(html);
    }
  } else {
    throw new Error('Unsupported file type for extraction: ' + ext);
  }

  // 对于图片型 PDF（提取文本过短），在 AI 模式下回退到 AI Vision 抽取
  const isPDFWithInsufficientText = ext === 'pdf' && (!text || text.trim().length < 100);
  const hasAIStrategy = (strategy.mode === 'ai-only' || strategy.mode === 'hybrid') && strategy.aiConfig?.apiKey;
  
  if (isPDFWithInsufficientText && hasAIStrategy) {
    console.log('[Term Engine] smart: PDF text too short (< 100 chars), falling back to AI Vision extraction');
    try {
      const visionTerms = await extractTermsFromPDFViaAI(filePath, language, strategy.aiConfig!);
      console.log(`[Term Engine] smart: AI Vision extraction returned ${visionTerms.length} terms`);
      // 将 ExtractedTerm[] 转为 SmartExtractionResult[]
      const results: SmartExtractionResult[] = visionTerms.map(t => ({
        ...t,
        confidence: t.translation_confidence ?? 0.8,
        isExistingTerm: false,
        translationValue: Math.round(t.score),
      } as SmartExtractionResult));
      return results;
    } catch (aiError) {
      console.error('[Term Engine] smart: AI Vision extraction failed, falling back to regular text extraction:', aiError);
      // 回退失败，继续走常规文本抽取
    }
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
    // 使用智能网页抓取器（自动选择JavaScript渲染）
    const result = await smartWebFetch({
      url,
      timeout: 45000,
      retryCount: 3,
      forceJavaScript: url.includes('mp.weixin.qq.com') || url.includes('weixin.qq.com'),
      fallbackToSimple: true,
    });
    
    if (!result.success) {
      throw new Error(result.error || '网页抓取失败');
    }
    
    const html = result.html;
    console.log(`[Term Engine] smartExtractTermsFromUrl: ${html.length} chars from ${url}`);
    
    let text: string;
    
    // [优化] AI模式：使用精简HTML保留结构信息（h1-h6/li/table等标签），让AI更准确识别正文
    if (strategy.mode === 'ai-only' && strategy.aiConfig) {
      text = sanitizeHtmlForAI(html);
      console.log(`[Term Engine] smart AI path: using sanitized HTML (${text.length} chars with structure preserved)`);
    } else {
      // 规则路径：使用增强的HTML内容提取
      const extracted = extractHtmlContent(html);
      text = extracted.text;
      console.log(`[Term Engine] smart rules path: content extraction ${text.length} chars, hasContent: ${extracted.hasContent}`);
      
      // Fallback到简单提取
      if (text.length < 50 && html.length > 1000) {
        text = simpleHtmlToText(html);
      }
    }
    
    return smartExtractTerms(text, language, strategy);
  } catch (error) {
    throw new Error('URL抽取失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}
