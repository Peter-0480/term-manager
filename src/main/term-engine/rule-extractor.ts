/**
 * 规则抽取模块
 * 负责基于规则的术语抽取：中文、英文、词汇表等
 * 从 index.ts 中拆分出来，独立的规则抽取逻辑
 */

import { ExtractedTerm } from './types';
import { preprocessChineseText } from './content-cleaner';
import { CHINESE_TERM_SUFFIXES, CHINESE_TERM_PREFIXES } from './content-cleaner';

// ═══════════════════════════════════════════
// 常见中文停用词
// ═══════════════════════════════════════════

const CHINESE_STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们',
  '那', '些', '什么', '怎么', '怎样', '哪', '哪里', '吗', '呢', '吧',
  '啊', '呀', '哇', '哦', '嗯', '哈',
  '但是', '然而', '所以', '因为', '因此', '并且', '或者', '而且',
  '虽然', '如果', '即使', '尽管', '不过', '还是', '只是', '才',
  '又', '再', '更', '最', '很', '太', '非常', '十分', '特别',
  '这', '那', '这个', '那个', '这些', '那些', '这里', '那里',
  '可以', '可能', '能够', '应该', '必须', '需要', '已经', '正在',
  '把', '被', '让', '使', '从', '向', '对', '给', '为', '以',
  '中', '里', '内', '外', '前', '后', '上', '下', '间',
  '个', '条', '件', '种', '类', '些', '点', '方', '次', '项',
  '很有的', '不是吗',
]);

// ═══════════════════════════════════════════
// UI噪声模式
// ═══════════════════════════════════════════

const UI_NOISE_PATTERNS = [
  '小中大分享到', '小中大', '分享到', '字体',
  '摘要', '关键字', '关键词', '下载文献', '参考文献',
  '阅读全文', '点击阅读', '分享到', '收藏本文',
  '来源', '作者', '责任编辑', '编辑', '校对',
  '版权', '声明', '广告', '推广', '赞助',
  '时间', '日期', '分享', '收藏', '点赞', '在看',
  '关注我们', '扫码', '二维码', '阅读原文',
];

// ═══════════════════════════════════════════
// 动词/虚词黑名单
// ═══════════════════════════════════════════

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
  // 虚词/粒子
  '了', '着', '过', '所', '被', '把', '将', '从', '对', '向', '到', '用',
  '并', '而', '且', '或', '与', '及', '既',
  // 常见截断词
  '本文', '文章', '该书', '这篇', '这个', '一种', '一些', '其中',
];

// ═══════════════════════════════════════════
// 结构词
// ═══════════════════════════════════════════

const STRUCTURE_WORDS = ['的', '之', '与', '及', '和'];

// ═══════════════════════════════════════════
// 英语功能词（停用词）
// ═══════════════════════════════════════════

const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
  'may', 'might', 'must', 'can', 'could',
  'this', 'that', 'these', 'those', 'here', 'there',
  'and', 'but', 'or', 'not', 'if', 'then', 'else', 'when', 'where', 'how',
  'what', 'which', 'who', 'whom', 'whose',
  'to', 'from', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'through', 'during', 'before', 'after', 'above', 'below',
  'of', 'it', 'its', 'he', 'she', 'they', 'them', 'their', 'we', 'our', 'you', 'your',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'also', 'up', 'out', 'as', 'just', 'now',
]);

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

/**
 * 判断中文术语是否具有专业价值
 */
function isChineseProfessionalTerm(candidate: string): boolean {
  if (!candidate || candidate.length < 4) return false;

  // 语义完整性检查
  const badStarts = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对'];
  for (const bs of badStarts) {
    if (candidate.startsWith(bs)) return false;
  }

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
 * 过滤碎片化术语：防止语义不完整的断词碎片进入最终输出
 */
function filterFragmentaryTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
  return terms.filter(term => {
    const text = term.term_text;

    // 以虚词/粒子开头的（这些通常是截断碎片）
    const badPrefixes = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对', '贵'];
    for (const bp of badPrefixes) {
      if (text.startsWith(bp)) return false;
    }

    // 中文术语至少4个字
    if (/[\u4e00-\u9fa5]/.test(text) && text.replace(/[^\u4e00-\u9fa5]/g, '').length < 3) {
      return false;
    }

    return true;
  });
}

// ═══════════════════════════════════════════
// 中文术语抽取
// ═══════════════════════════════════════════

/**
 * 从中文文本中提取术语（改进版）
 *
 * 核心改进：
 * - 使用标点自然分段 + 模式匹配
 * - 最小术语长度限制为4字
 * - 评分基于专业特征而非出现频率
 * - 基于后缀逆向扫描的专业术语匹配
 */
