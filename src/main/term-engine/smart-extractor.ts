/**
 * 智能术语抽取模块 - 基于大模型和现有术语库的智能抽取
 */

import { ExtractedTerm } from './index';
import { isNoiseTerm } from './ai-extractor';
import { getTerms, getDomains } from '../database';
import { AIConfig, getFullEndpoint, validateAIConfig } from '../ai-client';
import { globalRequestMerger } from '../api-cache-manager';
import { aiFetch, buildAIBody, extractContentFromResponse } from '../ai-fetch';
import { APIResponseHandler } from '../api-response-handler';
import { ProgressReporter } from '../progress-reporter';
import { detectBilingualContent } from './bilingual-extractor';

/**
 * 简单的字符串哈希函数
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash);
}

export interface ExtractionStrategy {
  // 基本策略
  mode: 'ai-only' | 'hybrid' | 'rules-only';
  
  // 现有术语库使用
  useExistingTerms: boolean;
  similarityThreshold: number; // 0-1，与现有术语的相似度阈值
  
  // AI配置
  aiConfig?: AIConfig;
  
  // 规则过滤
  minTermLength: number;
  maxTermLength: number;
  
  // 结果数量控制
  maxResults: number; // 单次抽取结果上限，默认300
  
  // 领域自适应
  domainId?: number;
  adaptToDomain: boolean;
}

export interface TermFeature {
  text: string;
  length: number;
  containsNumbers: boolean;
  containsSpecialChars: boolean;
  containsEnglish: boolean;
  containsChinese: boolean;
  wordCount: number;
  isAcronym: boolean; // 是否为缩写
  domainId?: number;
  frequency?: number; // 在现有库中的使用频率
}

export interface SmartExtractionResult extends ExtractedTerm {
  confidence: number; // 置信度 0-1
  isExistingTerm: boolean; // 是否已存在于术语库
  domainMatch?: number; // 领域匹配度
  translationValue: number; // 翻译价值评分 0-10
}

// 默认抽取策略
export const DEFAULT_STRATEGY: ExtractionStrategy = {
  mode: 'hybrid',
  useExistingTerms: true,
  similarityThreshold: 0.7,
  minTermLength: 2,
  maxTermLength: 20,
  maxResults: 300,
  adaptToDomain: true,
};

/**
 * 分析现有术语库特征
 */
export function analyzeTermFeatures(): TermFeature[] {
  const terms = getTerms({ pageSize: 1000 }); // 获取最多1000个术语进行分析
  const features: TermFeature[] = [];
  
  if (terms.rows && Array.isArray(terms.rows)) {
    terms.rows.forEach(term => {
      features.push({
        text: term.term_text,
        length: term.term_text.length,
        containsNumbers: /\d/.test(term.term_text),
        containsSpecialChars: /[^a-zA-Z0-9\u4e00-\u9fa5\s]/.test(term.term_text),
        containsEnglish: /[a-zA-Z]/.test(term.term_text),
        containsChinese: /[\u4e00-\u9fa5]/.test(term.term_text),
        wordCount: term.term_text.split(/\s+/).length,
        isAcronym: isLikelyAcronym(term.term_text),
        domainId: term.domain_id,
        frequency: 1, // 暂时简单设为1，实际可以根据使用统计计算
      });
    });
  }
  
  return features;
}

/**
 * 判断是否为缩写
 */
function isLikelyAcronym(text: string): boolean {
  // 全大写字母，长度2-8
  if (/^[A-Z]{2,8}$/.test(text)) return true;
  
  // 包含数字和大写字母的组合
  if (/^[A-Z0-9]{3,10}$/.test(text)) return true;
  
  // 中英文混合的大写缩写
  if (/^[\u4e00-\u9fa5]{1,3}[A-Z]{1,5}$/.test(text)) return true;
  
  return false;
}

/**
 * 计算两个术语的相似度（简单的Jaccard相似度）
 */
