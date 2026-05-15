import { getTerms } from './database';

export interface ConsistencyIssue {
  source_lang: string;
  term_text: string;
  translations: string[];
  type: 'multi_translation' | 'duplicate_term' | 'reverse_conflict' | 'spelling_variation';
}

function normalizeText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
export function checkConsistency(domainId?: number): ConsistencyIssue[] {
  const queryResult = getTerms({ domain: domainId, page: 1, pageSize: 10000 });
  const terms = Array.isArray(queryResult.rows) ? queryResult.rows : [];

  const grouped: Record<string, Set<string>> = {};
  terms.forEach((term) => {
    if (!term.source_lang || !term.term_text) return;
    const key = `${term.source_lang}::${term.term_text.trim().toLowerCase()}`;
    // 暂时注释掉多语言检查，因为target_text字段已被移除
    // const target = (term.target_text || '').trim();
    // if (target) {
    //   if (!grouped[key]) grouped[key] = new Set();
    //   grouped[key].add(target);
    // }
  });

  const issues: ConsistencyIssue[] = [];
  Object.entries(grouped).forEach(([key, translations]) => {
    if (translations.size > 1) {
      const [source_lang, term_text] = key.split('::');
      issues.push({
        source_lang,
        term_text,
        translations: Array.from(translations),
        type: 'multi_translation'
      });
    }
  });

  // spelling variation detection (same source_lang, similar term_text)
  const sourceMap: Record<string, Set<string>> = {};
  terms.forEach((term) => {
    if (!term.source_lang || !term.term_text) return;
    const key = `${term.source_lang}`;
    sourceMap[key] = sourceMap[key] || new Set();
    sourceMap[key].add(term.term_text.trim());
  });

  Object.entries(sourceMap).forEach(([source_lang, termSet]) => {
    const list = Array.from(termSet);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const na = normalizeText(a);
        const nb = normalizeText(b);
        if (!na || !nb || na === nb) continue;
        const dist = levenshtein(na, nb);
        if (dist <= 2) {
          issues.push({
            source_lang,
            term_text: `${a} ↔ ${b}`,
            translations: [a, b],
            type: 'spelling_variation'
          });
        }
      }
    }
  });

  // reverse conflict: one translation对应多个源术语（在多语言系统中暂时禁用）
  // const reverseMap: Record<string, Set<string>> = {};
  // terms.forEach((term) => {
  //   const target = (term.target_text || '').trim();
  //   if (!term.source_lang || !term.term_text || !target) return;
  //   const key = `${term.source_lang}::${target}`;
  //   reverseMap[key] = reverseMap[key] || new Set();
  //   reverseMap[key].add(term.term_text.trim());
  // });
  // Object.entries(reverseMap).forEach(([key, sources]) => {
  //   if (sources.size > 1) {
  //     const [source_lang, target] = key.split('::');
  //     issues.push({
  //       source_lang,
  //       term_text: target,
  //       translations: Array.from(sources),
  //       type: 'reverse_conflict'
  //     });
  //   }
  // });

  return issues;
}
