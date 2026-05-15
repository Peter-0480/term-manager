/**
 * 术语抽取引擎 - 统一类型定义
 * 集中管理所有抽取相关的接口和类型
 */

// ═══════════════════════════════════════════
// 基础术语类型
// ═══════════════════════════════════════════

export interface ExtractedTerm {
  /** 术语正文（必须） */
  term_text: string;
  /** 术语质量评分 0-10 */
  score: number;
  /** 术语的源语言（必须） */
  source_lang: string;

  // AI增强字段（可选）
  /** 目标语言译文（仅在对照文本中确凿存在时填入） */
  target_term?: string;
  /** 目标语言 */
  target_lang?: string;
  /** 翻译来源 */
  translation_source?: string;
  /** 翻译置信度 0-1 */
  translation_confidence?: number;
  /** 缩写建议：默认 null，禁止AI编造 */
  abbreviation_suggestion?: string;
}

// ═══════════════════════════════════════════
// AI 配置类型
// ═══════════════════════════════════════════

export interface AIConfig {
  provider: string;
  apiKey: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}

// ═══════════════════════════════════════════
// 抽取策略类型
// ═══════════════════════════════════════════

export type ExtractionMode = 'ai-only' | 'hybrid' | 'rules-only';

export interface ExtractionStrategy {
  /** 抽取模式 */
  mode: ExtractionMode;
  /** 是否使用现有术语库辅助 */
  useExistingTerms: boolean;
  /** 与现有术语的相似度阈值 (0-1) */
  similarityThreshold: number;
  /** AI配置 */
  aiConfig?: AIConfig;
  /** 术语最小长度 */
  minTermLength: number;
  /** 术语最大长度（词数） */
  maxTermLength: number;
  /** 单次抽取结果上限 */
  maxResults: number;
  /** 领域ID（可选） */
  domainId?: number;
  /** 是否启用领域自适应 */
  adaptToDomain: boolean;
}

export const DEFAULT_STRATEGY: ExtractionStrategy = {
  mode: 'hybrid',
  useExistingTerms: true,
  similarityThreshold: 0.7,
  minTermLength: 2,
  maxTermLength: 20,
  maxResults: 300,
  adaptToDomain: true,
};

// ═══════════════════════════════════════════
// 术语特征（用于术语库分析）
// ═══════════════════════════════════════════

export interface TermFeature {
  text: string;
  length: number;
  containsNumbers: boolean;
  containsSpecialChars: boolean;
  containsEnglish: boolean;
  containsChinese: boolean;
  wordCount: number;
  isAcronym: boolean;
  domainId?: number;
  frequency?: number;
}

// ═══════════════════════════════════════════
// 智能抽取结果（扩展基础术语）
// ═══════════════════════════════════════════

export interface SmartExtractionResult extends ExtractedTerm {
  /** AI置信度 0-1 */
  confidence: number;
  /** 是否已存在于术语库 */
  isExistingTerm: boolean;
  /** 领域匹配度 */
  domainMatch?: number;
  /** 翻译价值评分 0-10 */
  translationValue: number;
}

// ═══════════════════════════════════════════
// 双语对齐类型
// ═══════════════════════════════════════════

export interface AlignedTermPair {
  sourceTerm: string;
  targetTerm: string;
  score: number;
}

// ═══════════════════════════════════════════
// 语言检测结果
// ═══════════════════════════════════════════

export interface LanguageDetectionResult {
  /** 检测到的主要语言 */
  primaryLanguage: string;
  /** 检测到的所有语言 */
  detectedLanguages: string[];
  /** 是否为双语/多语内容 */
  isBilingual: boolean;
  /** 各语言占比 (语言 -> 百分比 0-1) */
  languageRatios: Record<string, number>;
}

// ═══════════════════════════════════════════
// 文本类型分类结果
// ═══════════════════════════════════════════

export type TextType =
  | 'monolingual'       // 单语文本
  | 'bilingual_parallel' // 双语对照（逐段/逐句对照）
  | 'glossary'           // 词汇表/术语表
  | 'mixed'              // 主体语种夹外语注释
  | 'unknown';           // 无法判断

export interface TextClassificationResult {
  textType: TextType;
  confidence: number;
  sourceLangs: string[];
  targetLangs: string[];
}

// ═══════════════════════════════════════════
// 进度报告类型
// ═══════════════════════════════════════════

export interface ProgressReporter {
  updateStage: (stage: string, progress: number, message: string) => void;
}

// ═══════════════════════════════════════════
// AI 抽取请求类型
// ═══════════════════════════════════════════

export interface AIExtractionRequest {
  text: string;
  language: 'en' | 'zh' | 'auto';
  aiConfig?: AIConfig;
  abortSignal?: AbortSignal;
}

export interface AIChunkExtractionRequest extends AIExtractionRequest {
  chunkIndex: number;
  totalChunks: number;
}

// ═══════════════════════════════════════════
// AI 学习/偏好类型
// ═══════════════════════════════════════════

export interface UserFeedback {
  termId?: number;
  termText: string;
  sourceLang: string;
  action: 'accepted' | 'rejected';
  extractionSource: string; // 'ai' | 'rule' | 'manual'
  timestamp: string;
}

export interface UserPreference {
  /** 用户偏好的术语长度范围 */
  preferredTermLength: { min: number; max: number };
  /** 用户偏好的源语言 */
  preferredSourceLangs: string[];
  /** 常见的拒绝模式 */
  rejectionPatterns: string[];
  /** 偏好权重调整因子 */
  scoreAdjustmentFactor: number;
}