function calculateSimilarity(term1: string, term2: string): number {
  const set1 = new Set(term1.toLowerCase().split(''));
  const set2 = new Set(term2.toLowerCase().split(''));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * 查找与现有术语相似的候选术语
 */
function findSimilarTerms(
  candidate: string,
  existingTerms: string[],
  threshold: number = 0.7
): { term: string; similarity: number }[] {
  const results: { term: string; similarity: number }[] = [];
  
  for (const existingTerm of existingTerms) {
    const similarity = calculateSimilarity(candidate, existingTerm);
    if (similarity >= threshold) {
      results.push({ term: existingTerm, similarity });
    }
  }
  
  // 按相似度降序排序
  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * 智能AI抽取 - 直接使用大模型进行术语识别
 */
export async function extractWithAI(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  console.log(`[Smart Extractor] AI extraction starting, text length: ${text.length}, language: ${language}`);
  
  // 生成缓存键
  const cacheKey = `ai-extraction:${language}:${strategy.mode}:${strategy.domainId || 'none'}:${text.length > 100 ? simpleHash(text.substring(0, 100)) : text}`;
  
  // 使用请求合并器防止重复请求
  return globalRequestMerger.mergeRequest(
    cacheKey,
    async () => {
      return await performAIExtraction(text, language, strategy);
    }
  );
}

/**
 * 实际执行AI抽取的内部函数
 */
async function performAIExtraction(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  // 准备现有术语库数据
  const existingTerms = getTerms({ pageSize: 1000 });
  const existingTermTexts = existingTerms.rows?.map((t: any) => t.term_text) || [];
  const domains = getDomains();
  
  // 构建专业的Prompt
  const domainInfo = strategy.domainId 
    ? domains.find((d: any) => d.id === strategy.domainId)
    : null;
  
  // 检测双语内容，让AI知道文本包含哪些语言
  const bilingualCheck = detectBilingualContent(text);
  const isBilingual = bilingualCheck.isBilingual;
  const detectedLangs = bilingualCheck.languages.map(l => `${l.lang}(${(l.ratio * 100).toFixed(0)}%)`).join(', ');
  
  const prompt = buildExtractionPrompt(
    text,
    language,
    existingTermTexts,
    domainInfo,
    strategy,
    isBilingual,
    detectedLangs
  );
  
  try {
    // 超过15000字符才进行分块
    const shouldChunk = text.length > 15000;
    let allAiTerms: ExtractedTerm[] = [];
    
    if (shouldChunk) {
      console.log(`[Smart Extractor] Large text detected (${text.length} chars), starting chunked processing`);
      
      const chunks = chunkTextForAI(text, 6000, language);
      console.log(`[Smart Extractor] Text split into ${chunks.length} chunks (chunk size: 6000 chars)`);
      
      const progressReporter = new ProgressReporter({
        channel: 'ai-extraction-progress',
        autoStart: false,
      });
      progressReporter.start('chunked-extraction', `AI智能抽取（${chunks.length}个分块）`);
      
      const CHUNK_TIMEOUT_MS = 90000;
      
      // 构建一次系统指令，各分块复用
      const systemInstruction = buildSystemInstruction(language, existingTermTexts, domainInfo, strategy, isBilingual, detectedLangs);
      
      const chunkPromises = chunks.map((chunk, i) => {
        console.log(`[Smart Extractor] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
        
        const chunkHash = simpleHash(chunk.substring(0, 200));
        const mergeKey = `chunk-extraction:${language}:${strategy.domainId || 'none'}:${chunkHash}`;
        
        const chunkAbortController = new AbortController();
        const chunkTimeoutId = setTimeout(() => {
          console.warn(`[Smart Extractor] Chunk ${i + 1} timed out after ${CHUNK_TIMEOUT_MS / 1000}s, aborting`);
          chunkAbortController.abort();
        }, CHUNK_TIMEOUT_MS);
        
        const progressPct = Math.round(((i) / chunks.length) * 100);
        progressReporter.update(progressPct, `正在处理第 ${i + 1}/${chunks.length} 个分块...`);
        
        return globalRequestMerger.mergeRequest(
          mergeKey,
          async () => {
            const chunkPrompt = buildChunkPrompt(chunk, systemInstruction);
            
            const chunkTerms = await callAITermExtraction(
              chunkPrompt, 
              strategy.aiConfig, 
              chunk, 
              language,
              chunkAbortController.signal
            );
            clearTimeout(chunkTimeoutId);
            console.log(`[Smart Extractor] Chunk ${i + 1} extracted ${chunkTerms.length} terms`);
            return chunkTerms;
          }
        ).catch(chunkError => {
          clearTimeout(chunkTimeoutId);
          console.error(`[Smart Extractor] Failed to process chunk ${i + 1}:`, chunkError);
          return [] as ExtractedTerm[];
        });
      });
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      for (let i = 0; i < chunkResults.length; i++) {
        const result = chunkResults[i];
        if (result.status === 'fulfilled') {
          const chunkTerms = result.value;
          allAiTerms = [...allAiTerms, ...chunkTerms];
        } else {
          console.warn(`[Smart Extractor] Chunk ${i + 1} failed: ${result.reason}`);
        }
        console.log(`[Smart Extractor] Progress: ${i + 1}/${chunks.length} chunks, total terms: ${allAiTerms.length}`);
      }
      
      const beforeDedup = allAiTerms.length;
      allAiTerms = smartDeduplicateTerms(allAiTerms);
      console.log(`[Smart Extractor] Deduplication: ${beforeDedup} -> ${allAiTerms.length} terms`);
      
      progressReporter.complete(`处理完成，共提取 ${allAiTerms.length} 个术语`);
    } else {
      // 小文本直接处理
      const aiTerms = await callAITermExtraction(prompt, strategy.aiConfig, text, language);
      allAiTerms = aiTerms;
    }
    
    // ========== AI增强模式与规则模式的噪声过滤 ==========
    // ★ ai-only 模式下也必须运行JSON字段名噪声过滤，否则字段名会泄露为术语
    // 但跳过其他规则噪声（如通用词过滤），保持AI自主筛选的完整性
    {
      const beforeNoiseFilter = allAiTerms.length;
      
      // 核心噪声过滤：永远运行（包括 ai-only），防止JSON字段名泄露
      allAiTerms = allAiTerms.filter(term => !isNoiseTerm(term.term_text));
      if (beforeNoiseFilter !== allAiTerms.length) {
        console.log(`[Smart Extractor] Noise filter removed ${beforeNoiseFilter - allAiTerms.length} terms (JSON field names, etc.)`);
      }
      
      // [新增] 附加过滤：检测AI误将字段名作为独立对象输出的情况
      // 当term_text本身就是一个JSON schema字段名时（如 "source_term", "target_lang" 等），直接排除
      const jsonFieldNames = new Set([
        'source_term', 'source_lang', 'target_term', 'target_lang',
        'translation_source', 'translation_confidence', 'source_confidence',
        'abbreviation_suggestion', 'abbreviation', 'term_text', 'score',
        'translation', 'source', 'target', 'name', 'word', 'text',
      ]);
      const beforeFieldNameFilter = allAiTerms.length;
      allAiTerms = allAiTerms.filter(term => {
        const cleaned = String(term.term_text || '').replace(/^["']+|["']+$/g, '').trim().toLowerCase();
        if (jsonFieldNames.has(cleaned)) {
          console.log(`[Smart Extractor] Filtered out JSON field name: "${term.term_text}"`);
          return false;
        }
        return true;
      });
      if (beforeFieldNameFilter !== allAiTerms.length) {
        console.log(`[Smart Extractor] Field name filter removed ${beforeFieldNameFilter - allAiTerms.length} terms`);
      }
      
      // [新增] 过滤source_confidence / translation_confidence等以数字为term_text的条目
      allAiTerms = allAiTerms.filter(term => {
        const text = String(term.term_text || '').trim();
        if (/^[\d.]+[,;\s]*$/.test(text)) {
          console.log(`[Smart Extractor] Filtered out numeric-only term: "${text}"`);
          return false;
        }
        return true;
      });
      
      if (strategy.mode !== 'ai-only') {
        // 非ai-only模式：额外运行概念首倡语言后处理
        allAiTerms = allAiTerms.map(term => postCheckSourceLanguage(term));
      }
    }
    
    // [已移除] 非"含中文"语对过滤 - 不再强制过滤，由用户自行筛选
    
    // 后处理：添加元数据
    const results: SmartExtractionResult[] = allAiTerms.map((term) => {
      const similarTerms = findSimilarTerms(
        term.term_text,
        existingTermTexts,
        strategy.similarityThreshold
      );
      
      const isExisting = similarTerms.length > 0;
      const confidence = term.score / 10;
      
      // [方案C] 使用重写后的评分模型
      const translationValue = calculateTranslationValueV2(term, language);
      
      return {
        ...term,
        confidence,
        isExistingTerm: isExisting,
        translationValue,
        domainMatch: strategy.domainId || undefined,
      };
    });
    
    console.log(`[Smart Extractor] AI extraction completed, found ${results.length} terms`);
    
    const finalResults = results.slice(0, strategy.maxResults || 300);
    
    return finalResults;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Smart Extractor] AI extraction failed:', errorMessage);
    
    if (errorMessage.includes('API Key未配置') || 
        errorMessage.includes('API配置不完整') ||
        errorMessage.includes('网络连接失败')) {
      throw new Error(`智能抽取失败: ${errorMessage}`);
    }
    
    console.warn('[Smart Extractor] AI extraction failed, returning empty results', error);
    return [];
  }
}

/**
 * ========== [方案A v2] 构建专业抽取Prompt（统一工作流版） ==========
 * 核心设计思路：
 * 1. 角色设定：为中文母语译者服务的多语术语抽取专家
 * 2. 文本类型前置分类：单一语种 / 主体语种+注释 / 双语对照 / 多语杂合
 * 3. 分类型抽取规则：单语文本仅抽术语原文（不编造译文）；对照文本抽原文+译文
 * 4. 双维度筛选：意义维度（语义完整、意群清晰）+ 价值维度（超出一般译者能力）
 * 5. 原文判断：根据概念首倡语言范畴确定原文，而非表面文本语言
 */
function buildExtractionPrompt(
  text: string,
  _language: string,
  existingTerms: string[],
  domainInfo: any,
  strategy: ExtractionStrategy,
  isBilingual: boolean = false,
  detectedLangs: string = ''
): string {
  const existingTermsSample = existingTerms.slice(0, 20).join(', ');
  const domainContext = domainInfo ? `领域：${domainInfo.name}（${domainInfo.description || '无描述'}）` : '通用领域';
  
  const bilingualHint = isBilingual 
    ? `\n【多语识别信息】检测到文本包含多种语言：${detectedLangs}。请先分析文本中的语言对和对照关系，再抽取术语。`
    : '';

  // [新增] 动态外文语种推断，用于指导AI输出正确的 target_lang
  const foreignLangHint = detectedLangs
    ? (() => {
        const frMatch = detectedLangs.match(/fr/i);
        const deMatch = detectedLangs.match(/de/i);
        const esMatch = detectedLangs.match(/es/i);
        const itMatch = detectedLangs.match(/it/i);
        const ptMatch = detectedLangs.match(/pt/i);
        const jaMatch = detectedLangs.match(/ja/i);
        const koMatch = detectedLangs.match(/ko/i);
        const ruMatch = detectedLangs.match(/ru/i);
        const arMatch = detectedLangs.match(/ar/i);
        const enMatch = detectedLangs.match(/en/i);
        if (frMatch) return 'fr（法语）';
        if (deMatch) return 'de（德语）';
        if (esMatch) return 'es（西班牙语）';
        if (itMatch) return 'it（意大利语）';
        if (ptMatch) return 'pt（葡萄牙语）';
        if (jaMatch) return 'ja（日语）';
        if (koMatch) return 'ko（韩语）';
        if (ruMatch) return 'ru（俄语）';
        if (arMatch) return 'ar（阿拉伯语）';
        if (enMatch) return 'en（英语）';
        return 'en（英语）';
      })()
    : 'en（英语）';

  // [修改] 所有模式下统一使用AI自主判断，不再提供机械的通用词剔除列表
  const valueFilterSection = strategy.mode === 'rules-only'
    ? `以下类型的内容即使符合"意义完整"也应当剔除（翻译价值低）：
1. 日常高频通用词：数据、使用、应用、系统、方法、方式、管理、发展、研究、建设、水平、工作、问题、情况、过程、条件、因素、结果、影响、关系、结构、时间、空间、资源、信息、知识、技术、服务、产品、用户、企业、公司、部门、项目、任务、要求、标准、规定、制度、政策、措施、方案、建议、意见、基本、主要、重要、相关、具体
2. 日常高频英文通用词：data, system, method, process, result, analysis, application, development, management, research, technology, service, product, project, information, solution, approach, requirement, standard, policy, strategy, framework`
    : `你需要自主判断每个候选词的术语价值，而非机械套用通用词列表。
请根据上下文、领域特性和专业深度来判断：该词是否具有不可替代的专业含义？是否超出一般水平译者能力？是否在特定领域有独特用法？
对于在专业语境下具有明确术语职能的词（即使表面看起来是"通用词"），也应保留并赋予高 scores。`;

  return `你是一位为中文母语译者服务的多语术语抽取专家。你的任务是：从下文文本中识别并抽取那些对中文母语译者真正有翻译价值的术语。

**检测到的外文语种：${foreignLangHint}**（中文术语的目标译文语言应优先使用此语种）

═══════════════════════════════════════════
【第〇步：格式预检（优先于文本类型分析）】
═══════════════════════════════════════════
在执行文本类型分析之前，先检查文本是否呈现"双语词汇表/术语对照列表"格式：
- 文本以编号（如 01./1./① / (1)）或项目符号（如 • / ● / － / ▸）开头
- 每行结构为：编号+中文+英文（或编号+英文+中文），中英文之间以空格或分隔符隔开
- 连续多行（≥5行）保持同一格式
 - 典型样例：
   "01. 计划生育 family planning"
   "• 可持续发展 — sustainable development"
   "● 社会主义核心价值观   Core Socialist Values"
   "1) data privacy 数据隐私"
 - ★重要：PDF提取可能损失空格，导致紧凑格式如：
   "1商标trademark"（数字+中文+英文连续无空格）
   "2注册商标registeredtrademark"
   这类格式仍然是双语词汇表，不要因缺少空格和分隔符而忽视。每行核心结构为"数字+中文术语+英文术语"。

 如果匹配上述格式，直接判定为「类型E - 双语词汇表」，跳过后续文本类型分析的优先级判断。
 如果输入文本完全不符合词汇表格式，则继续执行第一步的文本类型分析。

═══════════════════════════════════════════
【第一步：文本类型分析（强制执行）】
═══════════════════════════════════════════
在抽取任何术语之前，你必须先判断文本属于以下哪种类型，并在思维中明确：

类型A - 单一语种文本：
  文本通篇仅包含一种语言（如纯英文、纯中文、纯日文等）。
  → 抽取策略：仅抽取该语种的术语原文（source_term）。
  → target_term 和 target_lang 全部设为 null。
  → translation_source 设为 "none"。
  → 禁止为单语文本编造任何翻译。

类型B - 主体语种+其他语种注释/嵌套：
  文本以一种语言为主体，但零散嵌入了少量其他语言的单词、短语或注释。
  → ★关键区分·括号标注子类型：如果外文以括号标注形式紧跟在中文术语后面（如"相互性（mutuality）""争点排除（issue preclusion）"），则括号内外互为精准译文，必须识别并建立双向对译关系。每个括号对对应输出两个条目（zh→外文 + 外文→zh），target_term和target_lang均不可为null，translation_source="file"，translation_confidence=0.95~1.0。
  → 非括号标注：如果外文不是括号标注（如"这篇文章讲的是AI技术在legal translation中的应用"），则仅抽取主体语种术语原文，不为嵌入的外语词汇编造对译。

类型C - 双语或多语对照文本：
  文本以两种或多种语言对照形式呈现（如中英文对照的法律条文、逐段对照的技术文档）。
  → 抽取策略：识别语义对译关系，确定原文方向，返回原文+译文（target_term）。
  → 存在对译关系时：优先抽取与中文相关的语对。许可模式为 zh→X 或 X→zh。
  → 如果存在不含中文的语对（如 en↔ja 对照），也抽取这些语对的源语术语原文，但 target_term 仅在文本中有明确对译时才填写。

类型D - 多语杂合文本：
  文本中多种语言自由混合，没有明确的对照结构。
  → 抽取策略：分别按各语种抽取术语原文。仅在文本中明确出现对译表述时才填写 target_term。

类型E - 双语词汇表/术语对照列表（★新增）：
  文本以编号或符号列表形式呈现，每行包含"术语中文 + 术语英文"（或反过来）的一一对照。
  典型格式包括：
  "01. 中文术语 EnglishTerm"
  "• 中文术语 — English Term"
  "● 中文词汇   English Vocabulary"
  "1) English Term 中文术语"
  → 抽取策略：将每一行识别为一个独立的术语对，中文为 source_term（source_lang="zh"），英文为 target_term（target_lang="en"）。
  → 翻译来源 translation_source 设为 "file"（因为目标文本中确实存在对译）。
  → ★重要：词汇表中的所有条目都是经过筛选的专业术语，默认具有翻译价值。跳过【第三步·价值维度】的"低价值"过滤逻辑——即不对词汇表条目应用通用词剔除规则。
  → 如果某行只有单一语言（缺少对译），则仅抽取该语言术语，target_term 置为 null。

═══ 判断优先级：
1. 如果第〇步格式预检判定为词汇表格式 → 类型E（最高优先级，直接判定）
2. 如果全文仅有一种语言 → 类型A
3. 如果有主体语种（占70%以上字符）夹杂少量其他语言，且其他语言以括号标注形式出现 → 类型B（括号标注子类型），必须识别括号内外的对译关系
4. 如果有两种及以上语言以段落/句子级对照出现 → 类型C
5. 其他多语混合情况 → 类型D

═══════════════════════════════════════════
【第二步：抽取维度一·意义维度】
═══════════════════════════════════════════
抽取的术语必须是语义相对完整的词、词组或短语，意群切分要清晰、准确。
- 固定短语、复合词、专有名词、机构名、法律概念、专业术语必须整体抽取，禁止肢解。
- 禁止输出以"的""了""在""是""和""与""及""或""这""那""但""却""而""以""因""为""所""被""把""从""对""向"等虚词/介词/连词/助词开头的术语片段。
- 禁止输出以冠词/介词/连词/代词开头或结尾的英文片段（如 "the system", "of data", "terms from" 等）。
- 禁止输出语义不完整的滑动窗口式词组（如将连续4-5个普通单词强行拼接为"术语"）。
- 语义完整示例（通过）：「Artificial Intelligence」「Machine Learning」「不可抗力」「连带责任」「适当性原则」
- 语义碎片示例（拒绝）：「terms from file source」「identify and score these」「the purpose of this」「了传承中华优秀传统法律」

═══════════════════════════════════════════
【第三步：抽取维度二·价值维度】
═══════════════════════════════════════════
并非所有词、词组或短语都适合作为术语抽取。你需要筛选：真正有价值的术语，应当是超出一般水平译者能力的成分。

⚠ 类型E特殊豁免：如果当前文本被判定为「类型E - 双语词汇表」，则跳过下述剔除规则。
  词汇表中的所有条目都是经过筛选的专业术语，默认具有翻译价值，不应用通用词剔除。

${valueFilterSection}

以下类型的术语翻译价值高，应优先抽取：
1. 专业领域概念：法律术语（如"诉讼时效""管辖权异议""先予执行"）、医学术语（如"糖皮质激素""细胞凋亡"）、金融术语（如"量化宽松""信用违约互换"）
2. 文化负载词：具有中国特色且难以直接对译的概念（如"枫桥经验""一带一路""以人民为中心"）
3. 多义/歧义术语：在不同语境下译文不同，易错的术语
4. 新兴概念/专有名词：新造词、品牌名、专有技术名（如"新质生产力""生成式人工智能"）
5. 缩写与全称对照：机构名缩写（如"全国人大- NPC"）、专业缩写（如"MOU-谅解备忘录"）
6. 跨语言长难术语：需要转义才能准确翻译的复合结构

═══════════════════════════════════════════
【第四步：原文-译文方向判定规则（类型C 及 类型B括号标注子类型适用）】
═══════════════════════════════════════════
对于双语/多语对照文本（类型C）及主体语种+括号注释文本（类型B括号标注子类型），你必须根据"概念首倡语言"来判定 source_lang，而非根据文本表面的书写语言。
- 判断依据：该概念/术语最早是在哪个语言范畴中产生和定义的。
- 典型示例：
  ▶ "Artificial Intelligence" → source_lang = "en"，因为AI概念首先在英语世界提出和定义。
  ▶ "中华人民共和国" → source_lang = "zh"，因为这是中国国家名称，概念首倡于中文。
  ▶ "判例法" → source_lang = "en"（源于英国 common law 体系）
  ▶ "武士道" → source_lang = "ja"（源于日本文化）
  ▶ "区块链" → source_lang = "en"（blockchain，概念首先在英语世界提出）

- ★ 对于类型B括号标注子类型（如"相互性（mutuality）""争点排除（issue preclusion）"），每个括号对应生成两个条目：
  * 条目一：中文为 source_term（source_lang="zh"），括号内外文为 target_term（target_lang 为对应外文语种），translation_source="file"，translation_confidence=0.95~1.0
  * 条目二：外文为 source_term（source_lang 为对应外文语种），括号外中文为 target_term（target_lang="zh"），translation_source="file"，translation_confidence=0.95~1.0
- source_confidence 是你的判断把握度（0-1）。

═══════════════════════════════════════════
【第五步：多语识别与对照关系分析（类型C/D适用）】
═══════════════════════════════════════════
当文本包含两种及以上语言时：
1. 首先识别文本中出现了哪些语言，判断语言对组合
2. 分析各语言之间的对照关系：
   - 文内对照：同一术语在文本中以两种语言并列出现（如"人工智能（Artificial Intelligence）"），此时翻译来源为"file"
   - 跨语对照：文本以双语/多语交替呈现，术语在各语段中有明确对应，此时翻译来源为"file"
   - 单语推断：文本只有一种语言，此时翻译来源为"none"
3. 对于文内对照明确的术语，target_term 必须提取文本中实际出现的对译文本，不要自行编造

═══════════════════════════════════════════
【输出格式】
═══════════════════════════════════════════
严格按以下JSON数组格式输出，每个元素包含：
{
  "source_term": "源术语文本（必须是有专业价值的完整术语）",
  "source_lang": "zh|en|fr|ja|es|de|ru|ar|ko|it|pt",
  "target_term": "目标术语文本 或 null（类型A时全部为null；类型B括号标注子类型时括号内文本即为target_term，不可为null；非括号标注的类型B和类型C/D仅在存在对译关系时填写）",
  "target_lang": "zh|en|fr|ja|es|de|ru|ar|ko|it|pt 或 null",
  "translation_source": "file|none",
  "translation_confidence": 0.0-1.0,
  "source_confidence": 0.0-1.0,
  "abbreviation_suggestion": null
}
重要：abbreviation_suggestion 统一定为 null（不编造缩写）。

${domainContext}
${existingTermsSample ? `现有术语示例：${existingTermsSample} —— 如果候选术语与这些术语相似度超过70%，请标注为已有术语的变体或跳过。` : ''}${bilingualHint}

═══════════════════════════════════════════
【待抽取文本】
═══════════════════════════════════════════
${text}${text.length > 100000 ? `\n\n（输入文本共${text.length}字符，已截断至前100000字符。）` : ''}

只返回纯JSON数组，不要包含任何解释文字、markdown代码块标记或其他文本。

═══════════════════════════════════════════
【★重要兜底规则】
═══════════════════════════════════════════
即使你认为文本中没有明显的专业术语，也必须至少返回文本中出现的所有以下类型条目：
1. 专有名词（人名、地名、机构名、品牌名、项目名）
2. 带引号或特殊标记的词组
3. 任何被编号或列表化的条目
4. 所有缩写（含全大写字母组合）
5. 任何看起来像一个"概念"或"事物名称"的词组
6. 文本中出现的外语词汇（对中文母语者而言可能是陌生的外来语）
绝不返回空数组[]。如果确实无法识别任何术语，至少将文本中前3个最像术语的名词短语作为结果返回。

═══════════════════════════════════════════
【★关键禁止项——绝对不要输出以下内容作为术语】
═══════════════════════════════════════════
以下内容绝对禁止出现在 term_text 字段中：
1. 本 Prompt 中出现的 JSON Schema 字段名（如 "source_term"、"source_lang"、"target_term"、"target_lang"、"translation_source"、"translation_confidence"、"source_confidence"、"abbreviation_suggestion" 等）——这些仅是说明输出格式的元数据键名，不是术语内容
2. 任何编程语言关键字、代码标识符、配置项名称
3. 纯标点符号、纯数字、或长度不足 2 个字符的片段
4. 任何看起来像英文 JSON key 或 snake_case 标识符的文本（如 "source_lang"、"target_term"、"translation_confidence"）
5. 任何带引号包裹的字段名（如 '"source_lang"'、'"target_term"'）
如果你不确定某段文本是否是术语，请检查它是否在上述禁止列表中。如果是，必须排除，不要输出。`;
}

/**
 * 检测AI配置是否完备
 * 委托给 ai-client 的 validateAIConfig，确保验证逻辑一致
 */
export function checkAIConfig(aiConfig?: AIConfig): { 
  valid: boolean; 
  reason?: string; 
  fixHint?: string 
} {
  const validation = validateAIConfig(aiConfig || {});
  
  if (!validation.valid) {
    const fixHints: Record<string, string> = {
      'API Key未配置': '请在系统设置中填写有效的API Key',
      'API Key格式不正确': '请检查API Key是否正确，应以"sk-"或对应平台格式开头',
      '模型名称格式不正确': '支持模型名称（如 gpt-4, deepseek-chat, claude-3）或完整API端点URL',
    };
    
    return {
      valid: false,
      reason: validation.reason,
      fixHint: fixHints[validation.reason || ''] || '请检查系统设置中的AI配置'
    };
  }
  
  return { valid: true };
}

/**
 * 智能文本分块功能 - 处理大文件分块
 */
function chunkTextForAI(
  text: string,
  maxTokensPerChunk: number = 15000,
  language: 'en' | 'zh' | 'auto' = 'auto'
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  const tokensPerChar = language === 'zh' ? 2.0 : 1.0;
  const maxCharsPerChunk = Math.floor(maxTokensPerChunk / tokensPerChar);
  
  if (text.length <= maxCharsPerChunk) {
    return [text];
  }
  
  const chunks: string[] = [];
  const sentenceEnders = /[。！？.!?]\s*/g;
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharsPerChunk) {
      const sentences = paragraph.split(sentenceEnders).filter(s => s.trim().length > 0);
      
      for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        if (trimmedSentence.length === 0) continue;
        
        if (currentChunk.length + trimmedSentence.length > maxCharsPerChunk && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = trimmedSentence + '。';
        } else {
          currentChunk += (currentChunk.length > 0 ? ' ' : '') + trimmedSentence + '。';
        }
      }
    } else {
      if (currentChunk.length + paragraph.length > maxCharsPerChunk && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph;
      }
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  console.log(`[Text Chunking] Original text: ${text.length} chars, split into ${chunks.length} chunks`);
  chunks.forEach((chunk, i) => {
    console.log(`[Text Chunking] Chunk ${i + 1}: ${chunk.length} chars, preview: "${chunk.substring(0, 100)}..."`);
  });
  
  return chunks;
}

/**
 * 调用AI接口进行术语抽取 - 使用统一的aiFetch工具，支持超时、重试和多提供商
 */
async function callAITermExtraction(
  prompt: string,
  aiConfig?: AIConfig,
  _originalText?: string,
  _language: 'en' | 'zh' | 'auto' = 'auto',
  abortSignal?: AbortSignal
): Promise<ExtractedTerm[]> {
  const configCheck = checkAIConfig(aiConfig);
  if (!configCheck.valid) {
    throw new Error(`AI配置不完整: ${configCheck.reason}. ${configCheck.fixHint}`);
  }
  
  const { endpoint, model } = getFullEndpoint(aiConfig);
  const apiKey = aiConfig?.apiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('API Key未配置，无法调用AI服务');
  }
  
  console.log(`[AI Extraction] Using endpoint: ${endpoint}, model: ${model}`);
  
  try {
    const requestBody = buildAIBody(prompt, model, endpoint, {
      maxTokens: 4000,
      temperature: 0.1
    });
    
    console.log(`[AI Extraction] Sending request to AI API`);
    const response = await aiFetch(endpoint, apiKey, requestBody, {
      timeout: 60000,
      retries: 1,
      retryDelay: 1000,
      signal: abortSignal,
      retryOnTimeout: false,
    });
    
    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorText = await response.text();
        if (errorText) {
          errorDetail += `: ${errorText.substring(0, 200)}`;
        }
      } catch (e) {
        // 忽略解析错误
      }
      throw new Error(`AI API请求失败: ${errorDetail}`);
    }
    
    const data = await response.json();
    const content = extractContentFromResponse(data, endpoint);
    
    if (!content) {
      throw new Error('AI API返回空内容');
    }
    
    try {
      const parsed = APIResponseHandler.parseJsonResponse(content);
      
      if (!Array.isArray(parsed)) {
        throw new Error('AI响应不是有效的数组格式');
      }
      
      const terms = parsed.map((item: any) => {
        const sourceLang = String(item.source_lang || 'en');
        const targetLang = item.target_lang ? String(item.target_lang).trim() : undefined;
        const translationSource = item.translation_source ? String(item.translation_source).trim() : 'none';
        
        // ===== [修复] 单语文本处理：禁止自对译 =====
        // 如果 source_lang === target_lang，说明是单语文本，清空 target 字段
        let finalTargetTerm = item.target_term ? String(item.target_term).trim() : undefined;
        let finalTargetLang = targetLang;
        let finalTranslationSource = translationSource;
        
        if (targetLang && sourceLang === targetLang) {
          console.log(`[AI Extraction] Removing self-translation: "${finalTargetTerm}" (${sourceLang}→${targetLang})`);
          finalTargetTerm = undefined;
          finalTargetLang = undefined;
          finalTranslationSource = 'none';
        }
        
        // ===== [修复] 如果 translation_source 为 "none" 且无 target_term，确保 target 字段清空 =====
        if (finalTranslationSource === 'none' && !finalTargetTerm) {
          finalTargetLang = undefined;
        }
        
        // ===== [修复] 缩写合理性校验 =====
        // abbreviation_suggestion 应该为空（null）或者有实际意义的缩写
        // 如果缩写是源术语的首字母提取且长度 ≤ 5 且与源术语无构成关系，清除
        let finalAbbr = item.abbreviation_suggestion ? String(item.abbreviation_suggestion).trim() : undefined;
        
        // ===== [方案D] 字段名容错：兼容多种AI返回的字段名称 =====
        // AI可能返回不同的字段名（如 source/name 而非 source_term，translation 而非 target_term 等）
        const sourceText = String(
          item.source_term || item.term_text || item.source || item.term || item.name || item.word || item.text || ''
        ).trim();
        
        // 如果 target_term 未通过标准字段名获取到，尝试备用字段名
        if (!finalTargetTerm) {
          const altTarget = item.target_term || item.translation || item.target || item.target_text || item.translated || '';
          if (altTarget && String(altTarget).trim()) {
            finalTargetTerm = String(altTarget).trim();
            console.log(`[AI Extraction] Recovered target_term from alternate field: "${finalTargetTerm}" for "${sourceText}"`);
          }
        }
        
        // 如果 target_lang 未设置且 target_term 存在，推断目标语言
        if (!finalTargetLang && finalTargetTerm) {
          const zhInTarget = (finalTargetTerm.match(/[\u4e00-\u9fa5]/g) || []).length;
          finalTargetLang = zhInTarget >= 2 ? 'zh' : 'en';
          console.log(`[AI Extraction] Inferred target_lang="${finalTargetLang}" for target_term "${finalTargetTerm}"`);
        }
        
        if (finalAbbr && sourceText.length > 0) {
          const words = sourceText.split(/\s+/).filter((w: string) => w.length > 0);
          
          // 如果缩写看起来是首字母拼接且源术语短（≤2词），清除
          // 这可以过滤掉如 "terms from file source" → "TFFS" 这类无意义的缩写
          if (words.length <= 2 && finalAbbr.length >= 3 && sourceText.length <= 30) {
            console.log(`[AI Extraction] Removing likely meaningless abbreviation "${finalAbbr}" for short term "${sourceText}"`);
            finalAbbr = undefined;
          }
          
          // 另外，如果 source_term 是单个词且缩写是全大写，清除（单字母词用大写表现无意义）
          if (finalAbbr && words.length <= 1 && /^[A-Z]{2,}$/.test(finalAbbr)) {
            console.log(`[AI Extraction] Removing likely meaningless abbreviation "${finalAbbr}" for single-word term "${sourceText}"`);
            finalAbbr = undefined;
          }
        }
        
        return {
          term_text: sourceText,
          source_term: sourceText,
          source_lang: sourceLang,
          target_term: finalTargetTerm,
          target_lang: finalTargetLang,
          translation_source: finalTranslationSource,
          translation_confidence: item.translation_confidence !== undefined ? Number(item.translation_confidence) : undefined,
          abbreviation_suggestion: finalAbbr,
          score: 1,
        };
      }).filter((item: any) => {
        const hasValidTerm = item.source_term && item.source_term.length > 0;
        if (!hasValidTerm) {
          console.warn('过滤掉无效术语条目，字段:', { 
            source_term: item.source_term, 
            term_text: item.term_text,
            source_lang: item.source_lang 
          });
        }
        return hasValidTerm;
      });
      
      if (terms.length === 0) {
        const promptPreview = prompt ? prompt.substring(Math.max(0, prompt.indexOf('【待抽取文本】') + 30), Math.max(0, prompt.indexOf('【待抽取文本】') + 30) + 500).trim() : '(no prompt)';
        console.warn('解析后的术语列表为空，原始响应:', content.substring(0, 500));
        console.warn('提交文本预览（待抽取文本部分前500字符）:', promptPreview.replace(/\n/g, '\\n'));
        if (parsed.length > 0) {
          console.warn('第一个条目的字段:', Object.keys(parsed[0]));
          console.warn('第一个条目的值:', parsed[0]);
        }
      } else {
        console.log(`成功解析了 ${terms.length} 个术语`);
      }
      
      return terms;
      
    } catch (parseError) {
      console.error('解析AI响应失败:', parseError, '响应内容:', content.substring(0, 300));
      throw new Error(`解析AI抽取结果失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`网络连接失败: 请检查网络连接和API端点是否可达 (${endpoint})`);
      }
      throw error;
    }
    throw new Error(`AI调用失败: ${String(error)}`);
  }
}

/**
 * ========== [新增] 基于规则的术语抽取 ==========
 * 不使用AI，仅通过NLP启发式规则识别术语
 * 遵循"意义完整"和"价值筛选"两个维度
 */
function extractWithRules(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): SmartExtractionResult[] {
  console.log(`[Smart Extractor] Rules-only extraction starting, text length: ${text.length}`);
  const results: SmartExtractionResult[] = [];
  const seen = new Set<string>();
  
  const detectedLang = detectLanguageForRules(text, language);
  
  if (detectedLang === 'zh') {
    const quotedPatterns = [
      /[「『""]([^」』""\n]{2,30})[」』""]/g,
      /[《]([^》\n]{2,30})[》]/g,
    ];
    for (const pattern of quotedPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const term = match[1].trim();
        if (isValidChineseTerm(term, strategy) && !seen.has(term)) {
          seen.add(term);
          results.push(createRuleTerm(term, 'zh', 7));
        }
      }
    }
    
    const nounPhraseRegex = /[\u4e00-\u9fa5]{2,12}/g;
    const nounMatches = text.matchAll(nounPhraseRegex);
    for (const m of nounMatches) {
      const term = m[0];
      if (isValidChineseTerm(term, strategy) && !seen.has(term)) {
        seen.add(term);
        results.push(createRuleTerm(term, 'zh', 5));
      }
    }
    
    const mixedRegex = /[A-Za-z0-9\u4e00-\u9fa5]{3,20}/g;
    const mixedMatches = text.matchAll(mixedRegex);
    for (const m of mixedMatches) {
      const term = m[0];
      if (/[\u4e00-\u9fa5]/.test(term) && /[A-Za-z]/.test(term)) {
        if (!seen.has(term) && term.length >= strategy.minTermLength && term.length <= strategy.maxTermLength) {
          seen.add(term);
          results.push(createRuleTerm(term, 'zh', 6));
        }
      }
    }
  }
  
  if (detectedLang === 'en') {
    const properNounRegex = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,4})\b/g;
    let match;
    while ((match = properNounRegex.exec(text)) !== null) {
      const term = match[1].trim();
      if (isValidEnglishTerm(term, strategy) && !seen.has(term)) {
        seen.add(term);
        results.push(createRuleTerm(term, 'en', 7));
      }
    }
    
    const acronymRegex = /\b([A-Z]{2,8})\b/g;
    while ((match = acronymRegex.exec(text)) !== null) {
      const term = match[1];
      if (!seen.has(term) && term.length >= 2 && term.length <= 8) {
        seen.add(term);
        results.push(createRuleTerm(term, 'en', 8));
      }
    }
    
    const profSuffixes = ['tion', 'ment', 'ity', 'ness', 'ance', 'ence', 'ism', 'logy', 'graphy', 'metry', 'scope', 'ology', 'onomy', 'ics', 'sis'];
    const suffixPattern = new RegExp(`\\b([A-Za-z]+(?:${profSuffixes.join('|')})\\b)`, 'gi');
    while ((match = suffixPattern.exec(text)) !== null) {
      const term = match[1];
      if (/^[a-z]/.test(term)) continue;
      if (!seen.has(term) && term.length >= strategy.minTermLength && term.length <= strategy.maxTermLength) {
        seen.add(term);
        results.push(createRuleTerm(term, 'en', 6));
      }
    }
    
    const alphanumRegex = /\b([A-Za-z]+[-\d]+[A-Za-z]*)\b/g;
    while ((match = alphanumRegex.exec(text)) !== null) {
      const term = match[1];
      if (!seen.has(term) && term.length >= strategy.minTermLength && term.length <= strategy.maxTermLength) {
        seen.add(term);
        results.push(createRuleTerm(term, 'en', 7));
      }
    }
  }
  
  results.sort((a, b) => b.translationValue - a.translationValue);
  
  console.log(`[Smart Extractor] Rules-only extraction completed, ${results.length} terms`);
  return results.slice(0, strategy.maxResults || 300);
}

