import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getTerms,
  getTermById,
  addTerm,
  updateTerm,
  deleteTerm,
  getDomains,
  getDomainTermCounts,
  addDomain,
  updateDomain,
  deleteDomain,
  batchUpdateTermDomains,
  addTermRelation,
  getTermRelations,
  deleteTermRelation,
  addTermSource,
  getTermSources,
  getExtractionJobs,
  addExtractionJob,
  deleteExtractionJob,
  getSettings,
  setSettings,
  addTranslation,
  getTranslations,
  updateTranslation,
  deleteTranslation,
  getLanguages,
  addLanguage,
  getLanguagePairs,
  addLanguagePair,
  deleteLanguage,
  updateLanguagePair,
  deleteLanguagePair,
  lockTerm,
  unlockTerm,
  batchLockTerms,
  batchUnlockTerms,
  getAITranslationSuggestion,
  batchGetAITranslationSuggestions,
  getAITermSuggestion,
  getOrCreateDomainPath,
  findDomainIdByName
} from './database';
import { extractTermsFromFile, extractTermsFromText, extractTermsFromUrl, extractTermsFromPDFWithAI, smartExtractTerms, smartExtractTermsFromFile, smartExtractTermsFromUrl } from './term-engine';
import { checkConsistency } from './consistency-checker';
import { DEFAULT_STRATEGY } from './term-engine/smart-extractor';
import { getAIConfigFromSettings, validateAIConfig, testAIConnection } from './ai-client';
import { detectLanguage, translateWithAI, alignTerms, batchTranslateTerms } from './ai-language-detection';
import { createWebExtractionProgressReporter, ProgressStages, ProgressMessages, defaultProgressEstimator } from './progress-reporter';
export function registerIPCHandlers() {
  // Terms handlers
  ipcMain.handle('get-terms', (_, params) => {
    try {
      const result = getTerms(params);
      return { success: true, data: result.rows, total: result.total };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-term-by-id', (_, id) => {
    try {
      return { success: true, data: getTermById(id) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('add-term', (_, term) => {
    try {
      const id = addTerm(term);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('update-term', (_, { id, updates }) => {
    try {
      updateTerm(id, updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-term', (_, id) => {
    try {
      deleteTerm(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Domains handlers
  ipcMain.handle('get-domains', () => {
    try {
      return { success: true, data: getDomains() };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('add-domain', (_, domain) => {
    try {
      const id = addDomain(domain);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('update-domain', (_, { id, updates }) => {
    try {
      updateDomain(id, updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-domain', (_, id) => {
    try {
      deleteDomain(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('batch-update-term-domains', (_, { termIds, domainId }) => {
    try {
      const result = batchUpdateTermDomains(termIds, domainId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Term Relations handlers
  ipcMain.handle('add-term-relation', (_, relation) => {
    try {
      addTermRelation(relation);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-term-relations', (_, termId) => {
    try {
      return { success: true, data: getTermRelations(termId) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-term-relation', (_, id) => {
    try {
      deleteTermRelation(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('show-open-dialog', async (_, options) => {
    try {
      const result = await dialog.showOpenDialog(options);
      return { success: true, filePaths: result.filePaths, canceled: result.canceled };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Term Sources handlers
  ipcMain.handle('add-term-source', (_, source) => {
    try {
      addTermSource(source);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-term-sources', (_, termId) => {
    try {
      return { success: true, data: getTermSources(termId) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 超时辅助函数：为 Promise 添加超时兜底
  const withTimeout = <T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
    ]);
  };

  // Extraction handlers
  ipcMain.handle('extract-terms-from-text', async (_, { text, language, useAI, aiConfig }) => {
    try {
      console.log(`[Extraction] Input text length: ${text?.length || 0}, language: ${language}, useAI: ${useAI}`);
      // 启用AI时超时5分钟，非AI时超时2分钟
      const timeoutMs = useAI ? 300000 : 120000;
      const data = await withTimeout(
        extractTermsFromText(text, language, !!useAI, aiConfig),
        timeoutMs,
        `文本抽取处理超时（${timeoutMs / 1000}秒），请减少文本量或检查AI服务状态`
      );
      console.log(`[Extraction] Extracted ${data.length} terms`);
      if (data.length === 0) {
        console.warn('[Extraction] No terms extracted - returning empty array');
        const warning = useAI
          ? 'AI增强抽取未能识别出术语（可能AI服务异常或文本内容不适合术语抽取），已降级使用规则模式但未提取到有效术语。'
          : '未从文本中提取到术语，请检查输入文本是否包含有效的术语内容。';
        return { success: true, data, warning };
      }
      return { success: true, data };
    } catch (error) {
      console.error('[Extraction] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('extract-terms-from-file', async (_, { filePath, language, useAI, aiConfig, sourceType }) => {
    try {
      // 启用AI时超时5分钟，非AI时超时2分钟
      const timeoutMs = useAI ? 300000 : 120000;
      const data = await withTimeout(
        extractTermsFromFile(filePath, language, !!useAI, aiConfig, sourceType),
        timeoutMs,
        `文件抽取处理超时（${timeoutMs / 1000}秒），请减少文件大小或检查AI服务状态`
      );
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('extract-terms-from-url', async (event, { url, language, useAI, aiConfig }) => {
    const windowId = event.sender.id;
    const progressReporter = createWebExtractionProgressReporter(windowId);
    
    try {
      progressReporter.start(
        ProgressStages.INITIALIZING,
        ProgressMessages.start(url),
        { url, language, useAI }
      );
      
      // URL验证阶段
      progressReporter.updateStage(
        ProgressStages.URL_VALIDATION,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.URL_VALIDATION, 0),
        ProgressMessages.urlValidation
      );
      
      if (!url || !url.startsWith('http')) {
        throw new Error('无效的URL格式，请以http://或https://开头');
      }
      
      // 网页抓取阶段
      progressReporter.updateStage(
        ProgressStages.FETCHING,
        defaultProgressEstimator.calculateSubProgress(ProgressStages.FETCHING, 0),
        ProgressMessages.fetching(url)
      );
      
      // 启用AI时超时5分钟，非AI时超时2分钟
      const timeoutMs = useAI ? 300000 : 120000;
      const data = await withTimeout(
        // 直接调用支持进度报告的extractTermsFromUrl函数
        extractTermsFromUrl(url, language, !!useAI, aiConfig, progressReporter),
        timeoutMs,
        `URL抽取处理超时（${timeoutMs / 1000}秒），请确认URL可访问并检查AI服务状态`
      );
      
      // 完成阶段
      progressReporter.complete(
        ProgressMessages.complete(data.length),
        { termCount: data.length }
      );
      
      // 如果启用AI但结果为空，返回警告信息
      if (data.length === 0) {
        const warning = useAI
          ? 'AI增强抽取未能识别出术语（可能AI服务异常或网页内容不适合术语抽取），已降级使用规则模式但未提取到有效术语。'
          : '未从该URL中提取到术语，请检查网页内容是否包含有效的术语文本。';
        return { success: true, data, warning };
      }
      
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      progressReporter.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Consistency handlers
  ipcMain.handle('check-consistency', (_, domainId) => {
    try {
      const data = checkConsistency(domainId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Extraction Job handlers
  ipcMain.handle('get-extraction-jobs', () => {
    try {
      return { success: true, data: getExtractionJobs() };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('add-extraction-job', (_, job) => {
    try {
      const id = addExtractionJob(job);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-extraction-job', (_, id) => {
    try {
      deleteExtractionJob(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Save file helper
  ipcMain.handle('show-save-dialog', async (_, options) => {
    try {
      const result = await dialog.showSaveDialog(options);
      return { success: true, filePath: result.filePath, canceled: result.canceled };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-file', (_, { filePath, content }) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-user-name', () => {
    const osUser = os.userInfo?.().username || process.env.USERNAME || process.env.USER || 'unknown';
    return { success: true, user: osUser };
  });

  ipcMain.handle('get-ai-config', () => {
    try {
      const settings = getSettings();
      const aiConfig = getAIConfigFromSettings(settings);
      console.log(`[AI Config] Returning structured config: ${Object.keys(aiConfig).join(', ')}`);
      return { success: true, data: aiConfig };
    } catch (error) {
      console.error('Failed to get AI config:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('set-ai-config', (_, config) => {
    try {
      console.log('Setting AI config:', config);
      
      // 验证配置
      const validation = validateAIConfig(config);
      if (!validation.valid) {
        return { success: false, error: `配置验证失败: ${validation.reason}` };
      }
      
      // 将AIConfig转换为设置键值对
      const settingsToSave: Record<string, string> = {};
      
      // 使用新字段名保存
      if (config.apiKey) settingsToSave['apiKey'] = config.apiKey;
      if (config.endpoint) settingsToSave['endpoint'] = config.endpoint;
      if (config.model) settingsToSave['model'] = config.model;
      if (config.promptTemplate) settingsToSave['promptTemplate'] = config.promptTemplate;
      if (config.dataPath) settingsToSave['dataPath'] = config.dataPath;
      
      // 同时保存旧字段名以保持兼容性
      if (config.apiKey) settingsToSave['ai_api_key'] = config.apiKey;
      if (config.endpoint) settingsToSave['ai_endpoint'] = config.endpoint;
      if (config.model) settingsToSave['ai_model'] = config.model;
      if (config.promptTemplate) settingsToSave['ai_prompt_template'] = config.promptTemplate;
      if (config.dataPath) settingsToSave['data_path'] = config.dataPath;
      
      const saved = setSettings(settingsToSave);
      console.log('AI config saved successfully:', Object.keys(saved).length, 'settings saved');
      
      // 如果dataPath发生变化，重新初始化数据库以使用新的数据目录
      if (config.dataPath) {
        try {
          console.log(`Data path changed to: ${config.dataPath}, reinitializing database...`);
          const { initDatabase } = require('./database');
          initDatabase(config.dataPath);
          console.log('Database reinitialized with new data path');
        } catch (error) {
          console.error('Failed to reinitialize database with new data path:', error);
          // 继续执行，不中断设置保存流程
        }
      }
      
      // 返回结构化的配置
      const aiConfig = getAIConfigFromSettings(saved);
      return { success: true, data: aiConfig };
    } catch (error) {
      console.error('Failed to set AI config:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // AI连接测试处理器
  ipcMain.handle('test-ai-connection', async (_, config) => {
    try {
      console.log('Testing AI connection with config:', Object.keys(config || {}).join(', '));
      const result = await testAIConnection(config);
      return { success: true, data: result };
    } catch (error) {
      console.error('AI connection test failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 智能抽取处理程序 - 后端兜底注入AI配置
  ipcMain.handle('smart-extract-terms-from-text', async (_, { text, language, strategy = DEFAULT_STRATEGY }) => {
    try {
      // 如果策略需要AI但前端未传递aiConfig，从系统设置兜底注入
      const effectiveStrategy = { ...strategy };
      if ((effectiveStrategy.mode === 'hybrid' || effectiveStrategy.mode === 'ai-only') && !effectiveStrategy.aiConfig?.apiKey) {
        const settings = getSettings();
        const aiConfigFromSettings = getAIConfigFromSettings(settings);
        if (aiConfigFromSettings.apiKey) {
          effectiveStrategy.aiConfig = aiConfigFromSettings;
          console.log('[Smart Extraction] AI config injected from settings (backend fallback)');
        }
      }
      
      console.log(`[Smart Extraction] Input text length: ${text?.length || 0}, language: ${language}, mode: ${effectiveStrategy.mode}`);
      const data = await smartExtractTerms(text, language, effectiveStrategy);
      console.log(`[Smart Extraction] Extracted ${data.length} smart terms`);
      return { success: true, data };
    } catch (error) {
      console.error('[Smart Extraction] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ═══════════════════════════════════════════
  // AI Vision PDF 抽取处理器（支持文本型和图片型PDF）
  // ═══════════════════════════════════════════
  ipcMain.handle('extract-terms-from-pdf-ai', async (event, { filePath, language, aiConfig, maxPages }) => {
    const windowId = event.sender.id;
    try {
      // 构建进度回调，将进度通过IPC发送到前端
      const onProgress = (progress: any) => {
        const win = BrowserWindow.fromId(windowId);
        if (win && !win.isDestroyed()) {
          win.webContents.send('extraction-progress', {
            ...progress,
            filePath,
            extractionMode: 'pdf-ai-vision',
          });
        }
      };

      const timeoutMs = 600000; // AI Vision模式超时10分钟（多页PDF逐页处理）
      const results = await withTimeout(
        extractTermsFromPDFWithAI(
          filePath,
          language,
          aiConfig,
          onProgress,
          maxPages || 50
        ),
        timeoutMs,
        `AI Vision PDF抽取超时（${timeoutMs / 1000}秒），PDF页数可能过多或AI服务响应较慢`
      );

      return { success: true, data: results };
    } catch (error) {
      console.error('[AI PDF Extraction] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('smart-extract-terms-from-file', async (_, { filePath, language, strategy = DEFAULT_STRATEGY }) => {
    try {
      const effectiveStrategy = { ...strategy };
      if ((effectiveStrategy.mode === 'hybrid' || effectiveStrategy.mode === 'ai-only') && !effectiveStrategy.aiConfig?.apiKey) {
        const settings = getSettings();
        const aiConfigFromSettings = getAIConfigFromSettings(settings);
        if (aiConfigFromSettings.apiKey) {
          effectiveStrategy.aiConfig = aiConfigFromSettings;
          console.log('[Smart Extraction] AI config injected from settings (backend fallback)');
        }
      }
      
      const data = await smartExtractTermsFromFile(filePath, language, effectiveStrategy);
      return { success: true, data };
    } catch (error) {
      console.error('[Smart Extraction] File error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('smart-extract-terms-from-url', async (_, { url, language, strategy = DEFAULT_STRATEGY }) => {
    try {
      const effectiveStrategy = { ...strategy };
      if ((effectiveStrategy.mode === 'hybrid' || effectiveStrategy.mode === 'ai-only') && !effectiveStrategy.aiConfig?.apiKey) {
        const settings = getSettings();
        const aiConfigFromSettings = getAIConfigFromSettings(settings);
        if (aiConfigFromSettings.apiKey) {
          effectiveStrategy.aiConfig = aiConfigFromSettings;
          console.log('[Smart Extraction] AI config injected from settings (backend fallback)');
        }
      }
      
      const data = await smartExtractTermsFromUrl(url, language, effectiveStrategy);
      return { success: true, data };
    } catch (error) {
      console.error('[Smart Extraction] URL error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ================== 多语言处理程序 ==================

  // 语言检测
  ipcMain.handle('detect-language', async (_, { text, config }) => {
    try {
      const aiConfig = config || getAIConfigFromSettings(getSettings());
      const result = await detectLanguage(text, aiConfig);
      return { success: true, data: result };
    } catch (error) {
      console.error('[Language Detection] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // AI翻译
  ipcMain.handle('translate-with-ai', async (_, { request, config }) => {
    try {
      const aiConfig = config || getAIConfigFromSettings(getSettings());
      const result = await translateWithAI(request, aiConfig);
      return { success: true, data: result };
    } catch (error) {
      console.error('[AI Translation] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 术语对齐
  ipcMain.handle('align-terms', async (_, { sourceTerms, targetTerms, sourceLang, targetLang }) => {
    try {
      const result = alignTerms(sourceTerms, targetTerms, sourceLang, targetLang);
      return { success: true, data: result };
    } catch (error) {
      console.error('[Term Alignment] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 批量翻译
  ipcMain.handle('batch-translate-terms', async (_, { terms, sourceLang, targetLang, config }) => {
    try {
      const aiConfig = config || getAIConfigFromSettings(getSettings());
      const result = await batchTranslateTerms(terms, sourceLang, targetLang, aiConfig);
      return { success: true, data: result };
    } catch (error) {
      console.error('[Batch Translation] Error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 多语言数据库操作

  // 翻译管理
  ipcMain.handle('add-translation', (_, translation) => {
    try {
      const id = addTranslation(translation);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-translations', (_, { termId, languageCode }) => {
    try {
      const data = getTranslations(termId, languageCode);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('update-translation', (_, { id, updates }) => {
    try {
      const data = updateTranslation(id, updates);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-translation', (_, id) => {
    try {
      deleteTranslation(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 语言管理
  ipcMain.handle('get-languages', () => {
    try {
      const data = getLanguages();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('add-language', (_, language) => {
    try {
      addLanguage(language);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 语言对管理
  ipcMain.handle('get-language-pairs', () => {
    try {
      const data = getLanguagePairs();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('add-language-pair', (_, pair) => {
    try {
      const id = addLanguagePair(pair);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 删除语言
  ipcMain.handle('delete-language', (_, code) => {
    try {
      deleteLanguage(code);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 更新语言对
  ipcMain.handle('update-language-pair', (_, { id, updates }) => {
    try {
      const data = updateLanguagePair(id, updates);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 删除语言对
  ipcMain.handle('delete-language-pair', (_, id) => {
    try {
      deleteLanguagePair(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ================== 术语锁定功能处理程序 ==================

  // 锁定单个术语
  ipcMain.handle('lock-term', (_, id) => {
    try {
      const success = lockTerm(id);
      return { success: true, data: success };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 解锁单个术语
  ipcMain.handle('unlock-term', (_, id) => {
    try {
      const success = unlockTerm(id);
      return { success: true, data: success };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 批量锁定术语
  ipcMain.handle('batch-lock-terms', (_, termIds) => {
    try {
      const result = batchLockTerms(termIds);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 批量解锁术语
  ipcMain.handle('batch-unlock-terms', (_, termIds) => {
    try {
      const result = batchUnlockTerms(termIds);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ================== AI翻译建议功能处理程序 ==================

  // 获取单个术语的AI翻译建议
  ipcMain.handle('get-ai-translation-suggestion', async (_, { termId, targetLang }) => {
    try {
      const suggestion = await getAITranslationSuggestion(termId, targetLang);
      return { success: true, data: suggestion };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 批量获取AI翻译建议
  ipcMain.handle('batch-get-ai-translation-suggestions', async (_, { termIds, targetLang }) => {
    try {
      const suggestions = await batchGetAITranslationSuggestions(termIds, targetLang);
      return { success: true, data: suggestions };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ================== AI补全建议功能处理程序 ==================

  // 获取AI补全建议
  ipcMain.handle('get-ai-term-suggestion', async (_, request) => {
    try {
      const suggestion = await getAITermSuggestion(request);
      return { success: true, data: suggestion };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ================== 通用处理程序 ==================

  // 获取默认抽取策略
  ipcMain.handle('get-default-extraction-strategy', () => {
    return { success: true, data: DEFAULT_STRATEGY };
  });

  // ================== 新增分类路径处理程序 ==================
  
  // 获取或创建层级分类路径
  ipcMain.handle('get-or-create-domain-path', (_, path) => {
    try {
      const domainId = getOrCreateDomainPath(path);
      return { success: true, data: domainId };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // 获取所有分类的术语计数（不分页）
  ipcMain.handle('get-domain-term-counts', () => {
    try {
      const counts = getDomainTermCounts();
      return { success: true, data: Object.fromEntries(counts) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

}
