/**
 * 语言工具模块
 * 集中管理所有语言常量、语言对校验、翻译方向判定
 * 母语：中文（zh）
 * 10种外语：英法德俄日西韩意葡阿拉伯
 */

// ==================== 语言常量 ====================

/** 母语代码 */
export const MOTHER_TONGUE = 'zh';

/** 10种外语代码列表 */
export const FOREIGN_LANGUAGES = [
  'en', 'fr', 'de', 'ru', 'ja', 'es', 'ko', 'it', 'pt', 'ar'
] as const;

/** 全部11种语言代码 */
export const ALL_LANGUAGE_CODES = [MOTHER_TONGUE, ...FOREIGN_LANGUAGES] as const;

/** 语言显示信息 */
export const LANGUAGE_INFO: Record<string, { label: string; native: string; direction: 'ltr' | 'rtl' }> = {
  zh: { label: '中文', native: '中文', direction: 'ltr' },
  en: { label: '英文', native: 'English', direction: 'ltr' },
  fr: { label: '法文', native: 'Français', direction: 'ltr' },
  de: { label: '德文', native: 'Deutsch', direction: 'ltr' },
  ru: { label: '俄文', native: 'Русский', direction: 'ltr' },
  ja: { label: '日文', native: '日本語', direction: 'ltr' },
  es: { label: '西班牙文', native: 'Español', direction: 'ltr' },
  ko: { label: '韩文', native: '한국어', direction: 'ltr' },
  it: { label: '意大利文', native: 'Italiano', direction: 'ltr' },
  pt: { label: '葡萄牙文', native: 'Português', direction: 'ltr' },
  ar: { label: '阿拉伯文', native: 'العربية', direction: 'rtl' },
};

/** 语言emoji标记 */
export const LANGUAGE_EMOJI: Record<string, string> = {
  zh: '🇨🇳',
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  ru: '🇷🇺',
  ja: '🇯🇵',
  es: '🇪🇸',
  ko: '🇰🇷',
  it: '🇮🇹',
  pt: '🇵🇹',
  ar: '🇸🇦',
};

// ==================== 翻译方向类型 ====================

/** 翻译方向枚举 */
export type TranslationDirection = 'zh_to_foreign' | 'foreign_to_zh';

/** 翻译方向信息 */
export const DIRECTION_INFO: Record<TranslationDirection, { label: string; shortLabel: string }> = {
  zh_to_foreign: { label: '中译外', shortLabel: '中→外' },
  foreign_to_zh: { label: '外译中', shortLabel: '外→中' },
};

// ==================== 核心校验函数 ====================

/**
 * 判断是否为外文
 */
export function isForeignLanguage(lang: string): boolean {
  return lang !== MOTHER_TONGUE && FOREIGN_LANGUAGES.includes(lang as any);
}

/**
 * 判断是否为有效语言代码
 */
export function isValidLanguage(lang: string): boolean {
  return ALL_LANGUAGE_CODES.includes(lang as any);
}

/**
 * 判断语言对是否合法
 * 规则：必须涉及中文，且非同语互译
 */
export function isValidLanguagePair(source: string, target: string): boolean {
  if (source === target) return false;           // 同语互译禁止
  if (source === MOTHER_TONGUE || target === MOTHER_TONGUE) return true; // 必须涉及中文
  return false; // 外译外禁止
}

/**
 * 根据源语言获取合法的目标语言列表
 * - 源语言为中文 → 返回10种外文
 * - 源语言为外文 → 只返回中文
 */
export function getSupportedTargetLanguages(sourceLang: string): string[] {
  if (sourceLang === MOTHER_TONGUE) {
    return [...FOREIGN_LANGUAGES];
  }
  return [MOTHER_TONGUE];
}

/**
 * 自动推导翻译方向
 */
export function determineTranslationDirection(source: string, target: string): TranslationDirection | null {
  if (!isValidLanguagePair(source, target)) return null;
  return source === MOTHER_TONGUE ? 'zh_to_foreign' : 'foreign_to_zh';
}

/**
 * 根据源语言获取默认目标语言
 * - 中文 → 英文（默认）
 * - 外文 → 中文
 */
export function getDefaultTargetLang(sourceLang: string): string {
  if (sourceLang === MOTHER_TONGUE) {
    return 'en';
  }
  return MOTHER_TONGUE;
}

/**
 * 获取语言对的显示标签
 * 例如：zh→en → "中译英"，en→zh → "英译中"
 */
export function getLanguagePairLabel(source: string, target: string): string {
  if (!isValidLanguagePair(source, target)) return '无效语言对';
  
  const sourceLabel = LANGUAGE_INFO[source]?.label || source;
  const targetLabel = LANGUAGE_INFO[target]?.label || target;
  
  if (source === MOTHER_TONGUE) {
    return `中译${targetLabel}`;
  }
  return `${sourceLabel}译中`;
}

/**
 * 获取语言对的短标签
 * 例如：zh→en → "中→英"，en→zh → "英→中"
 */
export function getLanguagePairShortLabel(source: string, target: string): string {
  if (!isValidLanguagePair(source, target)) return '无效';
  
  const sourceEmoji = LANGUAGE_EMOJI[source] || source;
  const targetEmoji = LANGUAGE_EMOJI[target] || target;
  
  return `${sourceEmoji}→${targetEmoji}`;
}

/**
 * 获取语言的选择器选项列表
 * @param filterFn 可选过滤函数
 */
export function getLanguageSelectOptions(filterFn?: (code: string) => boolean) {
  const codes = filterFn ? ALL_LANGUAGE_CODES.filter(c => filterFn(c)) : ALL_LANGUAGE_CODES;
  return codes.map(code => ({
    label: `${LANGUAGE_EMOJI[code] || ''} ${LANGUAGE_INFO[code]?.label || code}`,
    value: code,
  }));
}

/**
 * 获取目标语言的选择器选项列表（根据源语言过滤）
 */
export function getTargetLanguageSelectOptions(sourceLang: string) {
  const targetLangs = getSupportedTargetLanguages(sourceLang);
  return targetLangs.map(code => ({
    label: `${LANGUAGE_EMOJI[code] || ''} ${LANGUAGE_INFO[code]?.label || code} (${LANGUAGE_INFO[code]?.native || code})`,
    value: code,
  }));
}