/**
 * 检测用于规则抽取的实际语言
 */
function detectLanguageForRules(text: string, declaredLang: 'en' | 'zh' | 'auto'): 'en' | 'zh' {
  if (declaredLang === 'en' || declaredLang === 'zh') return declaredLang;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && chineseChars / totalChars > 0.5 ? 'zh' : 'en';
}

/** 中文无效开头虚词集 */
const CHINESE_FUNCTION_STARTS = new Set([
  '的', '了', '在', '是', '和', '与', '及', '或', '这', '那', '但', '却', '而', '以', '因', '为',
  '所', '被', '把', '从', '对', '向', '到', '于', '由', '按', '据', '照', '凭', '让', '叫', '给', '替',
  '非', '不', '没', '都', '就', '也', '还', '又', '再', '才', '刚', '已', '将', '要', '能', '会', '可',
  '应', '该', '得', '着', '过', '等', '其', '每', '某', '各', '本', '此', '何', '怎', '哪', '什', '么',
  '上', '下', '中', '里', '外', '前', '后', '左', '右', '内', '旁', '边', '间',
]);

/** 中文高频低价值词（非专业术语） */
const CHINESE_LOW_VALUE_WORDS = new Set([
  '数据', '使用', '应用', '系统', '方法', '方式', '管理', '发展', '研究', '建设', '水平',
  '工作', '问题', '情况', '过程', '条件', '因素', '结果', '影响', '关系', '结构',
  '时间', '空间', '资源', '信息', '知识', '技术', '服务', '产品', '设备', '材料',
  '用户', '客户', '人员', '企业', '公司', '部门', '单位', '项目', '任务', '计划',
  '要求', '标准', '规范', '规定', '制度', '政策', '措施', '方案', '建议', '意见',
  '基本', '主要', '重要', '相关', '具体', '有效', '充分', '全面', '认真', '积极',
]);

