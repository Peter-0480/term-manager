// Renderer context uses preloaded API through window.termManager
declare global {
  interface Window {
    termManager: {
      getTerms(params?: any): Promise<any>;
      getTermById(id: number): Promise<any>;
      addTerm(term: any): Promise<any>;
      updateTerm(id: number, term: any): Promise<any>;
      deleteTerm(id: number): Promise<any>;
      getDomains(): Promise<any>;
      addDomain(domain: any): Promise<any>;
      updateDomain(id: number, updates: any): Promise<any>;
      deleteDomain(id: number): Promise<any>;
      batchUpdateTermDomains(termIds: number[], domainId: number | null): Promise<any>;
      getDomainTermCounts(): Promise<any>;
      addTermRelation(data: any): Promise<any>;
      getTermRelations(termId: number): Promise<any>;
      deleteTermRelation(id: number): Promise<any>;
      addTermSource(data: any): Promise<any>;
      getTermSources(termId: number): Promise<any>;
      extractTermsFromFile(filePath: string, language: string, useAI?: boolean, aiConfig?: any, sourceType?: string): Promise<any>;
      extractTermsFromText(text: string, language: string, useAI?: boolean, aiConfig?: any): Promise<any>;
      extractTermsFromUrl(url: string, language: string, useAI?: boolean, aiConfig?: any): Promise<any>;
      getAIConfig(): Promise<any>;
      setAIConfig(config: any): Promise<any>;
      checkConsistency(domainId?: number): Promise<any>;
      getExtractionJobs(): Promise<any>;
      addExtractionJob(job: any): Promise<any>;
      deleteExtractionJob(id: number): Promise<any>;
      showSaveDialog(options: any): Promise<any>;
      saveFile(filePath: string, content: string): Promise<any>;
      showOpenDialog(options: any): Promise<any>;
      getUserName(): Promise<any>;
      // 智能抽取API
      smartExtractTermsFromText(text: string, language: string, strategy?: any): Promise<any>;
      smartExtractTermsFromFile(filePath: string, language: string, strategy?: any): Promise<any>;
      smartExtractTermsFromUrl(url: string, language: string, strategy?: any): Promise<any>;
      getDefaultExtractionStrategy(): Promise<any>;
      // AI配置测试
      testAIConnection(config: any): Promise<any>;
      
      // 语言对管理
      getLanguagePairs(): Promise<any>;
      addLanguagePair(pair: any): Promise<any>;
      updateLanguagePair(id: number, updates: any): Promise<any>;
      deleteLanguagePair(id: number): Promise<any>;
      
      // 翻译相关
      getTranslations(termId: number, languageCode?: string): Promise<any>;
      addTranslation(translation: any): Promise<any>;
      updateTranslation(id: number, updates: any): Promise<any>;
      deleteTranslation(id: number): Promise<any>;
      
      // 术语锁定
      lockTerm(id: number): Promise<any>;
      unlockTerm(id: number): Promise<any>;
      batchLockTerms(termIds: number[]): Promise<any>;
      batchUnlockTerms(termIds: number[]): Promise<any>;
      
      // AI翻译建议
      getAITranslationSuggestion(termId: number, targetLang: string): Promise<any>;
      batchGetAITranslationSuggestions(termIds: number[], targetLang: string): Promise<any>;
      
      // 多语言API
      getLanguages(): Promise<any>;
      addLanguage(language: any): Promise<any>;
      deleteLanguage(code: string): Promise<any>;
      
        // AI补全建议
        getAITermSuggestion(request: any): Promise<any>;
        
        // AI翻译
        translateWithAI(request: any): Promise<any>;
        
        // 新增：获取或创建层级分类路径
        getOrCreateDomainPath(path: string): Promise<any>;

        // AI Vision PDF 抽取（支持文本型和图片型PDF）
  extractTermsFromPDFWithAI(filePath: string, language: string, aiConfig: any, progressCallback?: (progress: any) => void): Promise<any>;

        // 监听抽取进度事件
        onExtractionProgress(callback: (progress: any) => void): () => void;
        
    };
  }
}