export function extractChineseTerms(text: string): ExtractedTerm[] {
  if (!text || text.trim().length < 2) return [];

  // 预处理：去除英文噪声
  text = preprocessChineseText(text);

  if (!text || text.length < 10) return [];

  // ---- 步骤1：按标点和换行自然分段，过滤UI噪声 ----
  const segments = text
    .split(/[，。！？、；：\n\r（）\(\)【】\[\]""''\u2018\u2019\u201c\u201d\u300a\u300b\u3001\u3002\u2026\u2014]+/)
    .map(s => {
      let cleaned = s;
      // 移除UI噪声
      for (const pattern of UI_NOISE_PATTERNS) {
        const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        cleaned = cleaned.replace(regex, '');
      }
      cleaned = cleaned.trim();
      return cleaned;
    })
    .filter(s => {
      const pure = s.replace(/[^\u4e00-\u9fa5]/g, '');
      return pure.length >= 4;
    });

  if (segments.length === 0) return [];

  // ---- 步骤2：从每个片段中提取有意义的术语候选 ----
  const candidates: string[] = [];
  const candidateSet = new Set<string>();

  for (const segment of segments) {
    const pureChinese = segment.replace(/[^\u4e00-\u9fa5]/g, '');
    if (!pureChinese || pureChinese.length < 4) continue;

    // 模式A：整段作为候选（如果长度≤12且符合专业术语前后缀特征）
    if (pureChinese.length <= 12 && isChineseProfessionalTerm(pureChinese)) {
      if (!candidateSet.has(pureChinese)) {
        candidates.push(pureChinese);
        candidateSet.add(pureChinese);
      }
    }

    // 模式B：按功能词切分为更小的语义单元
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
    const lastPart = pureChinese.substring(lastEnd);
    if (lastPart.length >= 4 && lastPart.length <= 12 && !candidateSet.has(lastPart) && isChineseProfessionalTerm(lastPart)) {
      candidates.push(lastPart);
      candidateSet.add(lastPart);
    }

    // 模式C：基于后缀逆向扫描的专业术语匹配
    {
      const suffixList = [...CHINESE_TERM_SUFFIXES].sort((a, b) => b.length - a.length);
      const boundaryWords = ['的', '与', '及', '或', '在', '于', '而', '之', '则', '为', '所', '被', '把', '将', '从', '对', '向', '到', '用', '了', '着', '过', '通过', '根据', '按照', '关于', '对于', '除了'];

      let scanPos = 0;
      while (scanPos < pureChinese.length) {
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

        let termStart = -1;
        const maxLookback = Math.max(0, nearestSuffixIdx - 12);
        for (let i = nearestSuffixIdx - 1; i >= maxLookback; i--) {
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

        if (termStart === -1) termStart = maxLookback;

        const term = pureChinese.substring(termStart, nearestSuffixIdx + nearestSuffixLen);
        const termLen = term.length;

        if (termLen >= 4 && termLen <= 12 && !candidateSet.has(term)) {
          let startsWithBadWord = false;
          for (const verb of VERB_BLACKLIST) {
            if (term.startsWith(verb)) { startsWithBadWord = true; break; }
          }
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

    // 模式D：提取包含数字的专业术语
    const numPatterns = pureChinese.match(/[\u4e00-\u9fa5]*[一二三四五六七八九十百千万亿][\u4e00-\u9fa5]+/g);
    if (numPatterns) {
      for (const matched of numPatterns) {
        if (matched.length >= 4 && matched.length <= 12 && !candidateSet.has(matched)) {
          candidates.push(matched);
          candidateSet.add(matched);
        }
      }
    }

    // 模式E：提取中英文混合术语
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

  // 步骤2.5：过滤动词/介词/虚词开头的候选
  const filteredCandidates = candidates.filter(term_text => {
    for (const verb of VERB_BLACKLIST) {
      if (term_text.startsWith(verb)) return false;
    }
    const badStarts = ['了', '的', '着', '过', '而', '且', '其', '但', '还', '也', '就', '都', '所', '被', '把', '将', '从', '对'];
    for (const bs of badStarts) {
      if (term_text.startsWith(bs)) return false;
    }
    return true;
  });

  if (filteredCandidates.length === 0) return [];

  // 步骤3：基于专业特征评分
  const results = filteredCandidates
    .map(term_text => {
      let score = 0;

      if (term_text.length === 4) score += 7;
      if (term_text.length >= 5 && term_text.length <= 6) score += 9;
      if (term_text.length >= 7 && term_text.length <= 8) score += 8;
      if (term_text.length > 8) score += 4;

      for (const suffix of CHINESE_TERM_SUFFIXES) {
        if (term_text.endsWith(suffix)) { score += 6; break; }
      }

      for (const prefix of CHINESE_TERM_PREFIXES) {
        if (term_text.startsWith(prefix)) { score += 4; break; }
      }

      for (const structWord of STRUCTURE_WORDS) {
        if (term_text.includes(structWord)) { score += 2; break; }
      }

      if (/[\u4e00-\u9fa5].*[a-zA-Z]|[a-zA-Z].*[\u4e00-\u9fa5]/.test(term_text)) score += 5;
      if (/[一二三四五六七八九十百千万亿]/.test(term_text)) score += 4;

      const stopwordArray = Array.from(CHINESE_STOPWORDS);
      const containsStopword = stopwordArray.some(stop => term_text.includes(stop));
      if (!containsStopword) score += 3;

      return { term_text, score: Math.max(1, score), source_lang: 'zh' };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  return results;
}

// ═══════════════════════════════════════════
// 英文术语抽取
// ═══════════════════════════════════════════

/**
 * 判断是否为可能的英文术语
 */
function isLikelyEnglishTerm(word: string): boolean {
  if (!word || word.length < 3) return false;
  if (ENGLISH_STOPWORDS.has(word.toLowerCase())) return false;

  // 过滤纯数字
  if (/^\d+$/.test(word)) return false;

  // 首字母大写或全大写的更可能是术语
  if (/^[A-Z]/.test(word) && word.length >= 3) return true;

  // 包含连字符的复合词
  if (word.includes('-') && word.replace(/-/g, '').length >= 5) return true;

  // 长度>=5的词（过滤掉常见的短介词/代词）
  if (word.length >= 5 && /[a-z]/.test(word)) return true;

  return false;
}

/**
 * 从英文文本中提取术语
 */
export function extractEnglishTerms(text: string): ExtractedTerm[] {
  if (!text || text.length < 10) return [];

  // 保护连字符术语
  const hyphenatedTerms: string[] = [];
  const hyphenRegex = /\b[a-zA-Z]+(?:-[a-zA-Z]+)+\b/g;
  let match;
  while ((match = hyphenRegex.exec(text)) !== null) {
    hyphenatedTerms.push(match[0]);
  }

  // 清洗文本：移除HTML、URL等
  let cleaned = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 分词
  const words = cleaned.match(/\b[a-zA-Z][a-zA-Z0-9\-]*\b/g) || [];

  // 频率统计
  const freqMap = new Map<string, number>();
  for (const w of words) {
    const lower = w.toLowerCase();
    freqMap.set(lower, (freqMap.get(lower) || 0) + 1);
  }

  // 筛选候选术语
  const candidates: { term_text: string; frequency: number }[] = [];
  const seen = new Set<string>();

  for (const w of words) {
    if (seen.has(w.toLowerCase())) continue;
    if (!isLikelyEnglishTerm(w)) continue;

    seen.add(w.toLowerCase());
    candidates.push({
      term_text: w,
      frequency: freqMap.get(w.toLowerCase()) || 1,
    });
  }

  // 添加被保护的连字符术语
  for (const ht of hyphenatedTerms) {
    if (!seen.has(ht.toLowerCase()) && isLikelyEnglishTerm(ht)) {
      seen.add(ht.toLowerCase());
      candidates.push({ term_text: ht, frequency: 1 });
    }
  }

  // 评分排序
  const results = candidates
    .map(c => {
      let score = 0;

      // 频率加分（最多5分）
      score += Math.min(c.frequency, 5);

      // 长度加分
      if (c.term_text.length >= 5 && c.term_text.length <= 15) score += 4;
      if (c.term_text.length > 15) score += 2;

      // 首字母大写加分
      if (/^[A-Z]/.test(c.term_text)) score += 3;

      // 复合词（带连字符）加分
      if (c.term_text.includes('-')) score += 5;

      // 包含数字的缩写术语加分
      if (/[A-Z]+\d+|\d+[A-Z]+/.test(c.term_text)) score += 4;

      return {
        term_text: c.term_text,
        score: Math.max(1, score),
        source_lang: 'en' as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  return results;
}

// ═══════════════════════════════════════════
// 词汇表条目抽取（编号词汇列表快速通道）
// ═══════════════════════════════════════════

/**
 * 将解析出的词汇表条目转换为 ExtractedTerm 数组
 * 这是针对编号词汇列表的专用快速通道，不依赖AI也不依赖规则模式
 */
export function extractFromVocabEntries(entriesText: string): ExtractedTerm[] {
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

    terms.push({
      term_text: chineseTerm,
      score: 10,
      source_lang: 'zh',
      target_term: englishTranslation,
      target_lang: 'en',
      translation_source: 'numbered-vocab-list',
      translation_confidence: 0.85,
    });
  }

  return terms;
}

// ═══════════════════════════════════════════
// 组合抽取（中文+英文混合）
// ═══════════════════════════════════════════

/**
 * 混合抽取：同时抽取中文和英文术语，合并去重
 */
export function extractTermsByRules(text: string): ExtractedTerm[] {
  const chineseTerms = extractChineseTerms(text);
  const englishTerms = extractEnglishTerms(text);

  // 合并去重
  const merged = [...chineseTerms, ...englishTerms];
  const seen = new Set<string>();
  const deduped: ExtractedTerm[] = [];

  for (const term of merged) {
    const key = `${term.term_text.toLowerCase()}_${term.source_lang}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(term);
    }
  }

  // 应用碎片过滤
  const filtered = filterFragmentaryTerms(deduped);

  // 按分数排序取最多300条
  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, 300);
}

// ═══════════════════════════════════════════
// 重新导出供外部使用
// ═══════════════════════════════════════════

export { filterFragmentaryTerms, isChineseProfessionalTerm };