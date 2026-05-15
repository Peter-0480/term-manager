// IPC communication bridge between main and renderer
import { contextBridge, ipcRenderer } from 'electron';

// Expose IPC to renderer process
contextBridge.exposeInMainWorld('termManager', {
	// Term operations
	getTerms: (params?: any) => ipcRenderer.invoke('get-terms', params),
	getTermById: (id: number | string) => ipcRenderer.invoke('get-term-by-id',
		typeof id === 'string' ? Number(id) : id),
	addTerm: (term: any) => ipcRenderer.invoke('add-term', term),
	updateTerm: (id: number | string, updates: any) =>
		ipcRenderer.invoke('update-term', {
			id: typeof id === 'string' ? Number(id) : id,
			updates
		}),
	deleteTerm: (id: number | string) =>
		ipcRenderer.invoke('delete-term', typeof id === 'string' ? Number(id) : id),

	// Domain operations
	getDomains: () => ipcRenderer.invoke('get-domains'),
	addDomain: (domain: any) => ipcRenderer.invoke('add-domain', domain),
	updateDomain: (id: number | string, updates: any) =>
		ipcRenderer.invoke('update-domain', {
			id: typeof id === 'string' ? Number(id) : id,
			updates
		}),
	deleteDomain: (id: number | string) =>
		ipcRenderer.invoke('delete-domain', typeof id === 'string' ? Number(id) : id),
	batchUpdateTermDomains: (termIds: number[], domainId: number | null) =>
		ipcRenderer.invoke('batch-update-term-domains', { termIds, domainId }),
	getDomainTermCounts: () => ipcRenderer.invoke('get-domain-term-counts'),

	// Term relation operations
	addTermRelation: (data: any) => ipcRenderer.invoke('add-term-relation', data),
	getTermRelations: (termId: number | string) =>
		ipcRenderer.invoke('get-term-relations',
			typeof termId === 'string' ? Number(termId) : termId),
	deleteTermRelation: (id: number | string) =>
		ipcRenderer.invoke('delete-term-relation', typeof id === 'string' ? Number(id) : id),

	// Term source operations
	addTermSource: (data: any) => ipcRenderer.invoke('add-term-source', data),
	getTermSources: (termId: number | string) =>
		ipcRenderer.invoke('get-term-sources',
			typeof termId === 'string' ? Number(termId) : termId),

	// Extraction
	extractTermsFromText: (text: string, language: string, useAI = false, aiConfig?: any) =>
		ipcRenderer.invoke('extract-terms-from-text', { text, language, useAI, aiConfig }),
	extractTermsFromFile: (filePath: string, language: string, useAI = false, aiConfig?: any) =>
		ipcRenderer.invoke('extract-terms-from-file', { filePath, language, useAI, aiConfig }),
	extractTermsFromUrl: (url: string, language: string, useAI = false, aiConfig?: any) =>
		ipcRenderer.invoke('extract-terms-from-url', { url, language, useAI, aiConfig }),
	getAIConfig: () => ipcRenderer.invoke('get-ai-config'),
	setAIConfig: (config: any) => ipcRenderer.invoke('set-ai-config', config),
	getExtractionJobs: () => ipcRenderer.invoke('get-extraction-jobs'),
	addExtractionJob: (job: any) => ipcRenderer.invoke('add-extraction-job', job),
	deleteExtractionJob: (id: number) => ipcRenderer.invoke('delete-extraction-job', id),

  // Consistency
  checkConsistency: (domainId?: number) => ipcRenderer.invoke('check-consistency', domainId),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('save-file', { filePath, content }),
  getUserName: () => ipcRenderer.invoke('get-user-name'),
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),

  // 智能抽取
  smartExtractTermsFromText: (text: string, language: string, strategy?: any) =>
    ipcRenderer.invoke('smart-extract-terms-from-text', { text, language, strategy }),
  smartExtractTermsFromFile: (filePath: string, language: string, strategy?: any) =>
    ipcRenderer.invoke('smart-extract-terms-from-file', { filePath, language, strategy }),
  smartExtractTermsFromUrl: (url: string, language: string, strategy?: any) =>
    ipcRenderer.invoke('smart-extract-terms-from-url', { url, language, strategy }),
  getDefaultExtractionStrategy: () => ipcRenderer.invoke('get-default-extraction-strategy'),

  // AI配置测试
  testAIConnection: (config: any) => ipcRenderer.invoke('test-ai-connection', config),

  // 语言对管理
  getLanguagePairs: () => ipcRenderer.invoke('get-language-pairs'),
  addLanguagePair: (pair: any) => ipcRenderer.invoke('add-language-pair', pair),
  updateLanguagePair: (id: number, updates: any) => ipcRenderer.invoke('update-language-pair', { id, updates }),
  deleteLanguagePair: (id: number) => ipcRenderer.invoke('delete-language-pair', id),
  
  // 翻译相关
  getTranslations: (termId: number, languageCode?: string) => ipcRenderer.invoke('get-translations', { termId, languageCode }),
  addTranslation: (translation: any) => ipcRenderer.invoke('add-translation', translation),
  updateTranslation: (id: number, updates: any) => ipcRenderer.invoke('update-translation', { id, updates }),
  deleteTranslation: (id: number) => ipcRenderer.invoke('delete-translation', id),
  
  // 术语锁定
  lockTerm: (id: number) => ipcRenderer.invoke('lock-term', id),
  unlockTerm: (id: number) => ipcRenderer.invoke('unlock-term', id),
  batchLockTerms: (termIds: number[]) => ipcRenderer.invoke('batch-lock-terms', termIds),
  batchUnlockTerms: (termIds: number[]) => ipcRenderer.invoke('batch-unlock-terms', termIds),
  
  // AI翻译建议
  getAITranslationSuggestion: (termId: number, targetLang: string) => ipcRenderer.invoke('get-ai-translation-suggestion', { termId, targetLang }),
  batchGetAITranslationSuggestions: (termIds: number[], targetLang: string) => ipcRenderer.invoke('batch-get-ai-translation-suggestions', { termIds, targetLang }),
  
  // 多语言API
  getLanguages: () => ipcRenderer.invoke('get-languages'),
  addLanguage: (language: any) => ipcRenderer.invoke('add-language', language),
  deleteLanguage: (code: string) => ipcRenderer.invoke('delete-language', code),
  
  // AI翻译
  translateWithAI: (request: any) => ipcRenderer.invoke('translate-with-ai', request),
  // AI补全建议
  getAITermSuggestion: (request: any) => ipcRenderer.invoke('get-ai-term-suggestion', request),
  
  // 新增：获取或创建层级分类路径
  getOrCreateDomainPath: (path: string) => ipcRenderer.invoke('get-or-create-domain-path', path),

  // AI Vision PDF 抽取（支持文本型和图片型PDF）
  extractTermsFromPDFWithAI: (filePath: string, language: string, aiConfig: any, maxPages?: number) =>
    ipcRenderer.invoke('extract-terms-from-pdf-ai', { filePath, language, aiConfig, maxPages }),

  // 监听抽取进度事件（AI Vision模式）
  onExtractionProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('extraction-progress', handler);
    // 返回取消监听函数
    return () => ipcRenderer.removeListener('extraction-progress', handler);
  },

});
