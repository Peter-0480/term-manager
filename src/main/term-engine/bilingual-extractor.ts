/**
 * 双语术语提取器
 * 检测文本中的多语言内容，分别提取各语言术语并进行跨语言对齐
 */

import { ExtractedTerm } from './index';
import { extractTermsFromText } from './index';
import { isValidLanguagePair } from '../../renderer/utils/language-utils';

export interface BilingualSegment {
  language: string;
  text: string;
  confidence: number;
}

export interface AlignedTermPair {
  sourceTerm: string;
  sourceLang: string;
  targetTerm: string;
  targetLang: string;
  alignmentConfidence: number;
  sourceScore: number;
}

/**
 * 检测文本是否为双语内容
 * 如果包含两种或以上语言的显著比例，则判定为双语
 */
export function detectBilingualContent(text: string): {
  isBilingual: boolean;
  languages: { lang: string; ratio: number }[];
} {
  if (!text || text.length < 10) {
    return { isBilingual: false, languages: [] };
  }

  const totalChars = text.length;
  
  // 统计各语言字符比例
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const japaneseChars = (text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  
  // [修复] 拉丁语系精细检测：区分英语 vs 法语/德语/西班牙语/意大利语/葡萄牙语
  // 原逻辑将所有 [a-zA-Z] 字符都标记为 "en"，导致法语等被误判为英语
  const allLatinChars = (text.match(/[a-zA-ZÀ-ÖØ-öø-ÿ]/g) || []).length;
  
  // 各非英语拉丁语种特有字符统计
  const frenchSpecialChars = (text.match(/[éàèùâêîôûëïüÿçæœÉÀÈÙÂÊÎÔÛËÏÜŸÇÆŒ]/g) || []).length;
  const germanSpecialChars = (text.match(/[äöüßÄÖÜ]/g) || []).length;
  const spanishSpecialChars = (text.match(/[ñáéíóúü¿¡ÑÁÉÍÓÚÜ]/g) || []).length;
  const italianSpecialChars = (text.match(/[àèéìòùÀÈÉÌÒÙ]/g) || []).length;
  const portugueseSpecialChars = (text.match(/[ãõâêôáéíóúçûüÃÕÂÊÔÁÉÍÓÚÇÛÜ]/g) || []).length;
  
  // 基础拉丁字母（a-z, A-Z，排除非英语特有字符）
  const basicLatinChars = allLatinChars - frenchSpecialChars - germanSpecialChars - spanishSpecialChars - italianSpecialChars - portugueseSpecialChars;
  
  // 各语种总拉丁字符数（基础 + 特有）
  const frenchTotal = basicLatinChars + frenchSpecialChars;
  const germanTotal = basicLatinChars + germanSpecialChars;
  const spanishTotal = basicLatinChars + spanishSpecialChars;
  const italianTotal = basicLatinChars + italianSpecialChars;
  const portugueseTotal = basicLatinChars + portugueseSpecialChars;
  
  const languages: { lang: string; ratio: number }[] = [];
  const minRatio = 0.05; // 至少5%才算显著
  const minSpecialCharForLang = 2; // 至少2个特有字符才视为该语言显著（降低阈值以提高短段落法文等语种检出率）
  
  if (chineseChars / totalChars > minRatio) {
    languages.push({ lang: 'zh', ratio: chineseChars / totalChars });
  }
  if (japaneseChars / totalChars > minRatio) {
    languages.push({ lang: 'ja', ratio: japaneseChars / totalChars });
  }
  if (koreanChars / totalChars > minRatio) {
    languages.push({ lang: 'ko', ratio: koreanChars / totalChars });
  }
  if (cyrillicChars / totalChars > minRatio) {
    languages.push({ lang: 'ru', ratio: cyrillicChars / totalChars });
  }
  
  // [修复] 拉丁语系按特有字符比例判定语种
  if (allLatinChars / totalChars > minRatio) {
    const latinRatio = allLatinChars / totalChars;
    
    // 判断最可能的非英语拉丁语种
    const candidates: { lang: string; special: number; totalRatio: number }[] = [
      { lang: 'fr', special: frenchSpecialChars, totalRatio: frenchTotal / totalChars },
      { lang: 'de', special: germanSpecialChars, totalRatio: germanTotal / totalChars },
      { lang: 'es', special: spanishSpecialChars, totalRatio: spanishTotal / totalChars },
      { lang: 'it', special: italianSpecialChars, totalRatio: italianTotal / totalChars },
      { lang: 'pt', special: portugueseSpecialChars, totalRatio: portugueseTotal / totalChars },
    ];
    
    // 按特有字符数从多到少排序
    candidates.sort((a, b) => b.special - a.special);
    const bestCandidate = candidates[0];
    
    if (bestCandidate.special >= minSpecialCharForLang) {
      // 特有的非英语拉丁语种占主导
      languages.push({ lang: bestCandidate.lang, ratio: Math.min(latinRatio, 1.0) });
      console.log(`[Bilingual Detector] Detected non-English Latin: ${bestCandidate.lang} (${bestCandidate.special} special chars)`);
    } else if (basicLatinChars / totalChars > minRatio) {
      // 基础拉丁字符占主导，判定为英语
      languages.push({ lang: 'en', ratio: basicLatinChars / totalChars });
    }
  }
  
  // 如果包含两种或以上语言，则为双语
  const isBilingual = languages.length >= 2;
  
  console.log(`[Bilingual Detector] isBilingual: ${isBilingual}, languages: ${JSON.stringify(languages)}`);
  
  return { isBilingual, languages };
}

/**
 * 基于已知的语言分布对文本进行分段
 * 返回按语言分类的文本片段
 */
export function segmentByLanguage(text: string): BilingualSegment[] {
  const segments: BilingualSegment[] = [];
  
  if (!text || text.length === 0) {
    return segments;
  }
  
  // 按段落分割
  const paragraphs = text.split(/\n\s*\n/);
  let currentSegment: BilingualSegment | null = null;
  
  for (const para of paragraphs) {
    if (para.trim().length === 0) continue;
    
    // 检测段落语言
    const zhCount = (para.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latinCount = (para.match(/[a-zA-Z]/g) || []).length;
    // 法文及其他拉丁语种特有字符（带重音/变音符号的字母）
    const frSpecificCount = (para.match(/[éèêëàâäùûüçôöîïÉÈÊËÀÂÄÙÛÜÇÔÖÎÏ]/g) || []).length;
    // 德文特有：ß, ü, ö, ä (部分与法文重叠，但德文一般有 ß)
    const deSpecificCount = (para.match(/[ß]/g) || []).length;
    // 西班牙文特有：ñ, ¿, ¡
    const esSpecificCount = (para.match(/[ñÑ¿¡]/g) || []).length;
    const totalSignificant = zhCount + latinCount;
    
    if (totalSignificant === 0) {
      // 无法判断语言（如纯数字/符号），并入前一段
      if (currentSegment) {
        currentSegment.text += '\n\n' + para;
      }
      continue;
    }
    
    let lang: string;
    let confidence: number;
    
    if (zhCount / totalSignificant > 0.6) {
      lang = 'zh';
      confidence = Math.min(1, zhCount / totalSignificant);
    } else if (latinCount / totalSignificant > 0.6) {
      // 拉丁字母段落，进一步区分语种
      if (frSpecificCount >= 2) {
        lang = 'fr';
        confidence = Math.min(1, latinCount / totalSignificant);
      } else if (deSpecificCount >= 2) {
        lang = 'de';
        confidence = Math.min(1, latinCount / totalSignificant);
      } else if (esSpecificCount >= 2) {
        lang = 'es';
        confidence = Math.min(1, latinCount / totalSignificant);
      } else {
        lang = 'en';
        confidence = Math.min(1, latinCount / totalSignificant);
      }
    } else {
      lang = zhCount > latinCount ? 'zh' : 'en';
      confidence = 0.5;
    }
    
    // 如果与当前段语言相同，合并
    if (currentSegment && currentSegment.language === lang) {
      currentSegment.text += '\n\n' + para;
    } else {
      // 开始新段
      currentSegment = {
        language: lang,
        text: para,
        confidence,
      };
      segments.push(currentSegment);
    }
  }
  
  console.log(`[Bilingual Segments] Split into ${segments.length} segments: ${
    segments.map(s => `${s.language}(${s.text.length}chars)`).join(', ')
  }`);
  
  return segments;
}

/**
 * 对齐双语术语对
 * 使用字符串相似度算法在两种语言的术语列表之间寻找对应关系
 */
export function alignTermPairs(
  sourceTerms: ExtractedTerm[],
  targetTerms: ExtractedTerm[],
  sourceLang: string,
  targetLang: string
): AlignedTermPair[] {
  const pairs: AlignedTermPair[] = [];
  const usedTargets = new Set<number>();
  
  // 1. 精确匹配：寻找完全对应的术语（用于双语并列文本）
  // 例如英文术语和紧跟的中文翻译
  for (let si = 0; si < sourceTerms.length; si++) {
    const source = sourceTerms[si];
    let bestMatch: { index: number; score: number } | null = null;
    
    for (let ti = 0; ti < targetTerms.length; ti++) {
      if (usedTargets.has(ti)) continue;
      
      const target = targetTerms[ti];
      
      // 计算上下文邻近度（索引接近的术语更可能配对）
      const proximityScore = 1 - Math.min(Math.abs(si - ti) / Math.max(sourceTerms.length, targetTerms.length), 1);
      
      // 计算文本相似度
      const simScore = computeTextSimilarity(source.term_text, target.term_text);
      
      // 综合评分
      const combined = simScore * 0.6 + proximityScore * 0.4;
      
      if (combined > 0.3 && (!bestMatch || combined > bestMatch.score)) {
        bestMatch = { index: ti, score: combined };
      }
    }
    
    if (bestMatch) {
      usedTargets.add(bestMatch.index);
      pairs.push({
        sourceTerm: source.term_text,
        sourceLang,
        targetTerm: targetTerms[bestMatch.index].term_text,
        targetLang,
        alignmentConfidence: bestMatch.score,
        sourceScore: source.score,
      });
    }
  }
  
  // 2. 为未配对的源术语创建半配对（只有源术语）
  for (let si = 0; si < sourceTerms.length; si++) {
    const alreadyPaired = pairs.some(p => p.sourceTerm === sourceTerms[si].term_text);
    if (!alreadyPaired) {
      pairs.push({
        sourceTerm: sourceTerms[si].term_text,
        sourceLang,
        targetTerm: '',
        targetLang,
        alignmentConfidence: 0,
        sourceScore: sourceTerms[si].score,
      });
    }
  }
  
  // 按置信度排序
  pairs.sort((a, b) => b.alignmentConfidence - a.alignmentConfidence);
  
  console.log(`[Bilingual Aligner] Aligned ${pairs.length} term pairs`);
  
  return pairs;
}

/**
 * 计算两个术语的文本相似度
 * 用于检测双语对译关系
 */
function computeTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  const norm1 = text1.toLowerCase().trim();
  const norm2 = text2.toLowerCase().trim();
  
  if (norm1 === norm2) return 1.0;
  
  // 检查是否包含关系（如 "data" 和 "data management"）
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length < norm2.length ? norm2 : norm1;
    return shorter.length / longer.length;
  }
  
  // Jaccard相似度（字符级别）
  const set1 = new Set(norm1.split(''));
  const set2 = new Set(norm2.split(''));
  const intersection = new Set([...set1].filter(c => set2.has(c)));
  const union = new Set([...set1, ...set2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 双语术语抽取主函数
 * 检测双语内容 → 分段 → 分别提取 → 对齐
 */
export async function extractBilingualTerms(
  text: string,
  useAI: boolean,
  aiConfig?: any,
  progressCallback?: (stage: string, progress: number, message: string) => void
): Promise<ExtractedTerm[]> {
  console.log(`[Bilingual Extractor] Starting bilingual extraction, text length: ${text.length}`);
  
  // 1. 检测是否为双语内容
  progressCallback?.('detecting', 5, '检测双语内容...');
  const bilingualInfo = detectBilingualContent(text);
  
  if (!bilingualInfo.isBilingual) {
    console.log('[Bilingual Extractor] Text is not bilingual, falling back to single language extraction');
    return [];
  }
  
  console.log(`[Bilingual Extractor] Detected bilingual: ${bilingualInfo.languages.map(l => `${l.lang}(${(l.ratio * 100).toFixed(0)}%)`).join(', ')}`);
  
  // 2. 按语言分段
  progressCallback?.('segmenting', 15, '按语言分段...');
  const segments = segmentByLanguage(text);
  
  if (segments.length < 2) {
    console.log('[Bilingual Extractor] Could not segment into multiple languages');
    return [];
  }
  
  // 3. 按语言分组提取术语
  progressCallback?.('extracting', 30, '提取各语言术语...');
  
  const langGroups = new Map<string, string[]>();
  for (const seg of segments) {
    if (!langGroups.has(seg.language)) {
      langGroups.set(seg.language, []);
    }
    langGroups.get(seg.language)!.push(seg.text);
  }
  
  const allExtractedTerms: Map<string, ExtractedTerm[]> = new Map();
  const langList = Array.from(langGroups.keys());
  
  for (let i = 0; i < langList.length; i++) {
    const lang = langList[i];
    const combinedText = langGroups.get(lang)!.join('\n\n');
    
    progressCallback?.('extracting', 30 + (i / langList.length) * 30, `提取${lang === 'zh' ? '中文' : lang === 'en' ? '英文' : lang}术语...`);
    
    try {
      const terms = await extractTermsFromText(combinedText, lang as 'en' | 'zh' | 'auto', useAI, aiConfig);
      allExtractedTerms.set(lang, terms);
      console.log(`[Bilingual Extractor] Extracted ${terms.length} terms from ${lang}`);
    } catch (error) {
      console.error(`[Bilingual Extractor] Failed to extract ${lang} terms:`, error);
      allExtractedTerms.set(lang, []);
    }
  }
  
  // 4. 术语对齐
  progressCallback?.('aligning', 70, '对齐双语术语...');
  
  const alignedResults: ExtractedTerm[] = [];
  const langArray = Array.from(allExtractedTerms.entries());
  
  // ========== [新增] 语言对过滤：只处理含中文的语言对，跳过外-外语对 ==========
  const validPairs: Array<[string, ExtractedTerm[], string, ExtractedTerm[]]> = [];
  for (let i = 0; i < langArray.length; i++) {
    for (let j = i + 1; j < langArray.length; j++) {
      const [lang1, terms1] = langArray[i];
      const [lang2, terms2] = langArray[j];
      
      // 使用 language-utils 的 isValidLanguagePair 校验
      // 规则：必须涉及中文（zh），外-外语对跳过
      if (isValidLanguagePair(lang1, lang2)) {
        validPairs.push([lang1, terms1, lang2, terms2]);
        console.log(`[Bilingual Extractor] Will align pair: ${lang1} ↔ ${lang2} (valid)`);
      } else {
        console.log(`[Bilingual Extractor] Skipping foreign-foreign pair: ${lang1} ↔ ${lang2}`);
      }
    }
  }
  
  // 如果没有有效的语言对，降级返回单语言抽取结果
  if (validPairs.length === 0) {
    console.log('[Bilingual Extractor] No valid language pairs found (all foreign-foreign), falling back to single-language extraction');
    // 只返回中文抽取的结果（如果有），或其他语言各自作为单语术语
    const zhTerms = allExtractedTerms.get('zh') || [];
    if (zhTerms.length > 0) {
      console.log(`[Bilingual Extractor] Returning ${zhTerms.length} Chinese terms as fallback`);
      progressCallback?.('finalizing', 90, '无有效双语对，返回中文术语...');
      return zhTerms.slice(0, 100);
    }
    // 如果没有中文，返回空结果
    return [];
  }
  
  // 配对有效的语言组合
  for (const [lang1, terms1, lang2, terms2] of validPairs) {
    const pairs = alignTermPairs(terms1, terms2, lang1, lang2);
    
    for (const pair of pairs) {
      alignedResults.push({
        term_text: pair.sourceTerm,
        score: pair.sourceScore,
        source_lang: pair.sourceLang,
        target_term: pair.targetTerm || undefined,
        target_lang: pair.targetLang,
        translation_source: pair.alignmentConfidence > 0.5 ? 'file' : 'none',
        translation_confidence: pair.alignmentConfidence > 0 ? pair.alignmentConfidence : undefined,
      });
    }
    
    // 反向配对（确保另一方向也有记录）
    const reversePairs = alignTermPairs(terms2, terms1, lang2, lang1);
    for (const pair of reversePairs) {
      // 避免重复
      if (!alignedResults.some(r => r.term_text === pair.sourceTerm && r.source_lang === pair.sourceLang)) {
        alignedResults.push({
          term_text: pair.sourceTerm,
          score: pair.sourceScore,
          source_lang: pair.sourceLang,
          target_term: pair.targetTerm || undefined,
          target_lang: pair.targetLang,
          translation_source: pair.alignmentConfidence > 0.5 ? 'file' : 'none',
          translation_confidence: pair.alignmentConfidence > 0 ? pair.alignmentConfidence : undefined,
        });
      }
    }
  }
  
  // ========== [新增] 最终输出前再次过滤 ==========
  const beforeLangFilter = alignedResults.length;
  const langFiltered = alignedResults.filter(r => {
    // 如果 source_lang 和 target_lang 都存在
    if (r.source_lang && r.target_lang) {
      // 至少一方必须是中文
      return isValidLanguagePair(r.source_lang, r.target_lang);
    }
    // 只有 source_lang 的条目则保留（单语术语）
    return true;
  });
  if (beforeLangFilter !== langFiltered.length) {
    console.log(`[Bilingual Extractor] Language pair filter (output): ${beforeLangFilter} -> ${langFiltered.length} terms`);
  }
  
  progressCallback?.('finalizing', 90, '整理双语抽取结果...');
  
  console.log(`[Bilingual Extractor] Completed with ${langFiltered.length} bilingual terms`);
  
  return langFiltered.slice(0, 100);
}