/** 英文低价值高频词 */
const ENGLISH_LOW_VALUE_WORDS = new Set([
  'data', 'system', 'method', 'process', 'result', 'analysis', 'application', 'development',
  'management', 'research', 'technology', 'service', 'product', 'project', 'information',
  'solution', 'approach', 'requirement', 'standard', 'policy', 'strategy', 'framework',
  'component', 'feature', 'function', 'module', 'operation', 'performance', 'quality',
]);

function isValidChineseTerm(term: string, strategy: ExtractionStrategy): boolean {
  if (term.length < strategy.minTermLength || term.length > strategy.maxTermLength) return false;
  if (CHINESE_FUNCTION_STARTS.has(term[0])) return false;
  if (/^\d+$/.test(term)) return false;
  if (CHINESE_LOW_VALUE_WORDS.has(term)) return false;
  if (!/[\u4e00-\u9fa5]/.test(term)) return false;
  return true;
}

function isValidEnglishTerm(term: string, strategy: ExtractionStrategy): boolean {
  if (term.length < strategy.minTermLength || term.length > strategy.maxTermLength) return false;
  if (/^\d+$/.test(term)) return false;
  if (ENGLISH_LOW_VALUE_WORDS.has(term.toLowerCase())) return false;
  if (!/[A-Za-z]/.test(term)) return false;
  return true;
}

