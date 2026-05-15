/**
 * 测试优化后的编号词汇列表检测和解析正则
 */
const fs = require('fs');
const { extractHtmlContent } = require('./_test_extractor.cjs');

const html = fs.readFileSync('weixin_sample.html', 'utf-8');
const result = extractHtmlContent(html);
const text = result.text;

console.log('[1] Text length:', text.length);

// ============ 改进后的 detectNumberedVocabList ============
function detectNumberedVocabList(text) {
  if (!text || text.length < 100) return false;
  // [修复] \s+ → \s* 允许中英文间无空格
  const numberedPattern = /\b\d{1,3}\.\s*[\u4e00-\u9fa5]+\s*[A-Za-z]/g;
  const matches = text.match(numberedPattern);
  if (!matches || matches.length < 3) return false;
  const zhChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  return zhChars > 50 && enChars > 50 && zhChars > enChars * 0.3;
}
console.log('[2] detectNumberedVocabList (fixed):', detectNumberedVocabList(text));

// ============ 改进后的 parseNumberedVocabList ============
function parseNumberedVocabList(text) {
  if (!text || text.length < 20) return null;
  
  // [修复] \s+ → \s* 允许中英文间无空格
  // [修复] 中文术语字符类增加 " 引号支持，如 "走出去"(战略) 
  // [修复] 英文翻译字符类增加 " 引号支持，如 the "211 Project"
  const entryPattern = /(\d{1,3})\.\s*([\u4e00-\u9fa5（）()、，""\u201c\u201d\u300c\u300d]+)\s*([A-Za-z][A-Za-z0-9\s\-',;\(\)\."\u201c\u201d]*?)(?=\s*\d{1,3}\.\s*[\u4e00-\u9fa5]|$)/g;
  
  const entries = [];
  let match;
  
  while ((match = entryPattern.exec(text)) !== null) {
    const chineseTerm = match[2].trim();
    const englishTranslation = match[3].trim();
    
    if (chineseTerm.length >= 2 && chineseTerm.length <= 30 && englishTranslation.length >= 1) {
      entries.push(`${chineseTerm}\t${englishTranslation}`);
    }
  }
  
  console.log(`[3] Entries parsed: ${entries.length}`);
  if (entries.length < 2) return null;
  return entries.join('\n');
}

const parsed = parseNumberedVocabList(text);
console.log('[4] Parsed result:', parsed ? `${parsed.split('\n').length} entries` : 'null');

if (parsed) {
  console.log('\n[5] Sample entries:');
  parsed.split('\n').forEach((e, i) => {
    if (i < 20) {
      const [zh, en] = e.split('\t');
      console.log(`    ${i+1}. [${zh}] → [${en.substring(0, 60)}]`);
    }
  });
}