/**
 * 测试编号词汇列表检测和解析
 */
const fs = require('fs');

const html = fs.readFileSync('weixin_sample.html', 'utf-8');
console.log('[1] HTML loaded:', html.length, 'bytes');

// 使用修复后的 extractHtmlContent
const { extractHtmlContent } = require('./_test_extractor.cjs');
const result = extractHtmlContent(html);
console.log('[2] hasContent:', result.hasContent);
console.log('[3] text length:', result.text.length);

const text = result.text;

// 测试 detectNumberedVocabList (从 index.ts 复制)
function detectNumberedVocabList(text) {
  if (!text || text.length < 100) return false;
  const numberedPattern = /\b\d{1,3}\.\s*[\u4e00-\u9fa5]+\s+[A-Za-z]/g;
  const matches = text.match(numberedPattern);
  if (!matches || matches.length < 3) return false;
  const zhChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  return zhChars > 50 && enChars > 50 && zhChars > enChars * 0.3;
}

console.log('[4] detectNumberedVocabList:', detectNumberedVocabList(text));

// 测试 parseNumberedVocabList (从 index.ts 复制)
function parseNumberedVocabList(text) {
  if (!text || text.length < 20) return null;
  // 注意：原版正则使用 \s+ 匹配中文和英文之间的空白，但实际文本中可能需要更宽松的匹配
  const entryPattern = /(\d{1,3})\.\s*([\u4e00-\u9fa5（）()、，]+)\s+([A-Za-z][A-Za-z0-9\s\-',;\(\)\.]*?)(?=\s*\d{1,3}\.\s*[\u4e00-\u9fa5]|$)/g;
  
  const entries = [];
  let match;
  let lastIndex = 0;
  
  while ((match = entryPattern.exec(text)) !== null) {
    const chineseTerm = match[2].trim();
    const englishTranslation = match[3].trim();
    
    console.log(`  [DEBUG] Match: "${chineseTerm}" -> "${englishTranslation}"`);
    
    if (chineseTerm.length >= 2 && chineseTerm.length <= 30 && englishTranslation.length >= 1) {
      entries.push(`${chineseTerm}\t${englishTranslation}`);
    }
    lastIndex = match.index + match[0].length;
  }
  
  console.log(`[5] Entries found: ${entries.length}`);
  if (entries.length > 0) {
    console.log(`[6] First 5 entries:`);
    entries.slice(0, 5).forEach((e, i) => console.log(`    ${i+1}: ${e}`));
  }
  
  if (entries.length < 2) return null;
  return entries.join('\n');
}

const parsed = parseNumberedVocabList(text);
console.log('[7] Parsed:', parsed ? `${parsed.split('\n').length} entries` : 'null');

// 也测试直接按行提取的模式
console.log('\n[8] First 30 lines of text:');
text.split('\n').slice(0, 30).forEach((l, i) => console.log(`    ${i+1}: "${l.trim()}"`));