function createRuleTerm(term: string, lang: string, baseScore: number): SmartExtractionResult {
  return {
    term_text: term,
    score: baseScore,
    source_lang: lang,
    confidence: baseScore / 10,
    isExistingTerm: false,
    translationValue: baseScore,
  };
}

/**
 * 混合抽取策略：结合AI和规则
 * AI优先，AI失败或无结果时自动降级到规则抽取
 */
export async function extractWithHybrid(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  console.log(`[Smart Extractor] Hybrid extraction starting`);
  
  let aiResults: SmartExtractionResult[] = [];
  let aiSucceeded = false;
  try {
    aiResults = await extractWithAI(text, language, strategy);
    aiSucceeded = true;
  } catch (error) {
    console.warn('[Smart Extractor] AI extraction failed, falling back to rules', error);
  }
  
  if (aiSucceeded && aiResults.length === 0) {
    console.log('[Smart Extractor] AI returned 0 terms, falling back to rules-only extraction');
    return extractWithRules(text, language, strategy);
  }
  
  if (!aiSucceeded) {
    console.log('[Smart Extractor] AI call failed, using rules-only extraction');
    return extractWithRules(text, language, strategy);
  }
  
  // [修改] 移除置信度过滤和 translationValue 排序，保留AI自主判断的所有结果
  const filteredResults = aiResults.filter(term => {
    if (term.term_text.length < strategy.minTermLength) return false;
    if (term.term_text.length > strategy.maxTermLength) return false;
    // 不再过滤置信度，让AI的自主判断完全决定结果
    return true;
  });
  
  // 按AI返回的原始顺序 + 去重，不再依赖 translationValue 排序
  filteredResults.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`[Smart Extractor] Hybrid extraction completed, ${filteredResults.length} terms (AI: ${aiResults.length}, after filter: ${filteredResults.length})`);
  return filteredResults;
}

