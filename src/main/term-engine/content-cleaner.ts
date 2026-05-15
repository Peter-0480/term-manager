/**
 * 内容清洗模块
 * 负责文本预处理：去噪、清洗、规范化
 * 从 index.ts 中拆分出来，独立的文本清洗逻辑
 */

// ═══════════════════════════════════════════
// 常用中文专业术语前缀
// ═══════════════════════════════════════════

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

const CHINESE_TERM_PREFIXES = [
  '反', '非', '超', '跨', '多', '双', '单', '微', '宏', '亚', '准', '伪',
  '本', '前', '后', '总', '副', '主', '次', '零', '全', '半', '子',
  '再', '可', '自', '互', '共', '联', '分', '合',
  '软', '硬', '轻', '重', '高', '低', '大', '小', '新', '旧', '老',
  '无', '有', '去', '复', '增', '减',
];

// ═══════════════════════════════════════════
// 中文文本预处理
// ═══════════════════════════════════════════

/**
 * 中文规则抽取前文本预处理：移除URL、邮箱、电话号码等英文噪声
 * 防止这些HTML残余干扰语言检测和抽取质量
 */
export function preprocessChineseText(text: string): string {
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
    // 如果行内中文字符少于3个，且英文占比>70%，丢弃
    const chineseChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (chineseChars < 3 && englishChars > trimmed.length * 0.7) return false;
    return true;
  });
  cleaned = filteredLines.join('\n');

  // 合并连续的空白和空行
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

// ═══════════════════════════════════════════
// 通用网页文本清洗
// ═══════════════════════════════════════════

/**
 * 清洗网页提取文本：去HTML、去脚本、去样式、规范化
 * 同时保护连字符术语不被破坏
 */
export function cleanWebText(text: string): string {
  if (!text || text.length < 10) return text;

  // Step 0: 保护连字符术语（如 "AI-powered", "state-of-the-art"）
  const hyphenatedTerms: string[] = [];
  const hyphenMarkers: Record<string, string> = {};
  const hyphenRegex = /\b[a-zA-Z]+(?:-[a-zA-Z]+)+\b/g;
  let match: RegExpExecArray | null;
  while ((match = hyphenRegex.exec(text)) !== null) {
    const term = match[0];
    if (term.replace(/-/g, '').length >= 6) {
      // 只保护有意义的复合词（不含连字符的字母数≥6）
      hyphenatedTerms.push(term);
    }
  }
  hyphenatedTerms.forEach((term, index) => {
    const marker = `__HYPHEN_${index}__`;
    hyphenMarkers[marker] = term;
    text = text.replace(term, marker);
  });

  // 移除HTML标签
  text = text.replace(/<[^>]*>/g, ' ');

  // 移除JavaScript代码块
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // 移除HTML实体
  text = text.replace(/&[a-z]+;/gi, ' ');
  text = text.replace(/&#\d+;/g, ' ');
  text = text.replace(/&#x[0-9a-f]+;/gi, ' ');

  // 移除CSS样式
  text = text.replace(/[a-z-]+:\s*[^;]+;/gi, ' ');

  // 移除URL
  text = text.replace(/https?:\/\/\S+/gi, ' ');

  // 移除邮箱
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ' ');

  // 规范化空白
  text = text.replace(/[\r\n\t]+/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  // 还原被保护的连字符术语
  text = text
    .split(/(\s+)/)
    .map(token => {
      if (token.startsWith('__HYPHEN_') && token.endsWith('__') && hyphenMarkers[token]) {
        return hyphenMarkers[token];
      }
      return token;
    })
    .join('');

  // 安全清理：过滤掉任何残留的HYPHEN标记
  text = text.replace(/__HYPHEN_\d+__/gi, '');

  return text.trim();
}

// ═══════════════════════════════════════════
// 文本质量检查
// ═══════════════════════════════════════════

/**
 * 检查文本是否足够进行术语抽取
 */
export function isTextExtractable(text: string, minLength: number = 100): boolean {
  if (!text || text.length < minLength) return false;

  // 检查中文字符数量
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  // 中文内容至少50个中文字符，或英文内容至少30个单词
  return chineseChars >= 50 || englishWords >= 30;
}

/**
 * 估计文本中的术语数量（粗略估计，用于判断是否值得抽取）
 */
export function estimateTermCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  // 粗略估计：中文每100字符约含2-5个术语，英文每100词约含3-8个术语
  const chineseEstimate = Math.floor(chineseChars / 100) * 3;
  const englishEstimate = Math.floor(englishWords / 100) * 5;

  return chineseEstimate + englishEstimate;
}

// ═══════════════════════════════════════════
// 导出（供 rule-extractor 使用）
// ═══════════════════════════════════════════

export { CHINESE_TERM_SUFFIXES, CHINESE_TERM_PREFIXES };