// 多语言类型定义
// 支持术语的多语言翻译管理

export interface Language {
  code: string;           // 语言代码，如 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'
  name: string;          // 语言名称，如 'English', '中文', '日本語'
  native_name: string;   // 本地语言名称，如 'English', '中文', '日本語'
  direction: 'ltr' | 'rtl'; // 文本方向
  enabled: boolean;      // 是否启用
  is_mother_tongue?: boolean; // 是否为母语（中文），默认为false
  priority?: number;     // 显示优先级，默认为0
}

// 系统语言配置
export interface SystemLanguageConfig {
  mother_tongue: string;  // 母语代码（固定为'zh'）
  foreign_languages: string[]; // 外文语言代码列表
  all_languages: string[]; // 所有支持的语言代码
}

export interface Translation {
  id?: number;
  term_id: number;       // 所属术语ID
  language_code: string; // 语言代码
  text: string;          // 翻译文本
  confidence?: number;   // 置信度（0-100），用于自动翻译的质量评估
  source?: string;       // 来源：'manual', 'ai', 'import', 'alignment'
  created_at?: string;
  updated_at?: string;
}

export interface TermMultilingual {
  id: number;
  source_lang: string;   // 源语言代码
  term_text: string;     // 源术语文本
  abbreviation?: string; // 缩写
  domain_id?: number;    // 领域ID
  description?: string;  // 描述
  translations: Translation[]; // 所有翻译
  created_at: string;
  updated_at: string;
}

// 语言对配置
export interface LanguagePair {
  source_lang: string;
  target_lang: string;
  enabled: boolean;
  priority: number; // 优先级，0最高
}

// AI翻译请求
export interface TranslationRequest {
  text: string;
  source_lang: string;
  target_lang: string;
  context?: string;      // 上下文信息
  domain_id?: number;    // 领域ID，用于领域特定的翻译
}

// AI翻译响应
export interface TranslationResponse {
  text: string;
  confidence: number;
  alternatives?: string[]; // 备选翻译
  explanation?: string;    // 翻译解释
}

// 语言检测结果
export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternatives?: Array<{language: string, confidence: number}>;
}

// 术语对齐结果
export interface TermAlignmentResult {
  source_term: string;
  target_term: string;
  source_lang: string;
  target_lang: string;
  similarity: number;     // 相似度分数 0-1
  alignment_type: 'exact' | 'partial' | 'fuzzy' | 'contextual';
}