/**
 * 智能抽取主入口
 */
export async function smartExtractTerms(
  text: string,
  language: 'en' | 'zh' | 'auto',
  strategy: ExtractionStrategy = DEFAULT_STRATEGY
): Promise<SmartExtractionResult[]> {
  switch (strategy.mode) {
    case 'ai-only':
      return extractWithAI(text, language, strategy);
    case 'hybrid':
      return extractWithHybrid(text, language, strategy);
    case 'rules-only':
      return extractWithRules(text, language, strategy);
    default:
      return extractWithHybrid(text, language, strategy);
  }
}

/**
 * ========== [方案A] 构建大文本分块用系统指令（与 buildExtractionPrompt 内容对齐） ==========
 * 补全为与小文本路径同等质量的完整指令
 */
function buildSystemInstruction(
  _language: string,
  existingTerms: string[],
  domainInfo: any,
  _strategy: ExtractionStrategy,
  isBilingual: boolean = false,
  detectedLangs: string = ''
): string {
  const existingTermsSample = existingTerms.slice(0, 20).join(', ');
  const domainContext = domainInfo ? `领域：${domainInfo.name}（${domainInfo.description || '无描述'}）` : '通用领域';
  const bilingualHint = isBilingual 
    ? `\n【多语识别信息】检测到文本包含多种语言：${detectedLangs}。请先分析文本中的语言对和对照关系，再抽取术语。`
    : '';

  // [新增] 动态外文语种推断
  const foreignLangHint = detectedLangs
    ? (() => {
        const frMatch = detectedLangs.match(/fr/i);
        const deMatch = detectedLangs.match(/de/i);
        const esMatch = detectedLangs.match(/es/i);
        const itMatch = detectedLangs.match(/it/i);
        const ptMatch = detectedLangs.match(/pt/i);
        const jaMatch = detectedLangs.match(/ja/i);
        const koMatch = detectedLangs.match(/ko/i);
        const ruMatch = detectedLangs.match(/ru/i);
        const arMatch = detectedLangs.match(/ar/i);
        const enMatch = detectedLangs.match(/en/i);
        if (frMatch) return 'fr（法语）';
        if (deMatch) return 'de（德语）';
        if (esMatch) return 'es（西班牙语）';
        if (itMatch) return 'it（意大利语）';
        if (ptMatch) return 'pt（葡萄牙语）';
        if (jaMatch) return 'ja（日语）';
        if (koMatch) return 'ko（韩语）';
        if (ruMatch) return 'ru（俄语）';
        if (arMatch) return 'ar（阿拉伯语）';
        if (enMatch) return 'en（英语）';
        return 'en（英语）';
      })()
    : 'en（英语）';

  return `你是一位为中文母语译者服务的多语术语抽取专家。你的任务是：从下文文本中识别并抽取那些对中文母语译者真正有翻译价值的术语。

**检测到的外文语种：${foreignLangHint}**（中文术语的目标译文语言应优先使用此语种）

═══════════════════════════════════════════
【第〇步：格式预检（优先于文本类型分析）】
═══════════════════════════════════════════
在执行文本类型分析之前，先检查文本是否呈现"双语词汇表/术语对照列表"格式：
- 每行结构为：编号+中文+英文（或编号+英文+中文），中英文之间以空格或分隔符隔开
- 连续多行（≥5行）保持同一格式
 - 典型样例：
   "01. 计划生育 family planning"  /  "• 可持续发展 — sustainable development"
   "● 社会主义核心价值观   Core Socialist Values"  /  "1) data privacy 数据隐私"
 - ★重要：PDF提取可能损失空格，导致紧凑格式如：
   "1商标trademark"（数字+中文+英文连续无空格）
   "2注册商标registeredtrademark"
   这类格式仍然是双语词汇表，不要因缺少空格和分隔符而忽视。每行核心结构为"数字+中文术语+英文术语"。
 如果匹配上述格式，直接判定为「类型E - 双语词汇表」，跳过后续文本类型分析。

═══════════════════════════════════════════
【第一步：文本类型分析（强制执行）】
═══════════════════════════════════════════
在抽取任何术语之前，你必须先判断文本属于以下哪种类型：
类型A - 单一语种文本 → 仅抽取该语种术语原文，target_term=null，translation_source="none"
类型B - 主体语种+其他语种注释/嵌套 → 如果注释是括号标注格式（如"争点排除（issue preclusion）"），括号内外互为精准译文，必须建立双向对译关系，target_term和target_lang均不可为null；否则仅抽取主体语种术语原文
类型C - 双语或多语对照文本 → 识别对译关系，返回原文+译文
类型D - 多语杂合文本 → 分别按各语种抽取术语原文，仅在明确对译时填写target_term
类型E - 双语词汇表/术语对照列表 → 每行识别为一个术语对，中文→source_term，英文→target_term
  → translation_source 设为 "file"
  → ★词汇表条目默认具有翻译价值，跳过低价值通用词剔除规则

═══ 判断优先级：
1. 格式预检判定为词汇表格式 → 类型E（最高优先级）
2. 全文仅一种语言 → 类型A
3. 主体语种（≥70%字符）夹杂少量其他语言，且其他语言以括号标注形式出现 → 类型B（括号标注子类型），必须识别括号内外的对译关系
4. 两种及以上语言段落/句子级对照 → 类型C
5. 其他 → 类型D

═══════════════════════════════════════════
【第二步：意义维度】
═══════════════════════════════════════════
抽取语义完整的专业术语，禁止虚词/冠词/介词开头的片段。
禁止输出语义不完整的滑动窗口式词组。
正确：「Artificial Intelligence」「Machine Learning」「不可抗力」
错误：「terms from file source」「identify and score these」

═══════════════════════════════════════════
【第三步：价值维度 · AI自主判断】
═══════════════════════════════════════════
你拥有完全的自主判断权。根据你的语言知识和领域认知，从文本中抽取你认为有意义、值得翻译的词或短语。
不要机械套用任何"通用词剔除列表"。如果某个词在上下文中具有不可替代的专业含义，即使它表面看起来是通用词汇，也应保留。
优先关注：专业领域概念、文化负载词、制度性概念、具有歧义性或翻译难点的词、缩写与全称对照。
★ 术语首次出现时附有括号外文标注 → 翻译价值极高，必须建立完整的双向对译关系。

═══════════════════════════════════════════
【第四步：原文-译文方向判定（类型C 及 类型B括号标注子类型）】
═══════════════════════════════════════════
根据"概念首倡语言"判定source_lang，而非表面书写语言。
★ 对于括号标注文本（如"相互性（mutuality）"），每个括号对对应输出两个条目（zh→外文 + 外文→zh），translation_source 设为 "file"，translation_confidence 设为 0.95-1.0。

═══════════════════════════════════════════
【输出格式】
═══════════════════════════════════════════
严格JSON数组格式：
{
  "source_term": "源术语文本",
  "source_lang": "zh|en|fr|ja|es|de|ru|ar|ko|it|pt",
"target_term": "目标术语 或 null（类型A时全部为null；类型B括号标注子类型时括号内文本即为target_term，不可为null；类型C/D/E仅在存在对译时填写）",
  "target_lang": "zh|en|fr|ja|es|de|ru|ar|ko|it|pt 或 null",
  "translation_source": "file|none",
  "translation_confidence": 0.0-1.0,
  "source_confidence": 0.0-1.0,
  "abbreviation_suggestion": null
}
abbreviation_suggestion 统一定为 null（不编造缩写）。

${domainContext}
${existingTermsSample ? `现有术语示例：${existingTermsSample}` : ''}${bilingualHint}

只返回纯JSON数组，不要包含任何解释文字。`;
}

