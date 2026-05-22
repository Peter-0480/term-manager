// 数据库模块 - 使用内存数据库（临时替代SQLite）
// 注意：此为临时解决方案，避免native模块编译问题
// 生产环境应安装Visual Studio并重新构建better-sqlite3

import * as memoryDB from './database-memory';

// 保持API完全兼容
export function initDatabase(dataPath?: string) {
  return memoryDB.initDatabase(dataPath);
}

export function getDatabase() {
  return memoryDB.getDatabase();
}

export function getExtractionJobs() {
  return memoryDB.getExtractionJobs();
}

export function getSettings() {
  return memoryDB.getSettings();
}

export function setSettings(settings: any) {
  return memoryDB.setSettings(settings);
}

export function addExtractionJob(job: {
  source_type: string;
  source_path?: string;
  language: string;
  item_count: number;
  note?: string;
}) {
  return memoryDB.addExtractionJob(job);
}

export function deleteExtractionJob(id: number) {
  return memoryDB.deleteExtractionJob(id);
}

// DAO: Terms
export function getTerms(params?: {
  page?: number;
  pageSize?: number;
  domain?: number;
  keyword?: string;
  sourceLang?: string;
  targetLang?: string;
  // 新增高级搜索参数
  locked?: boolean;
  hasTranslation?: boolean;
  favorite?: boolean;
  hasAbbreviation?: boolean | null;
  domains?: number[];
  sourceLangs?: string[];
  targetLangs?: string[];
  translationLanguages?: string[];
  translationStatus?: 'all' | 'has' | 'none';
  // 排序参数
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  return memoryDB.getTerms(params);
}

export function getTermById(id: number) {
  return memoryDB.getTermById(id);
}

export function addTerm(term: {
  source_lang: string;
  term_text: string;
  target_lang?: string;
  target_text?: string;
  domain_id?: number;
  description?: string;
  abbreviation?: string;
  translations?: Array<{
    language_code: string;
    text: string;
    confidence?: number;
    source?: string;
  }>;
}) {
  return memoryDB.addTerm(term);
}

export function updateTerm(
  id: number,
  updates: Partial<{
    term_text: string;
    target_text: string;
    abbreviation: string;
    description: string;
    domain_id: number;
    locked?: boolean;
    favorite?: boolean;
    translations?: Array<{
      language_code: string;
      text: string;
      confidence?: number;
      source?: string;
    }>;
  }>
) {
  return memoryDB.updateTerm(id, updates);
}

export function deleteTerm(id: number) {
  return memoryDB.deleteTerm(id);
}

// DAO: Domains
export function getDomains() {
  return memoryDB.getDomains();
}

export function getDomainTermCounts() {
  return memoryDB.getDomainTermCounts();
}

export function addDomain(domain: { name: string; parent_id?: number; description?: string }) {
  return memoryDB.addDomain(domain);
}

export function updateDomain(id: number, updates: { name?: string; parent_id?: number; description?: string }) {
  return memoryDB.updateDomain(id, updates);
}

export function deleteDomain(id: number) {
  return memoryDB.deleteDomain(id);
}

export function batchUpdateTermDomains(termIds: number[], domainId: number | null) {
  return memoryDB.batchUpdateTermDomains(termIds, domainId);
}

// DAO: Term Relations
export function addTermRelation(relation: {
  term_id: number;
  relation_type: string;
  related_term_id: number;
  note?: string;
}) {
  return memoryDB.addTermRelation(relation);
}

export function getTermRelations(termId: number) {
  return memoryDB.getTermRelations(termId);
}

export function getTermRelationById(id: number) {
  return memoryDB.getTermRelationById(id);
}

export function deleteTermRelation(id: number) {
  return memoryDB.deleteTermRelation(id);
}

export function deleteTermRelationByPair(term_id: number, relation_type: string, related_term_id: number) {
  return memoryDB.deleteTermRelationByPair(term_id, relation_type, related_term_id);
}

// DAO: Term Sources
export function addTermSource(source: {
  term_id: number;
  source_type: string;
  source_detail?: string;
  credibility_score?: number;
}) {
  return memoryDB.addTermSource(source);
}

export function getTermSources(termId: number) {
  return memoryDB.getTermSources(termId);
}

// 额外的SQLite特有功能（可选导出）
export function backupDatabase(backupPath?: string) {
  return memoryDB.backupDatabase(backupPath);
}

export function vacuumDatabase() {
  return memoryDB.vacuumDatabase();
}

export function exportToJson(outputPath: string) {
  return memoryDB.exportToJson(outputPath);
}

// ================== 多语言方法导出 ==================

export function addTranslation(translation: {
  term_id: number;
  language_code: string;
  text: string;
  confidence?: number;
  source?: string;
}) {
  return memoryDB.addTranslation(translation);
}

export function getTranslations(termId: number, languageCode?: string) {
  return memoryDB.getTranslations(termId, languageCode);
}

export function updateTranslation(id: number, updates: {
  text?: string;
  confidence?: number;
  source?: string;
}) {
  return memoryDB.updateTranslation(id, updates);
}

export function deleteTranslation(id: number) {
  return memoryDB.deleteTranslation(id);
}

export function getLanguages() {
  return memoryDB.getLanguages();
}

export function addLanguage(language: {
  code: string;
  name: string;
  native_name: string;
  direction: 'ltr' | 'rtl';
  enabled: boolean;
}) {
  return memoryDB.addLanguage(language);
}

export function getLanguagePairs() {
  return memoryDB.getLanguagePairs();
}

export function addLanguagePair(pair: {
  source_lang: string;
  target_lang: string;
  enabled: boolean;
  priority: number;
}) {
  return memoryDB.addLanguagePair(pair);
}

// 语言和语言对管理
export function deleteLanguage(code: string) {
  return memoryDB.deleteLanguage(code);
}

export function updateLanguagePair(id: number, updates: { source_lang?: string; target_lang?: string; enabled?: boolean; priority?: number }) {
  return memoryDB.updateLanguagePair(id, updates);
}

export function deleteLanguagePair(id: number) {
  return memoryDB.deleteLanguagePair(id);
}

// 术语锁定功能
export function lockTerm(id: number) {
  return memoryDB.lockTerm(id);
}

export function unlockTerm(id: number) {
  return memoryDB.unlockTerm(id);
}

export function batchLockTerms(termIds: number[]) {
  return memoryDB.batchLockTerms(termIds);
}

export function batchUnlockTerms(termIds: number[]) {
  return memoryDB.batchUnlockTerms(termIds);
}

// 新增：获取或创建层级分类路径
export function getOrCreateDomainPath(path: string): number {
  return memoryDB.getOrCreateDomainPath(path);
}

// 新增：根据名称查找领域ID（支持精确匹配和模糊匹配）
export function findDomainIdByName(name: string, parentId?: number): number | null {
  return memoryDB.findDomainIdByName(name, parentId);
}

// AI翻译建议功能
export async function getAITranslationSuggestion(termId: number, targetLang: string): Promise<any> {
  return memoryDB.getAITranslationSuggestion(termId, targetLang);
}

export async function batchGetAITranslationSuggestions(termIds: number[], targetLang: string): Promise<any[]> {
  return memoryDB.batchGetAITranslationSuggestions(termIds, targetLang);
}

// AI补全建议功能
export async function getAITermSuggestion(request: {
  termId: number;
  termText: string;
  sourceLang: string;
  targetLang?: string;
  hasTranslation: boolean;
  hasDomain: boolean;
}): Promise<any> {
  return memoryDB.getAITermSuggestion(request);
}

