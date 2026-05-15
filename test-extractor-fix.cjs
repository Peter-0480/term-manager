/**
 * 测试修复后的 extractHtmlContent 是否能正确从微信公众号提取内容
 */
const { extractHtmlContent } = require('./_test_extractor.cjs');
const fs = require('fs');

const html = fs.readFileSync('weixin_sample.html', 'utf-8');
console.log('[1] HTML loaded:', html.length, 'bytes');

const result = extractHtmlContent(html);
console.log('[2] hasContent:', result.hasContent);
console.log('[3] text length:', result.text.length);
console.log('[4] First 800 chars:');
console.log(result.text.substring(0, 800));
console.log('---');
console.log('[5] Line count:', result.text.split('\n').length);
console.log('[6] First 10 lines:');
result.text.split('\n').slice(0, 10).forEach((l, i) => console.log(`    ${i+1}: ${l}`));