/**
 * 构建分块级Prompt（精简版）
 * 只包含系统指令和当前分块的文本内容
 */
function buildChunkPrompt(
  chunk: string,
  systemInstruction: string
): string {
  return `${systemInstruction}

文本内容：
${chunk}`;
}

/**
 * 智能去重 - 基于术语文本的相似度去重
 */
function smartDeduplicateTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
  if (terms.length <= 1) return terms;
  
  const uniqueTerms: ExtractedTerm[] = [];
  const SIMILARITY_THRESHOLD = 0.85;
  
  for (const term of terms) {
    let isDuplicate = false;
    
    for (const existing of uniqueTerms) {
      if (term.term_text.toLowerCase() === existing.term_text.toLowerCase()) {
        existing.score = Math.max(existing.score, term.score);
        isDuplicate = true;
        break;
      }
      
      const longer = term.term_text.length >= existing.term_text.length ? term.term_text : existing.term_text;
      const shorter = term.term_text.length < existing.term_text.length ? term.term_text : existing.term_text;
      if (longer.toLowerCase().includes(shorter.toLowerCase()) && shorter.length >= 3) {
        if (term.term_text.length > existing.term_text.length) {
          existing.term_text = term.term_text;
          existing.score = Math.max(existing.score, term.score);
        } else {
          existing.score = Math.max(existing.score, term.score);
        }
        isDuplicate = true;
        break;
      }
      
      const similarity = calculateSimilarity(term.term_text, existing.term_text);
      if (similarity >= SIMILARITY_THRESHOLD) {
        if (term.term_text.length > existing.term_text.length) {
          existing.term_text = term.term_text;
          existing.score = Math.max(existing.score, term.score);
        } else {
          existing.score = Math.max(existing.score, term.score);
        }
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueTerms.push({ ...term });
    }
  }
  
  return uniqueTerms;
}

// ═══════════════════════════════════════════
// [方案B] 概念首倡语言后处理校验
// ═══════════════════════════════════════════

/**
 * 概念-语言归属规则库
 * 
 * 基于已知的概念-语言归属规则对AI输出的source_lang进行纠偏。
 * 分为两类：
 * 1. 硬规则（高置信度修正）：已知中国特有概念/机构，强制修正为 zh→target_lang
 * 2. 软规则（低置信度修正）：根据术语文字特征和领域知识做辅助判断
 */
const CONCEPT_ORIGIN_RULES: {
  pattern: RegExp;
  correctSourceLang: string;
  description: string;
  confidence: number;
}[] = [
  // ===== 硬规则：中国特有概念（confidence >= 0.95）=====
  { pattern: /中华人民共和国|中国人民解放军|中国人民|中华民族|中国共产|全国人大|全国政协|国务院|最高人民法院|最高人民检察院|中央军委|中央人民政府|国家主席|国务院总理|省级行政区|直辖市|特别行政区|自治区|自治州|自治县/, correctSourceLang: 'zh', description: '中国国家机构/行政区划', confidence: 0.98 },
  { pattern: /社会主义|共产主义|马克思主义|列宁主义|毛泽东思想|邓小平理论|三个代表|科学发展观|新时代中国特色社会主义|中国梦|两个一百年|四个全面|五位一体|四个自信|两个维护|两个确立|中国式现代化/, correctSourceLang: 'zh', description: '中国政治概念', confidence: 0.98 },
  { pattern: /改革开放|一国两制|一带一路|人类命运共同体|共同富裕|精准扶贫|乡村振兴|美丽中国|健康中国|数字中国|法治中国|平安中国|文化强国|教育强国|科技强国|人才强国|体育强国|网络强国|质量强国/, correctSourceLang: 'zh', description: '中国国家战略/政策概念', confidence: 0.98 },
  { pattern: /枫桥经验|鞍钢宪法|大庆精神|红旗渠|焦裕禄|雷锋精神|大寨|华西村|小岗村|深圳特区|浦东新区|长三角|珠三角|京津冀|粤港澳大湾区|长江经济带|黄河流域/, correctSourceLang: 'zh', description: '中国特色经验/地名概念', confidence: 0.97 },
  { pattern: /中医|中药|针灸|推拿|气功|太极拳|武术|功夫|风水|阴阳|五行|八卦|道教|儒家|法家|墨家|兵家|纵横家|农家|医家/, correctSourceLang: 'zh', description: '中国传统文化/哲学/医学概念', confidence: 0.97 },
  { pattern: /儒释道|道法自然|天人合一|内圣外王|知行合一|中庸之道|格物致知|修身齐家治国平天下|大同|小康/, correctSourceLang: 'zh', description: '中国哲学/思想概念', confidence: 0.98 },
  { pattern: /户口|户籍|身份证|社会保障卡|居住证|暂住证|港澳通行证|台湾通行证/, correctSourceLang: 'zh', description: '中国证件/制度概念', confidence: 0.95 },
  { pattern: /高考|中考|公务员考试|国考|省考|事业编|教师资格证|四六级|考研|专升本/, correctSourceLang: 'zh', description: '中国教育/考试制度概念', confidence: 0.95 },
  { pattern: /自贸区|保税区|高新区|开发区|新区|经开区|综合保税区|跨境电子商务综合试验区/, correctSourceLang: 'zh', description: '中国经济区划概念', confidence: 0.96 },
  { pattern: /双循环|供给侧改革|新质生产力|数字经济|平台经济|共享经济|零工经济|银发经济|低空经济|首发经济|冰雪经济|夜间经济/, correctSourceLang: 'zh', description: '中国新兴经济概念', confidence: 0.95 },
  { pattern: /新农合|五险一金|住房公积金|医保|社保|养老保险|失业保险|工伤保险|生育保险/, correctSourceLang: 'zh', description: '中国社会保障概念', confidence: 0.96 },
  { pattern: /法律援助|人民调解|司法所|公证处|仲裁委员会|劳动仲裁|行政复议|行政诉讼|公益诉讼|检察建议|司法建议/, correctSourceLang: 'zh', description: '中国司法/行政制度概念', confidence: 0.96 },
  { pattern: /中华优秀传统|革命文化|社会主义先进文化|红色文化|非物质文化遗产|世界文化遗产|国家级非遗|省级非遗/, correctSourceLang: 'zh', description: '中国文化概念', confidence: 0.97 },
  
  // ===== 软规则：日本/韩国特有概念 =====
  { pattern: /武士道|茶道|花道|书道|柔道|空手道|剑道|弓道|合气道|相扑|能乐|歌舞伎|浮世绘|漫画|动漫|御宅|和服|榻榻米|寿司|天妇罗|刺身|怀石料理/, correctSourceLang: 'ja', description: '日本特有文化概念', confidence: 0.96 },
  { pattern: /财阀|跆拳道|韩国料理|韩流|K-pop|韩剧/, correctSourceLang: 'ko', description: '韩国特有文化概念', confidence: 0.95 },
  
  // ===== 软规则：法律体系起源相关 =====
  { pattern: /判例法|普通法|衡平法|信托|令状|陪审团|遵循先例/, correctSourceLang: 'en', description: '英美法系特有概念', confidence: 0.92 },
  { pattern: /民法典|行政法|刑法典|成文法|大陆法系|罗马法/, correctSourceLang: 'en', description: '大陆法系（源于欧洲）概念', confidence: 0.85 },
  
  // ===== 软规则：技术/科学概念起源 =====
  { pattern: /区块链|人工智能|机器学习|深度学习|神经网络|大语言模型|生成式AI|量子计算|云计算|物联网|5G|6G/, correctSourceLang: 'en', description: '现代科技概念（源于英语世界）', confidence: 0.90 },
  { pattern: /比特币|以太坊|智能合约|DeFi|NFT|Web3|元宇宙|DAO/, correctSourceLang: 'en', description: '加密货币/Web3概念（源于英语世界）', confidence: 0.92 },
  { pattern: /GDP|CPI|PPI|PMI|IPO|M&A|PE|VC|LP|GP/, correctSourceLang: 'en', description: '金融术语缩写（源于英语世界）', confidence: 0.90 },
];