export const ipcApi = {
  getTerms: (params?: any) => window.termManager.getTerms(params),
  getTermById: (id: number) => window.termManager.getTermById(id),
  addTerm: (term: any) => window.termManager.addTerm(term),
  updateTerm: (id: number, term: any) => window.termManager.updateTerm(id, term),
  deleteTerm: (id: number) => window.termManager.deleteTerm(id),
  getDomains: () => window.termManager.getDomains(),
  addDomain: (domain: any) => window.termManager.addDomain(domain),
  updateDomain: (id: number, updates: any) => window.termManager.updateDomain(id, updates),
  deleteDomain: (id: number) => window.termManager.deleteDomain(id),
  batchUpdateTermDomains: (termIds: number[], domainId: number | null) => 
    window.termManager.batchUpdateTermDomains(termIds, domainId),
  getDomainTermCounts: () => window.termManager.getDomainTermCounts(),
  addTermRelation: (data: any) => window.termManager.addTermRelation(data),
  getTermRelations: (termId: number) => window.termManager.getTermRelations(termId),
  deleteTermRelation: (id: number) => window.termManager.deleteTermRelation(id),
  addTermSource: (data: any) => window.termManager.addTermSource(data),
  getTermSources: (termId: number) => window.termManager.getTermSources(termId),
  extractTermsFromFile: (filePath: string, language: string, useAI = false, aiConfig?: any, sourceType?: string) =>
    window.termManager.extractTermsFromFile(filePath, language, useAI, aiConfig, sourceType),
  extractTermsFromText: (text: string, language: string, useAI = false, aiConfig?: any) =>
    window.termManager.extractTermsFromText(text, language, useAI, aiConfig),
  extractTermsFromUrl: (url: string, language: string, useAI = false, aiConfig?: any) =>
    window.termManager.extractTermsFromUrl(url, language, useAI, aiConfig),
  getAIConfig: () => window.termManager.getAIConfig(),
  setAIConfig: (config: any) => window.termManager.setAIConfig(config),
  checkConsistency: (domainId?: number) => window.termManager.checkConsistency(domainId),
  getExtractionJobs: () => window.termManager.getExtractionJobs(),
  addExtractionJob: (job: any) => window.termManager.addExtractionJob(job),
  deleteExtractionJob: (id: number) => window.termManager.deleteExtractionJob(id),
  showSaveDialog: (options: any) => window.termManager.showSaveDialog(options),
  saveFile: (filePath: string, content: string) => window.termManager.saveFile(filePath, content),
  showOpenDialog: (options: any) => window.termManager.showOpenDialog(options),
  getUserName: () => window.termManager.getUserName(),
  
  // 智能抽取API
  smartExtractTermsFromText: (text: string, language: string, strategy?: any) =>
    window.termManager.smartExtractTermsFromText(text, language, strategy),
  smartExtractTermsFromFile: (filePath: string, language: string, strategy?: any) =>
    window.termManager.smartExtractTermsFromFile(filePath, language, strategy),
  smartExtractTermsFromUrl: (url: string, language: string, strategy?: any) =>
    window.termManager.smartExtractTermsFromUrl(url, language, strategy),
  getDefaultExtractionStrategy: () => window.termManager.getDefaultExtractionStrategy(),
  
  // AI配置测试
  testAIConnection: (config: any) => window.termManager.testAIConnection(config),
  
  // 语言对管理
  getLanguagePairs: () => window.termManager.getLanguagePairs(),
  addLanguagePair: (pair: any) => window.termManager.addLanguagePair(pair),
  updateLanguagePair: (id: number, updates: any) => window.termManager.updateLanguagePair(id, updates),
  deleteLanguagePair: (id: number) => window.termManager.deleteLanguagePair(id),
  
  // 翻译相关
  getTranslations: (termId: number, languageCode?: string) => window.termManager.getTranslations(termId, languageCode),
  addTranslation: (translation: any) => window.termManager.addTranslation(translation),
  updateTranslation: (id: number, updates: any) => window.termManager.updateTranslation(id, updates),
  deleteTranslation: (id: number) => window.termManager.deleteTranslation(id),
  
  // 术语锁定
  lockTerm: (id: number) => window.termManager.lockTerm(id),
  unlockTerm: (id: number) => window.termManager.unlockTerm(id),
  batchLockTerms: (termIds: number[]) => window.termManager.batchLockTerms(termIds),
  batchUnlockTerms: (termIds: number[]) => window.termManager.batchUnlockTerms(termIds),
  
  // AI翻译建议
  getAITranslationSuggestion: (termId: number, targetLang: string) => window.termManager.getAITranslationSuggestion(termId, targetLang),
  batchGetAITranslationSuggestions: (termIds: number[], targetLang: string) => window.termManager.batchGetAITranslationSuggestions(termIds, targetLang),
  
  // 多语言API
  getLanguages: () => window.termManager.getLanguages(),
  addLanguage: (language: any) => window.termManager.addLanguage(language),
  deleteLanguage: (code: string) => window.termManager.deleteLanguage(code),
  
  // AI补全建议
  getAITermSuggestion: (request: any) => window.termManager.getAITermSuggestion(request),
  
  // AI翻译
  translateWithAI: (request: any) => window.termManager.translateWithAI(request),
  
  // 新增：获取或创建层级分类路径
  getOrCreateDomainPath: (path: string) => window.termManager.getOrCreateDomainPath(path),

  // AI Vision PDF 抽取（支持文本型和图片型PDF）
  extractTermsFromPDFWithAI: (filePath: string, language: string, aiConfig: any, progressCallback?: (progress: any) => void) =>
    window.termManager.extractTermsFromPDFWithAI(filePath, language, aiConfig, progressCallback),

  // 监听抽取进度事件
  onExtractionProgress: (callback: (progress: any) => void) =>
    window.termManager.onExtractionProgress(callback),
  
};