/**
 * 对AI输出的单个术语进行概念首倡语言后处理校验
 * 
 * 如果发现source_lang错判（如将"中华人民共和国"的source_lang判为en），
 * 基于硬/软规则库进行修正，并同步调整target_lang。
 */
function postCheckSourceLanguage(term: ExtractedTerm): ExtractedTerm {
  if (!term.term_text || !term.source_lang) {
    return term;
  }
  
  const termText = String(term.term_text);
  const currentSourceLang = String(term.source_lang).toLowerCase();
  
  for (const rule of CONCEPT_ORIGIN_RULES) {
    if (rule.pattern.test(termText)) {
      // 如果AI的判定与规则不一致，且规则置信度高于阈值，则进行修正
      if (currentSourceLang !== rule.correctSourceLang && rule.confidence >= 0.85) {
        console.log(
          `[SourceLang PostCheck] Corrected: "${termText}" source_lang ${currentSourceLang} → ${rule.correctSourceLang} (rule: ${rule.description}, confidence: ${rule.confidence})`
        );
        
        const corrected: ExtractedTerm = {
          ...term,
          source_lang: rule.correctSourceLang as ExtractedTerm['source_lang'],
        };
        
        // 如果修正后需要调整 target_lang（避免 source_lang === target_lang）
        if (term.target_lang) {
          const targetLang = String(term.target_lang).toLowerCase();
          if (rule.correctSourceLang === targetLang) {
            // 检测术语文字的实际语种来推断合理的target_lang
            const termLang = detectTermLanguage(termText);
            if (termLang && termLang !== targetLang) {
              corrected.target_lang = termLang as ExtractedTerm['target_lang'];
              console.log(`[SourceLang PostCheck] Also corrected target_lang: ${targetLang} → ${termLang} for "${termText}"`);
            } else {
              // 默认为中英互译
              corrected.target_lang = (rule.correctSourceLang === 'zh' ? 'en' : 'zh') as ExtractedTerm['target_lang'];
              console.log(`[SourceLang PostCheck] Inferred target_lang for "${termText}": ${corrected.target_lang}`);
            }
          }
        }
        
        return corrected;
      }
      
      // 如果AI判断与规则一致且规则置信度高，记录确认日志
      if (currentSourceLang === rule.correctSourceLang && rule.confidence >= 0.9) {
        console.log(
          `[SourceLang PostCheck] Confirmed: "${termText}" source_lang=${currentSourceLang} matches rule "${rule.description}"`
        );
      }
      
      break;
    }
  }
  
  return term;
}

// ═══════════════════════════════════════════
// [方案C] 重写翻译价值评分模型
// ═══════════════════════════════════════════

/**
 * 根据术语文字检测实际语种
 * 用于后处理阶段确认术语所使用的主要语言文字
 */
function detectTermLanguage(termText: string): string | null {
  const hasChinese = /[\u4e00-\u9fa5]/.test(termText);
  const hasEnglish = /[a-zA-Z]{2,}/.test(termText);
  const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(termText);
  const hasKorean = /[\uac00-\ud7af]/.test(termText);
  const hasRussian = /[\u0400-\u04ff]/.test(termText);
  const hasArabic = /[\u0600-\u06ff]/.test(termText);
  
  if (hasChinese && !hasEnglish && !hasJapanese && !hasKorean) return 'zh';
  if (hasEnglish && !hasChinese && !hasJapanese && !hasKorean) return 'en';
  if (hasJapanese && !hasChinese) return 'ja';
  if (hasKorean && !hasChinese) return 'ko';
  if (hasRussian) return 'ru';
  if (hasArabic) return 'ar';
  
  // 中英混合时默认归为中文源
  if (hasChinese && hasEnglish) return 'zh';
  
  return null;
}

/**
 * [方案C] 重写翻译价值评分模型
 * 
 * 新模型基于两个核心维度：
 * 1. 意义完整度（0-5分）：术语是否是语义完整的词/词组/短语
 * 2. 价值门槛（0-5分）：该术语是否超出一般译者能力水平
 * 
 * 最终得分 = (意义完整度 × 0.5 + 价值门槛 × 0.5) × 2，映射到 0-10 分
 */
function calculateTranslationValueV2(
  term: ExtractedTerm,
  _language: string
): number {
  const termText = String(term.term_text || '');
  const targetTerm = term.target_term ? String(term.target_term) : '';
  const sourceLang = term.source_lang ? String(term.source_lang) : 'en';
  const targetLang = term.target_lang ? String(term.target_lang) : '';
  
  // 尝试获取AI返回的source_confidence
  const sourceConfidence = (term as any).source_confidence !== undefined 
    ? Number((term as any).source_confidence) 
    : 0.6;
  
  // ===== 维度一：意义完整度（0-5分）=====
  let semanticScore = 2.5;  // 基准分
  
  // 长度适中（4-25字）加分
  if (termText.length >= 4 && termText.length <= 25) semanticScore += 0.5;
  if (termText.length >= 25 && termText.length <= 50) semanticScore += 0.3;
  if (termText.length > 50) semanticScore -= 0.5;  // 过长可能是句子片段
  
  // 中文术语：不以虚词开头加分
  if (sourceLang === 'zh' || /[\u4e00-\u9fa5]{2,}/.test(termText)) {
    if (!/^[的了在是和与及或这那但却而以因为所被把从对向到于由按据照凭让叫给替非不没都就也还又再才刚已将要能会可应得过着等其每某各本此何怎哪什么]/.test(termText)) {
      semanticScore += 0.5;
    } else {
      semanticScore -= 1.5;  // 虚词开头严重扣分
    }
    
    // 包含多个汉字加分
    if (/[\u4e00-\u9fa5]{2,}/.test(termText)) {
      semanticScore += 0.3;
    }
  }
  
  // 英文术语：含专业后缀加分
  if (sourceLang === 'en' || /^[A-Za-z]/.test(termText)) {
    const profSuffixes = ['tion', 'ment', 'ity', 'ness', 'ance', 'ence', 'ism', 'logy', 'graphy', 'metry', 'scope', 'ology', 'onomy', 'ics', 'sis'];
    for (const suffix of profSuffixes) {
      if (termText.toLowerCase().endsWith(suffix)) {
        semanticScore += 0.3;
        break;
      }
    }
  }
  
  // 中英混合术语加分（往往是专有名词）
  if (/[\u4e00-\u9fa5]/.test(termText) && /[A-Za-z]/.test(termText)) {
    semanticScore += 0.4;
  }
  
  // 太短的术语减分（1-2字的中文词往往是普通词）
  if (termText.length <= 2) semanticScore -= 1.0;
  if (/^[a-z]{1,3}$/.test(termText)) semanticScore -= 1.5;
  
  // ===== 维度二：价值门槛（0-5分）=====
  let valueScore = 2.5;  // 基准分
  
  // 领域特征加分
  if (/(法|条例|规定|办法|细则|规程|规范|标准|准则|原则|制度|规则|决定|决议|命令|通知|公告|通告|通报|报告|请示|批复|函|纪要)/.test(termText)) {
    valueScore += 0.6;  // 法律/行政术语
  }
  if (/(病|症|药|手术|治疗|诊断|病理|细胞|基因|免疫|神经|血管|肿瘤|炎症|感染)/.test(termText)) {
    valueScore += 0.6;  // 医学术语
  }
  if (/(金融|证券|股票|基金|债券|期货|期权|保险|银行|信贷|利率|汇率|通胀|通缩|货币|财政|税收|预算|决算)/.test(termText)) {
    valueScore += 0.6;  // 金融术语
  }
  if (/(算法|模型|架构|框架|协议|接口|引擎|平台|系统|网络|数据库|服务器|客户端|前端|后端|编译|部署|测试)/.test(termText)) {
    valueScore += 0.5;  // 技术术语
  }
  
  // 中国文化特色加分
  if (/(中国|中华|华夏|炎黄|神州|九州|龙|凤|长城|故宫|颐和园|兵马俑|丝绸之路)/.test(termText)) {
    valueScore += 0.7;
  }
  
  // 全大写缩写加分
  if (/^[A-Z]{2,8}$/.test(termText)) {
    valueScore += 0.8;
  }
  
  // 含数字的术语（如"Type 2 diabetes"、"十四五"）加分
  if (/\d+/.test(termText) && /[\u4e00-\u9fa5]/.test(termText)) {
    valueScore += 0.3;
  }
  
  // AI置信度高的术语加分
  if (sourceConfidence >= 0.8) {
    valueScore += 0.3;
  }
  
  // 文件提取的翻译比AI生成的更可靠
  if (term.translation_source === 'file' && targetTerm.length > 0) {
    valueScore += 0.5;
  }
  
  // [移除] 所有扣分规则已移除 - AI自主判断术语价值，不再做规则性扣分
  
  // 基础价值保底：即使是简单词也获得至少 2.5 分的基础价值
  valueScore = Math.max(2.5, valueScore);
  
  // 综合计算最终得分：两个维度各占50%，映射到0-10
  let finalScore = (semanticScore * 0.5 + valueScore * 0.5) * 2;
  finalScore = Math.max(0, Math.min(10, finalScore));
  
  return Math.round(finalScore * 10) / 10;
}