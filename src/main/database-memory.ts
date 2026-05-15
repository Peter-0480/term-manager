// 内存数据库模块 - 临时替代SQLite，避免native模块问题
// 注意：此实现仅用于开发和测试，生产环境应使用SQLite

import fs from 'fs';
import path from 'path';
import type { Language, Translation, LanguagePair } from '../types/multilingual';
import { AIConfig, getAIConfigFromSettings } from './ai-client';
import { getAITermCompletionSuggestion, AICompletionRequest } from './ai-completion';
import { BatchTranslationService, BatchTranslationRequest } from './batch-translation-service';
import { APIResponseHandler } from './api-response-handler';

// 官方学科分类数据
import officialDomainsData from '../official-domains.json';

// 导出数据库接口类型
export interface Term {
  id: number;
  source_lang: string;
  term_text: string;
  abbreviation?: string;
  domain_id?: number;
  description?: string;
  locked?: boolean;
  favorite?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Domain {
  id: number;
  name: string;
  parent_id?: number;
  description?: string;
  created_at: string;
}

export interface TranslationRecord {
  id: number;
  term_id: number;
  language_code: string;
  text: string;
  confidence?: number;
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface LanguageRecord {
  code: string;
  name: string;
  native_name: string;
  direction: 'ltr' | 'rtl';
  enabled: boolean;
  is_mother_tongue?: boolean; // 是否为母语（中文）
  priority?: number;         // 显示优先级
  created_at: string;
}

export interface LanguagePairRecord {
  id: number;
  source_lang: string;
  target_lang: string;
  enabled: boolean;
  priority: number;
  created_at: string;
}

export interface TermRelation {
  id: number;
  term_id: number;
  relation_type: string;
  related_term_id: number;
  note?: string;
  created_at: string;
}

export interface TermSource {
  id: number;
  term_id: number;
  source_type: string;
  source_detail?: string;
  credibility_score: number;
  created_at: string;
}

export interface ExtractionJob {
  id: number;
  source_type: string;
  source_path?: string;
  language: string;
  item_count: number;
  use_ai: boolean;
  note?: string;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

class MemoryDatabase {
  private terms: Term[] = [];
  private domains: Domain[] = [];
  private termRelations: TermRelation[] = [];
  private termSources: TermSource[] = [];
  private extractionJobs: ExtractionJob[] = [];
  private settings: Setting[] = [];
  private translations: TranslationRecord[] = [];
  private languages: LanguageRecord[] = [];
  private languagePairs: LanguagePairRecord[] = [];
  private nextId: Record<string, number> = {
    terms: 1,
    domains: 1,
    termRelations: 1,
    termSources: 1,
    extractionJobs: 1,
    translations: 1,
    languages: 1,
    languagePairs: 1
  };
  
  private dataDir: string;
  private settingsFile: string;
  private dataFile: string;

  constructor(dataPath?: string) {
    console.log('Initializing memory database (temporary solution)');
    console.warn('WARNING: Using memory database. All data will be lost when app closes.');
    console.warn('For persistent storage, install Visual Studio and rebuild better-sqlite3.');
    
    // 设置数据目录
    this.dataDir = dataPath || process.cwd();
    this.settingsFile = path.join(this.dataDir, 'term-manager-settings.json');
    this.dataFile = path.join(this.dataDir, 'term-manager-data.json');
    console.log(`Settings file: ${this.settingsFile}`);
    console.log(`Data file: ${this.dataFile}`);
    
    // 尝试从文件加载设置
    this.loadSettingsFromFile();
    
    // 尝试从文件加载数据
    this.loadDataFromFile();
    
    // 初始化默认设置（如果文件不存在）
    if (this.settings.length === 0) {
      this.initializeDefaultSettings();
      this.saveSettingsToFile();
    }
    
    // 初始化默认领域（如果没有加载到数据）
    if (this.domains.length === 0) {
      this.initializeDefaultDomains();
      // 保存默认数据
      this.saveDataToFile();
    }

    // 初始化默认语言（如果没有加载到数据）
    if (this.languages.length === 0) {
      this.initializeDefaultLanguages();
    }
  }

  private loadSettingsFromFile() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const content = fs.readFileSync(this.settingsFile, 'utf-8');
        const savedSettings = JSON.parse(content);
        
        if (Array.isArray(savedSettings)) {
          this.settings = savedSettings;
          console.log(`Loaded ${this.settings.length} settings from file`);
        }
      }
    } catch (error) {
      console.warn('Failed to load settings from file:', error);
    }
  }

  private saveSettingsToFile() {
    try {
      const dir = path.dirname(this.settingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8');
      console.log(`Settings saved to file: ${this.settingsFile}`);
    } catch (error) {
      console.error('Failed to save settings to file:', error);
    }
  }

  private loadDataFromFile() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, 'utf-8');
        const data = JSON.parse(content);
        
        if (data.terms && Array.isArray(data.terms)) {
          this.terms = data.terms;
          console.log(`Loaded ${this.terms.length} terms from file`);
        }
        
        if (data.domains && Array.isArray(data.domains)) {
          this.domains = data.domains;
          console.log(`Loaded ${this.domains.length} domains from file`);
        }
        
        if (data.termRelations && Array.isArray(data.termRelations)) {
          this.termRelations = data.termRelations;
          console.log(`Loaded ${this.termRelations.length} term relations from file`);
        }
        
        if (data.termSources && Array.isArray(data.termSources)) {
          this.termSources = data.termSources;
          console.log(`Loaded ${this.termSources.length} term sources from file`);
        }
        
        if (data.extractionJobs && Array.isArray(data.extractionJobs)) {
          this.extractionJobs = data.extractionJobs;
          console.log(`Loaded ${this.extractionJobs.length} extraction jobs from file`);
        }
        
        if (data.translations && Array.isArray(data.translations)) {
          this.translations = data.translations;
          console.log(`Loaded ${this.translations.length} translations from file`);
        }
        
        if (data.languages && Array.isArray(data.languages)) {
          this.languages = data.languages;
          console.log(`Loaded ${this.languages.length} languages from file`);
        }
        
        if (data.languagePairs && Array.isArray(data.languagePairs)) {
          this.languagePairs = data.languagePairs;
          console.log(`Loaded ${this.languagePairs.length} language pairs from file`);
        }
        
        // 更新nextId计数器，确保后续ID不会重复
        this.updateNextIdCounters();
        
        console.log(`Successfully loaded all data from ${this.dataFile}`);
      } else {
        console.log(`Data file ${this.dataFile} does not exist, starting with empty database`);
      }
    } catch (error) {
      console.warn('Failed to load data from file:', error);
    }
  }

  private saveDataToFile() {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        terms: this.terms,
        domains: this.domains,
        termRelations: this.termRelations,
        termSources: this.termSources,
        extractionJobs: this.extractionJobs,
        translations: this.translations,
        languages: this.languages,
        languagePairs: this.languagePairs,
        // 不保存settings，因为它们有单独的文件
        // settings: this.settings
      };
      
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Data saved to file: ${this.dataFile}`);
    } catch (error) {
      console.error('Failed to save data to file:', error);
    }
  }

  private updateNextIdCounters() {
    // 更新各个类型的nextId计数器，确保后续ID不会重复
    const updateCounter = (type: string, items: Array<{ id: number }>) => {
      if (items.length > 0) {
        const maxId = Math.max(...items.map(item => item.id));
        this.nextId[type] = maxId + 1;
      } else {
        this.nextId[type] = 1;
      }
    };
    
    updateCounter('terms', this.terms);
    updateCounter('domains', this.domains);
    updateCounter('termRelations', this.termRelations);
    updateCounter('termSources', this.termSources);
    updateCounter('extractionJobs', this.extractionJobs);
    updateCounter('translations', this.translations);
    // languages使用code作为主键，不是id
    // languagePairs有id
    updateCounter('languagePairs', this.languagePairs);
  }

  private initializeDefaultSettings() {
    const defaultSettings = [
      { key: 'ai_api_key', value: '' },
      { key: 'ai_endpoint', value: 'https://api.openai.com/v1/chat/completions' },
      { key: 'ai_model', value: 'gpt-4o-mini' },
      { key: 'data_path', value: '' },
      { key: 'default_language', value: 'auto' },
      { key: 'min_term_frequency', value: '2' },
      { key: 'min_term_length', value: '2' }
    ];

    const now = new Date().toISOString();
    defaultSettings.forEach(setting => {
      this.settings.push({
        key: setting.key,
        value: setting.value,
        updated_at: now
      });
    });
  }

  private initializeDefaultDomains() {
    // 不再加载任何默认分类，由用户完全自定义
    // 初始数据库为空，用户可以通过界面自由添加顶级分类和子分类
    console.log('初始领域分类为空，由用户完全自定义');
  }

  // 初始化默认语言配置（11种语言：中文为母语，10种外文）
  private initializeDefaultLanguages() {
    const now = new Date().toISOString();
    
    // 支持的11种语言
    const defaultLanguages = [
      // 母语：中文
      {
        code: 'zh',
        name: '中文',
        native_name: '中文',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: true,
        priority: 0
      },
      // 外文：英语
      {
        code: 'en',
        name: '英语',
        native_name: 'English',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 1
      },
      // 外文：法语
      {
        code: 'fr',
        name: '法语',
        native_name: 'Français',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 2
      },
      // 外文：西班牙语
      {
        code: 'es',
        name: '西班牙语',
        native_name: 'Español',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 3
      },
      // 外文：德语
      {
        code: 'de',
        name: '德语',
        native_name: 'Deutsch',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 4
      },
      // 外文：日语
      {
        code: 'ja',
        name: '日语',
        native_name: '日本語',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 5
      },
      // 外文：俄语
      {
        code: 'ru',
        name: '俄语',
        native_name: 'Русский',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 6
      },
      // 外文：葡萄牙语
      {
        code: 'pt',
        name: '葡萄牙语',
        native_name: 'Português',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 7
      },
      // 外文：意大利语
      {
        code: 'it',
        name: '意大利语',
        native_name: 'Italiano',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 8
      },
      // 外文：韩语
      {
        code: 'ko',
        name: '韩语',
        native_name: '한국어',
        direction: 'ltr' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 9
      },
      // 外文：阿拉伯语
      {
        code: 'ar',
        name: '阿拉伯语',
        native_name: 'العربية',
        direction: 'rtl' as const,
        enabled: true,
        is_mother_tongue: false,
        priority: 10
      }
    ];

    // 添加到语言列表
    defaultLanguages.forEach(lang => {
      // 检查是否已存在
      const existingIndex = this.languages.findIndex(l => l.code === lang.code);
      if (existingIndex === -1) {
        this.languages.push({
          ...lang,
          created_at: now
        });
      }
    });

    console.log(`初始化完成：添加了 ${this.languages.length} 种语言（1种母语 + 10种外文）`);
  }

  // 加载官方学科分类数据
  private loadOfficialDomains(now: string) {
    try {
      // 从导入的官方分类数据加载
      const officialData = officialDomainsData as any;
      
      if (officialData && Array.isArray(officialData.categories)) {
        // 第一级：学科门类（如哲学、经济学等）
        for (const category of officialData.categories) {
          // 添加第一级分类（顶级分类）
          const topLevelDomain: Domain = {
            id: category.id,
            name: category.name,
            description: category.description || `${category.name}学科分类`,
            created_at: now
          };
          this.domains.push(topLevelDomain);
          
          // 第二级：子学科（如中国哲学、外国哲学等）
          if (category.children && Array.isArray(category.children)) {
            for (const child of category.children) {
              const childDomain: Domain = {
                id: child.id,
                name: child.name,
                parent_id: category.id,
                description: child.description || `${child.name}（${category.name}下属学科）`,
                created_at: now
              };
              this.domains.push(childDomain);
              
              // 最多2级，不再添加第三级
            }
          }
        }
        
        console.log(`成功加载 ${officialData.categories.length} 个学科门类及其子学科`);
      } else {
        console.warn('官方学科分类数据格式不正确，使用默认分类');
        this.loadFallbackDomains(now);
      }
    } catch (error) {
      console.error('加载官方学科分类失败:', error);
      this.loadFallbackDomains(now);
    }
  }

  // 备用分类（如果官方分类加载失败）
  private loadFallbackDomains(now: string) {
    // 添加一些基本的默认分类（保持向后兼容）
    this.domains.push({
      id: 1,
      name: '计算机',
      description: '计算机科学与技术',
      created_at: now
    });

    this.domains.push({
      id: 2,
      name: '医学',
      description: '医学与健康',
      created_at: now
    });

    this.domains.push({
      id: 3,
      name: '法律',
      description: '法律与法规',
      created_at: now
    });
  }

  // 辅助函数：生成下一个ID（修复：检查现有最大ID）
  private getNextId(type: string): number {
    // 获取当前表中最大的ID
    let maxId = 0;
    
    switch (type) {
      case 'terms':
        if (this.terms.length > 0) {
          maxId = Math.max(...this.terms.map(t => t.id));
        }
        break;
      case 'domains':
        if (this.domains.length > 0) {
          maxId = Math.max(...this.domains.map(d => d.id));
        }
        break;
      case 'termRelations':
        if (this.termRelations.length > 0) {
          maxId = Math.max(...this.termRelations.map(r => r.id));
        }
        break;
      case 'termSources':
        if (this.termSources.length > 0) {
          maxId = Math.max(...this.termSources.map(s => s.id));
        }
        break;
      case 'extractionJobs':
        if (this.extractionJobs.length > 0) {
          maxId = Math.max(...this.extractionJobs.map(j => j.id));
        }
        break;
      case 'translations':
        if (this.translations.length > 0) {
          maxId = Math.max(...this.translations.map(t => t.id));
        }
        break;
      case 'languages':
        // 语言使用code作为主键，不是id
        maxId = 0;
        break;
      case 'languagePairs':
        if (this.languagePairs.length > 0) {
          maxId = Math.max(...this.languagePairs.map(p => p.id));
        }
        break;
    }
    
    // 确保ID不会重复
    const nextId = Math.max(this.nextId[type] || 1, maxId + 1);
    this.nextId[type] = nextId + 1;
    return nextId;
  }

  // 模拟SQLite的prepare方法
  prepare(sql: string) {
    return {
      // 简单实现，不支持参数绑定
      run: (...params: any[]) => {
        console.log('Memory DB run:', sql, params);
        return { lastInsertRowid: 0, changes: 0 };
      },
      get: (...params: any[]) => {
        console.log('Memory DB get:', sql, params);
        return null;
      },
      all: (...params: any[]) => {
        console.log('Memory DB all:', sql, params);
        return [];
      }
    };
  }

  exec(sql: string) {
    console.log('Memory DB exec:', sql);
  }

  pragma(pragma: string, options?: any) {
    console.log('Memory DB pragma:', pragma, options);
    return null;
  }

  transaction<T extends any[]>(fn: (...args: T) => void) {
    return (...args: T) => {
      console.log('Memory DB transaction started');
      try {
        fn(...args);
        console.log('Memory DB transaction committed');
      } catch (error) {
        console.log('Memory DB transaction rolled back:', error);
        throw error;
      }
    };
  }

  close() {
    console.log('Memory DB closed');
  }

  // DAO: 获取设置
  getSettings(): Record<string, string> {
    const settings: Record<string, string> = {};
    this.settings.forEach(setting => {
      settings[setting.key] = setting.value;
    });
    return settings;
  }

  setSettings(settingsObj: Record<string, any>): Record<string, string> {
    const now = new Date().toISOString();
    console.log('Memory DB: Setting settings:', settingsObj);
    
    for (const [key, value] of Object.entries(settingsObj)) {
      if (value === undefined || value === null) continue;
      
      const existingIndex = this.settings.findIndex(s => s.key === key);
      if (existingIndex !== -1) {
        this.settings[existingIndex].value = String(value);
        this.settings[existingIndex].updated_at = now;
        console.log(`Memory DB: Updated setting: ${key} = ${value}`);
      } else {
        this.settings.push({
          key,
          value: String(value),
          updated_at: now
        });
        console.log(`Memory DB: Added new setting: ${key} = ${value}`);
      }
    }
    
    // 保存到文件
    try {
      this.saveSettingsToFile();
      console.log('Memory DB: Settings saved to file');
    } catch (error) {
      console.error('Memory DB: Failed to save settings to file:', error);
    }
    
    return this.getSettings();
  }

  // 获取领域的所有后代ID（包含自身）
  private getAllDescendantDomainIds(domainId: number): number[] {
    const result: number[] = [domainId];
    const visited = new Set<number>();
    
    const findChildren = (parentId: number) => {
      if (visited.has(parentId)) return;
      visited.add(parentId);
      
      const children = this.domains.filter(d => d.parent_id === parentId);
      for (const child of children) {
        if (!result.includes(child.id)) {
          result.push(child.id);
        }
        findChildren(child.id);
      }
    };
    
    findChildren(domainId);
    return result;
  }

  // DAO: 术语操作
  getTerms(params?: {
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
    domains?: number[];
    sourceLangs?: string[];
    targetLangs?: string[];
    // 排序参数
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    let filteredTerms = [...this.terms];
    
    // ========== 语言对验证增强筛选 ==========
    // 1. 首先检查查询参数中的语言对是否符合规则
    // 获取母语代码
    const motherTongue = this.getMotherTongue();
    
    // 处理sourceLang（单个）和targetLang（单个）参数（向后兼容）
    let effectiveSourceLangs = params?.sourceLangs || [];
    let effectiveTargetLangs = params?.targetLangs || [];
    
    // 添加向后兼容的单个参数
    if (params?.sourceLang) {
      if (!effectiveSourceLangs.includes(params.sourceLang)) {
        effectiveSourceLangs = [...effectiveSourceLangs, params.sourceLang];
      }
    }
    
    // 注意：targetLang参数在向后兼容逻辑中已经处理，这里不重复添加
    // 实际筛选时会通过翻译表处理
    
    // 验证语言对规则：检查查询的语言组合是否有效
    // 规则：中文（母语）只能翻译到外文，外文只能翻译到中文
    if (effectiveSourceLangs.length > 0 && effectiveTargetLangs.length > 0) {
      // 检查所有可能的源语言-目标语言组合
      const hasInvalidPair = effectiveSourceLangs.some(sourceLang => 
        effectiveTargetLangs.some(targetLang => !this.validateLanguagePair(sourceLang, targetLang))
      );
      
      if (hasInvalidPair) {
        console.warn(`查询包含无效的语言对组合：源语言=${effectiveSourceLangs}, 目标语言=${effectiveTargetLangs}`);
        // 根据规则自动修正：过滤掉无效的组合
        // 对于前端筛选，我们可能希望返回空结果或自动修正
        // 这里选择严格模式：如果包含无效语言对，返回空结果
        return { rows: [], total: 0 };
      }
    } else if (effectiveTargetLangs.length > 0) {
      // 只有目标语言，没有源语言：检查目标语言是否有效
      // 如果目标语言包含外文，那么源语言必须是中文（母语）
      // 如果目标语言包含中文，那么源语言必须是外文
      // 这个检查可以在后续筛选时进行
    }
    
  // 基础筛选：领域（向后兼容，单个domain参数）
  if (params?.domain) {
    // 处理特殊值：null或-1 表示"未分类"（domain_id为null或undefined）
    if (params.domain === -1 || params.domain === null) {
      filteredTerms = filteredTerms.filter(term => 
        term.domain_id === null || term.domain_id === undefined
      );
    } else {
      // 获取该领域及其所有子领域的ID
      const domainIds = this.getAllDescendantDomainIds(params.domain);
      filteredTerms = filteredTerms.filter(term => 
        term.domain_id !== undefined && domainIds.includes(term.domain_id)
      );
    }
  }
    
    // 高级筛选：多领域选择
    if (params?.domains && params.domains.length > 0) {
      // 获取所有选中领域及其子领域的ID
      const allDomainIds: number[] = [];
      for (const domainId of params.domains) {
        const domainIds = this.getAllDescendantDomainIds(domainId);
        for (const id of domainIds) {
          if (!allDomainIds.includes(id)) {
            allDomainIds.push(id);
          }
        }
      }
      
      filteredTerms = filteredTerms.filter(term => 
        term.domain_id !== undefined && allDomainIds.includes(term.domain_id)
      );
    }
    
    // 源语言筛选（向后兼容，单个sourceLang参数）
    if (params?.sourceLang) {
      filteredTerms = filteredTerms.filter(term => term.source_lang === params.sourceLang);
    }
    
    // 高级筛选：多源语言选择
    if (params?.sourceLangs && params.sourceLangs.length > 0) {
      filteredTerms = filteredTerms.filter(term => params.sourceLangs!.includes(term.source_lang));
    }
    
    // 目标语言筛选（多语言系统）- 增强语言对验证
    if (params?.targetLangs && params.targetLangs.length > 0) {
      // 获取所有外文语言列表
      const foreignLanguages = this.getForeignLanguages();
      
      filteredTerms = filteredTerms.filter(term => {
        const translations = this.getTranslations(term.id);
        if (params.targetLangs!.length === 0) return true;
        
        // 检查是否有任何翻译匹配目标语言
        const hasMatchingTranslation = translations.some(t => params.targetLangs!.includes(t.language_code));
        if (!hasMatchingTranslation) return false;
        
        // 增强验证：检查术语的源语言与目标语言组合是否符合语言对规则
        const termSourceLang = term.source_lang;
        
        // 对于每个目标语言，验证语言对
        const targetLangsInTranslations = translations
          .map(t => t.language_code)
          .filter(lang => params.targetLangs!.includes(lang));
        
        // 如果术语的源语言与任何目标语言组合无效，排除该术语
        return targetLangsInTranslations.every(targetLang => 
          this.validateLanguagePair(termSourceLang, targetLang)
        );
      });
    }
    
    // 锁定状态筛选
    if (params?.locked !== undefined) {
      filteredTerms = filteredTerms.filter(term => 
        (term.locked === true) === params.locked
      );
    }
    
    // 译文状态筛选
    if (params?.hasTranslation !== undefined) {
      filteredTerms = filteredTerms.filter(term => {
        const translations = this.getTranslations(term.id);
        const hasTranslation = translations.length > 0;
        return hasTranslation === params.hasTranslation;
      });
    }
    
    // 收藏状态筛选
    if (params?.favorite !== undefined) {
      filteredTerms = filteredTerms.filter(term => 
        (term.favorite === true) === params.favorite
      );
    }
    
    // 关键词搜索
    if (params?.keyword) {
      const keyword = params.keyword.toLowerCase();
      filteredTerms = filteredTerms.filter(term =>
        term.term_text.toLowerCase().includes(keyword) ||
        (term.description && term.description.toLowerCase().includes(keyword)) ||
        (term.abbreviation && term.abbreviation.toLowerCase().includes(keyword))
      );
    }
    
    // 排序：支持多种排序字段和顺序
    const sortField = params?.sortField || 'updated_at';
    const sortOrder = params?.sortOrder || 'desc';
    
    filteredTerms.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField) {
        case 'term_text':
          // 按术语文本字母排序
          aValue = a.term_text.toLowerCase();
          bValue = b.term_text.toLowerCase();
          break;
        case 'source_lang':
          aValue = a.source_lang.toLowerCase();
          bValue = b.source_lang.toLowerCase();
          break;
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at).getTime();
          bValue = new Date(b.updated_at).getTime();
          break;
      }
      
      // 根据排序顺序比较
      if (aValue < bValue) {
        return sortOrder === 'asc' ? -1 : 1;
      } else if (aValue > bValue) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });
    
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 50;
    const offset = (page - 1) * pageSize;
    
    const total = filteredTerms.length;
    const rows = filteredTerms.slice(offset, offset + pageSize);
    
    return { rows, total };
  }

  getTermById(id: number) {
    return this.terms.find(term => term.id === id) || null;
  }

  addTerm(term: {
    source_lang: string;
    term_text: string;
    target_lang?: string;     // 向后兼容，但不使用
    target_text?: string;     // 向后兼容，但不使用
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
    // 检查术语唯一性：术语文本和源语言不能重复
    const existingTerm = this.terms.find(t => 
      t.term_text === term.term_text && t.source_lang === term.source_lang
    );
    if (existingTerm) {
      throw new Error(`术语"${term.term_text}"（${term.source_lang}）已存在，不能重复添加`);
    }

    // 标准化目标语言：外文术语→中文，中文术语→外文
    const normalizeTargetLang = (sourceLang: string, targetLang?: string): string => {
      // 外文术语 → 中文
      if (sourceLang !== 'zh') {
        return 'zh';
      }
      // 中文术语 → 外文（默认为英文，但保持有效的外文语种）
      if (!targetLang || targetLang === 'zh') {
        return 'en';
      }
      // 验证targetLang是否在支持的外文语种列表中
      const supportedLangs = ['en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];
      return supportedLangs.includes(targetLang) ? targetLang : 'en';
    };

    const now = new Date().toISOString();
    const newTerm: Term = {
      id: this.getNextId('terms'),
      source_lang: term.source_lang,
      term_text: term.term_text,
      abbreviation: term.abbreviation,
      domain_id: term.domain_id,
      description: term.description,
      created_at: now,
      updated_at: now
    };
    
    this.terms.push(newTerm);
    
    // 如果调用方明确提供了 translations 数组，直接使用（优先）
    if (term.translations && term.translations.length > 0) {
      for (const t of term.translations) {
        // 跳过同语互译
        if (t.language_code === term.source_lang) {
          console.warn(`跳过同语互译: ${term.source_lang} -> ${t.language_code}`);
          continue;
        }
        this.addTranslation({
          term_id: newTerm.id,
          language_code: t.language_code,
          text: t.text,
          confidence: t.confidence,
          source: t.source || 'import'
        });
      }
      console.log(`从 translations 数组导入了 ${term.translations.length} 条翻译记录`);
      
      // 将第一条有效译文回填到术语对象，确保术语列表和详情页能显示"术语译文"
      const validTranslations = term.translations.filter(t => 
        t.text && t.text.trim() !== '' && t.language_code !== term.source_lang
      );
      if (validTranslations.length > 0) {
        (newTerm as any).target_text = validTranslations[0].text;
        (newTerm as any).target_lang = validTranslations[0].language_code;
        console.log(`回填术语译文: target_text="${validTranslations[0].text.substring(0, 30)}", target_lang=${validTranslations[0].language_code}`);
      }
    }
    // 向后兼容：如果提供了target_lang和target_text，自动添加为翻译
    else if (term.target_lang && term.target_text) {
      // 标准化目标语言
      const normalizedTargetLang = normalizeTargetLang(term.source_lang, term.target_lang);
      // 检查是否源语言和目标语言相同（禁止同语互译）
      if (normalizedTargetLang === term.source_lang) {
        console.warn(`跳过同语互译（标准化后）：源语言和目标语言相同 (${term.source_lang} -> ${normalizedTargetLang})`);
        // 即使跳过，仍然创建默认翻译配置
        this.createDefaultTranslations(newTerm.id, term.source_lang);
      } else {
        this.addTranslation({
          term_id: newTerm.id,
          language_code: normalizedTargetLang,
          text: term.target_text,
          source: 'legacy'
        });
        console.log(`使用用户提供的翻译（标准化后）: ${term.source_lang} -> ${normalizedTargetLang}`);
      }
    } else {
      // 智能默认翻译创建：根据源语言创建合适的翻译记录
      this.createDefaultTranslations(newTerm.id, term.source_lang);
    }
    
    // 保存数据到文件
    this.saveDataToFile();
    
    return newTerm.id;
  }

  // 创建默认翻译记录（智能翻译配置）
  private createDefaultTranslations(termId: number, sourceLang: string) {
    // 支持的11种语言列表：中文（母语）+ 10种外文
    const supportedLanguages = ['zh', 'en', 'fr', 'es', 'de', 'ja', 'ru', 'pt', 'it', 'ko', 'ar'];
    
    // 避免源语言和目标语言相同的翻译
    const targetLanguages = supportedLanguages.filter(lang => lang !== sourceLang);
    
    // 根据源语言智能配置翻译
    if (sourceLang === 'zh') {
      // 中文术语：为所有10种外文创建翻译槽位
      // 获取所有外文（排除中文）
      const foreignLanguages = supportedLanguages.filter(lang => lang !== 'zh');
      
      // 按优先级排序（英语优先，其他按字母顺序）
      const orderedLanguages = ['en', ...foreignLanguages.filter(lang => lang !== 'en').sort()];
      
      for (const lang of orderedLanguages) {
        // 只创建空翻译记录，等待用户填写
        this.addTranslation({
          term_id: termId,
          language_code: lang,
          text: '',  // 空文本，等待用户填写
          source: 'default'
        });
        console.log(`为中文术语(ID:${termId})创建外文翻译槽位: ${lang}`);
      }
      console.log(`中文术语(ID:${termId})创建完成：${orderedLanguages.length}个外文翻译槽位`);
    } else {
      // 外文术语：仅创建中文翻译槽位
      // 严格遵循规则：外文术语只翻译到中文，不创建其他外文翻译槽位
      this.addTranslation({
        term_id: termId,
        language_code: 'zh',
        text: '',  // 空文本，等待用户填写
        source: 'default'
      });
      console.log(`为外文术语(ID:${termId}, 源语种:${sourceLang})创建中文翻译槽位（仅此一个）`);
      
      // 注意：不再创建英文或其他外文翻译槽位，严格遵循规则
    }
  }

  updateTerm(
    id: number,
    updates: Partial<{
      term_text: string;
      target_text: string;
      target_lang?: string;
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
    const term = this.terms.find(t => t.id === id);
    if (!term) return null;
    
    // 标准化目标语言的辅助函数
    const normalizeTargetLang = (sourceLang: string, targetLang?: string): string => {
      // 外文术语 → 中文
      if (sourceLang !== 'zh') {
        return 'zh';
      }
      // 中文术语 → 外文（默认为英文，但保持有效的外文语种）
      if (!targetLang || targetLang === 'zh') {
        return 'en';
      }
      // 验证targetLang是否在支持的外文语种列表中
      const supportedLangs = ['en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];
      return supportedLangs.includes(targetLang) ? targetLang : 'en';
    };
    
    // 处理 translations 数组：如果提供了，替换该术语的所有翻译
    if (updates.translations !== undefined) {
      // 删除该术语的现有翻译
      this.translations = this.translations.filter(t => t.term_id !== id);
      
      // 添加新的翻译
      for (const t of updates.translations) {
        // 跳过同语互译
        if (t.language_code === term.source_lang) {
          console.warn(`跳过同语互译: ${term.source_lang} -> ${t.language_code}`);
          continue;
        }
        this.addTranslation({
          term_id: id,
          language_code: t.language_code,
          text: t.text,
          confidence: t.confidence,
          source: t.source || 'manual'
        });
      }
      console.log(`更新术语ID:${id} 的翻译记录，共 ${updates.translations.length} 条`);
      
      // 将第一条有效译文回填到术语对象，确保术语列表和详情页能显示"术语译文"
      const validTranslations = updates.translations.filter(t => 
        t.text && t.text.trim() !== '' && t.language_code !== term.source_lang
      );
      if (validTranslations.length > 0) {
        (term as any).target_text = validTranslations[0].text;
        (term as any).target_lang = validTranslations[0].language_code;
        console.log(`回填术语译文（更新）: target_text="${validTranslations[0].text.substring(0, 30)}", target_lang=${validTranslations[0].language_code}`);
      }
      
      // 从 updates 中移除 translations，避免被 Object.assign 合并到 term 对象
      delete updates.translations;
    }
    
    // 如果有target_lang，确保不是同语互译
    if (updates.target_lang !== undefined) {
      const normalizedTargetLang = normalizeTargetLang(term.source_lang, updates.target_lang);
      
      // 检查是否源语言和目标语言相同（禁止同语互译）
      if (normalizedTargetLang === term.source_lang) {
        console.warn(`更新术语ID:${id} 时发现同语互译，已跳过: ${term.source_lang} -> ${updates.target_lang}`);
        // 拒绝设置相同的语言
        delete updates.target_lang;
        // 如果同时有target_text，也清除它
        if (updates.target_text !== undefined) {
          delete updates.target_text;
        }
      } else {
        // 标准化目标语言
        updates.target_lang = normalizedTargetLang;
        console.log(`更新术语ID:${id} 标准化目标语言: ${updates.target_lang} -> ${normalizedTargetLang}`);
      }
    }
    
    Object.assign(term, updates);
    return { changes: 1 };
  }

  // DAO: 领域操作
  getDomains() {
    return this.domains;
  }

  // 获取所有分类的术语计数（不分页，用于分类树显示）
  getDomainTermCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    // 初始化所有分类计数为0
    for (const domain of this.domains) {
      counts.set(domain.id, 0);
    }
    // 未分类计数
    counts.set(0, 0);
    // 统计所有术语的分类分布
    for (const term of this.terms) {
      const domainId = term.domain_id ?? 0;
      counts.set(domainId, (counts.get(domainId) || 0) + 1);
    }
    return counts;
  }

  // 获取或创建层级分类路径（支持"计算机科学技术>人工智能>机器学习"格式）
  getOrCreateDomainPath(path: string): number {
    if (!path || path.trim().length === 0) {
      throw new Error('分类路径不能为空');
    }
    
    const pathSegments = path.split('>').map(segment => segment.trim()).filter(segment => segment.length > 0);
    
    if (pathSegments.length === 0) {
      throw new Error('分类路径格式不正确');
    }
    
    let currentParentId: number | undefined = undefined;
    let currentDomainId: number | undefined = undefined;
    
    // 逐级创建或查找分类
    for (let i = 0; i < pathSegments.length; i++) {
      const segmentName = pathSegments[i];
      const isLastSegment = i === pathSegments.length - 1;
      
      // 查找是否已存在当前层级分类
      let existingDomain = this.domains.find(d => 
        d.name.toLowerCase() === segmentName.toLowerCase() && 
        d.parent_id === currentParentId
      );
      
      if (!existingDomain) {
        // 创建新分类
        try {
          const newDomainId = this.addDomain({
            name: segmentName,
            parent_id: currentParentId,
            description: isLastSegment ? `AI建议分类: ${path}` : `层级分类: ${pathSegments.slice(0, i + 1).join(' > ')}`
          });
          
          // 获取新创建的分类
          existingDomain = this.domains.find(d => d.id === newDomainId);
          if (!existingDomain) {
            throw new Error(`创建分类失败: ${segmentName}`);
          }
        } catch (error: any) {
          // 如果创建失败，尝试模糊匹配现有分类
          const similarDomains = this.domains.filter(d => 
            d.name.toLowerCase().includes(segmentName.toLowerCase()) || 
            segmentName.toLowerCase().includes(d.name.toLowerCase())
          );
          
          if (similarDomains.length > 0) {
            // 使用第一个相似分类
            existingDomain = similarDomains[0];
            console.log(`使用相似分类: ${existingDomain.name} 替代 ${segmentName}`);
          } else {
            // 如果仍然没有找到，创建简化版本
            const fallbackDomainId = this.addDomain({
              name: segmentName,
              parent_id: currentParentId,
              description: `AI建议分类（简化）: ${segmentName}`
            });
            existingDomain = this.domains.find(d => d.id === fallbackDomainId);
          }
        }
      }
      
      if (!existingDomain) {
        throw new Error(`无法创建或找到分类: ${segmentName}`);
      }
      
      currentDomainId = existingDomain.id;
      currentParentId = currentDomainId; // 下一级以此为父级
    }
    
    if (!currentDomainId) {
      throw new Error(`无法获取最终分类ID: ${path}`);
    }
    
    return currentDomainId;
  }

  // 根据名称查找领域ID（支持精确匹配和模糊匹配）
  findDomainIdByName(name: string, parentId?: number): number | null {
    // 先尝试精确匹配
    const exactMatch = this.domains.find(d => 
      d.name.toLowerCase() === name.toLowerCase() && 
      d.parent_id === parentId
    );
    
    if (exactMatch) {
      return exactMatch.id;
    }
    
    // 尝试模糊匹配（名称包含或部分匹配）
    const fuzzyMatches = this.domains.filter(d => 
      d.parent_id === parentId && (
        d.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(d.name.toLowerCase()) ||
        this.calculateSimilarity(d.name, name) > 0.7
      )
    );
    
    if (fuzzyMatches.length > 0) {
      // 返回相似度最高的
      return fuzzyMatches.sort((a, b) => 
        this.calculateSimilarity(b.name, name) - this.calculateSimilarity(a.name, name)
      )[0].id;
    }
    
    // 尝试在顶级分类中查找（忽略parentId）
    if (parentId !== undefined) {
      const topLevelMatch = this.domains.find(d => 
        d.name.toLowerCase() === name.toLowerCase() && 
        d.parent_id === undefined
      );
      
      if (topLevelMatch) {
        return topLevelMatch.id;
      }
    }
    
    return null;
  }
  
  // 计算字符串相似度（简单版）
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;
    
    // 共同字符数量
    const intersection = new Set([...s1].filter(char => s2.includes(char)));
    const union = new Set([...s1, ...s2]);
    
    return intersection.size / union.size;
  }

  addDomain(domain: { name: string; parent_id?: number; description?: string }) {
    // 1. 验证名称非空
    if (!domain.name || domain.name.trim().length === 0) {
      throw new Error('分类名称不能为空');
    }
    
    const name = domain.name.trim();
    
    // 2. 检查唯一性：相同父级下不能有重复名称
    const existingDomain = this.domains.find(d => 
      d.name.toLowerCase() === name.toLowerCase() && 
      d.parent_id === domain.parent_id
    );
    
    if (existingDomain) {
      throw new Error(`分类"${name}"已在相同父级下存在`);
    }
    
    // 3. 验证父级分类是否存在（如果提供了parent_id）
    if (domain.parent_id) {
      const parentDomain = this.domains.find(d => d.id === domain.parent_id);
      if (!parentDomain) {
        throw new Error(`父级分类(ID: ${domain.parent_id})不存在`);
      }
      
      // 4. 防止循环引用：检查父级分类不能是当前分类本身
      // 对于新建分类，这个问题不会出现，但保留逻辑完整性
    }
    
    const now = new Date().toISOString();
    const newDomain: Domain = {
      id: this.getNextId('domains'),
      name: name,
      parent_id: domain.parent_id,
      description: domain.description,
      created_at: now
    };
    
    this.domains.push(newDomain);
    
    // 保存数据到文件
    this.saveDataToFile();
    
    return newDomain.id;
  }

  updateDomain(id: number, updates: { name?: string; parent_id?: number; description?: string }) {
    const domain = this.domains.find(d => d.id === id);
    if (!domain) return null;
    
    // 1. 如果更新名称，验证名称非空
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error('分类名称不能为空');
      }
      
      const newName = updates.name.trim();
      
      // 检查唯一性：相同父级下不能有重复名称（排除自身）
      const existingDomain = this.domains.find(d => 
        d.id !== id &&  // 排除当前分类自身
        d.name.toLowerCase() === newName.toLowerCase() && 
        d.parent_id === (updates.parent_id !== undefined ? updates.parent_id : domain.parent_id)
      );
      
      if (existingDomain) {
        throw new Error(`分类"${newName}"已在相同父级下存在`);
      }
      
      domain.name = newName;
    }
    
    // 2. 如果更新父级，验证父级分类存在且不是自身
    if (updates.parent_id !== undefined) {
      // 检查父级分类是否存在
      if (updates.parent_id !== undefined && updates.parent_id !== null) {
        const parentDomain = this.domains.find(d => d.id === updates.parent_id);
        if (!parentDomain) {
          throw new Error(`父级分类(ID: ${updates.parent_id})不存在`);
        }
        
        // 防止循环引用：父级不能是自身
        if (updates.parent_id === id) {
          throw new Error('分类不能将自身设为父级');
        }
        
        // 防止循环引用：检查父级分类不能是当前分类的子分类
        const isCircular = this.checkCircularReference(id, updates.parent_id);
        if (isCircular) {
          throw new Error('循环引用错误：不能将父级设置为子分类');
        }
      }
      
      domain.parent_id = updates.parent_id;
    }
    
    // 3. 更新描述
    if (updates.description !== undefined) {
      domain.description = updates.description;
    }
    
    return domain;
  }
  
  // 辅助方法：检查循环引用
  private checkCircularReference(currentId: number, potentialParentId: number | undefined): boolean {
    if (potentialParentId === undefined || potentialParentId === null) {
      return false;
    }
    
    let currentParentId: number | undefined = potentialParentId;
    const visited = new Set<number>();
    
    while (currentParentId !== undefined && currentParentId !== null) {
      // 如果检测到循环引用
      if (currentParentId === currentId) {
        return true;
      }
      
      // 如果已经访问过，避免无限循环
      if (visited.has(currentParentId)) {
        return true;
      }
      
      visited.add(currentParentId);
      
      const parentDomain = this.domains.find(d => d.id === currentParentId);
      if (!parentDomain) {
        break;
      }
      
      currentParentId = parentDomain.parent_id;
    }
    
    return false;
  }

  // 辅助方法：递归获取某个分类的所有子分类ID（包括多级嵌套）
  private getAllChildDomainIds(parentId: number): number[] {
    const childIds: number[] = [];
    
    // 直接子分类
    const directChildren = this.domains.filter(d => d.parent_id === parentId);
    
    for (const child of directChildren) {
      childIds.push(child.id);
      // 递归获取孙子分类
      const grandChildIds = this.getAllChildDomainIds(child.id);
      childIds.push(...grandChildIds);
    }
    
    return childIds;
  }

  deleteDomain(id: number) {
    const now = new Date().toISOString();
    
    // 第一步：递归删除所有子分类
    const childDomainIds = this.getAllChildDomainIds(id);
    let deletedChildCount = 0;
    
    for (const childId of childDomainIds) {
      // 递归删除每个子分类（会触发递归更新术语）
      const childIndex = this.domains.findIndex(domain => domain.id === childId);
      if (childIndex !== -1) {
        // 先更新引用此子分类的术语
        for (const term of this.terms) {
          if (term.domain_id === childId) {
            term.domain_id = undefined;
            term.updated_at = now;
          }
        }
        // 删除子分类
        this.domains.splice(childIndex, 1);
        deletedChildCount++;
      }
    }
    
    if (deletedChildCount > 0) {
      console.log(`删除分类ID:${id}，已递归删除${deletedChildCount}个子分类`);
    }
    
    // 第一步：更新所有引用此分类的术语，将其domain_id设为undefined
    let updatedTermsCount = 0;
    for (const term of this.terms) {
      if (term.domain_id === id) {
        term.domain_id = undefined;
        term.updated_at = now;
        updatedTermsCount++;
      }
    }
    
    if (updatedTermsCount > 0) {
      console.log(`删除分类ID:${id}，已将${updatedTermsCount}个术语的领域恢复至未定义状态`);
    }
    
    // 第二步：删除分类
    const index = this.domains.findIndex(domain => domain.id === id);
    let changes = 0;
    if (index !== -1) {
      this.domains.splice(index, 1);
      changes = 1;
      console.log(`成功删除分类ID:${id}`);
    }
    
    // 保存数据到文件
    this.saveDataToFile();
    
    return { changes };
  }

  // DAO: 术语删除
  deleteTerm(id: number) {
    const termIndex = this.terms.findIndex(term => term.id === id);
    if (termIndex === -1) {
      console.warn(`[deleteTerm] 术语ID:${id} 不存在`);
      return { changes: 0 };
    }

    // 1. 删除关联的翻译记录
    const deletedTranslations = this.translations.filter(t => t.term_id === id).length;
    this.translations = this.translations.filter(t => t.term_id !== id);

    // 2. 删除关联的术语关系
    const deletedRelations = this.termRelations.filter(r => r.term_id === id || r.related_term_id === id).length;
    this.termRelations = this.termRelations.filter(r => r.term_id !== id && r.related_term_id !== id);

    // 3. 删除关联的术语来源
    if (this.termSources) {
      const deletedSources = this.termSources.filter(s => s.term_id === id).length;
      this.termSources = this.termSources.filter(s => s.term_id !== id);
      if (deletedSources > 0) {
        console.log(`[deleteTerm] 删除术语ID:${id} 的 ${deletedSources} 条来源记录`);
      }
    }

    // 4. 删除术语本身
    this.terms.splice(termIndex, 1);

    // 5. 保存数据到文件
    this.saveDataToFile();

    console.log(`[deleteTerm] 成功删除术语ID:${id}，同步删除 ${deletedTranslations} 条翻译记录、${deletedRelations} 条关系记录`);
    return { changes: 1 };
  }

  // 批量更新术语分类
  batchUpdateTermDomains(termIds: number[], domainId: number | null) {
    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const termId of termIds) {
      const term = this.terms.find(t => t.id === termId);
      if (term) {
        term.domain_id = domainId ?? undefined;
        term.updated_at = now;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.saveDataToFile();
      console.log(`[batchUpdateTermDomains] 更新 ${updatedCount} 个术语的分类为 domainId=${domainId}`);
    }

    return { changes: updatedCount };
  }

  // DAO: 术语关系操作
  addTermRelation(relation: {
    term_id: number;
    relation_type: string;
    related_term_id: number;
    note?: string;
  }) {
    const now = new Date().toISOString();
    const newRelation: TermRelation = {
      id: this.getNextId('termRelations'),
      term_id: relation.term_id,
      relation_type: relation.relation_type,
      related_term_id: relation.related_term_id,
      note: relation.note,
      created_at: now
    };
    
    this.termRelations.push(newRelation);
    return newRelation.id;
  }

  getTermRelations(termId: number) {
    const relations = this.termRelations.filter(rel => rel.term_id === termId);
    return relations.map(rel => {
      const relatedTerm = this.terms.find(t => t.id === rel.related_term_id);
      // 获取相关术语的翻译
      const translations = this.getTranslations(rel.related_term_id);
      // 查找第一个翻译作为示例
      const firstTranslation = translations.length > 0 ? translations[0] : null;
      return {
        ...rel,
        term_text: relatedTerm?.term_text || '',
        source_lang: relatedTerm?.source_lang || '',
        // 向后兼容：使用第一个翻译作为target_text
        target_text: firstTranslation?.text || '',
        target_lang: firstTranslation?.language_code || ''
      };
    });
  }

  deleteTermRelation(id: number) {
    const index = this.termRelations.findIndex(rel => rel.id === id);
    if (index !== -1) {
      this.termRelations.splice(index, 1);
    }
    return { changes: 1 };
  }

  // DAO: 术语来源操作
  addTermSource(source: {
    term_id: number;
    source_type: string;
    source_detail?: string;
    credibility_score?: number;
  }) {
    const now = new Date().toISOString();
    const newSource: TermSource = {
      id: this.getNextId('termSources'),
      term_id: source.term_id,
      source_type: source.source_type,
      source_detail: source.source_detail,
      credibility_score: source.credibility_score || 1,
      created_at: now
    };
    
    this.termSources.push(newSource);
    return newSource.id;
  }

  getTermSources(termId: number) {
    return this.termSources.filter(source => source.term_id === termId);
  }

  // DAO: 提取记录操作
  getExtractionJobs() {
    return this.extractionJobs;
  }

  addExtractionJob(job: {
    source_type: string;
    source_path?: string;
    language: string;
    item_count: number;
    note?: string;
  }) {
    const now = new Date().toISOString();
    const newJob: ExtractionJob = {
      id: this.getNextId('extractionJobs'),
      source_type: job.source_type,
      source_path: job.source_path,
      language: job.language,
      item_count: job.item_count,
      use_ai: false,
      note: job.note,
      created_at: now
    };
    
    this.extractionJobs.push(newJob);
    return newJob.id;
  }

  deleteExtractionJob(id: number) {
    const index = this.extractionJobs.findIndex(job => job.id === id);
    if (index !== -1) {
      this.extractionJobs.splice(index, 1);
    }
    return { changes: 1 };
  }

  // 数据库维护函数（模拟）
  backupDatabase(backupPath?: string) {
    console.log('Memory DB backup requested (not supported in memory database)');
    return backupPath || 'memory-backup-not-supported.json';
  }

  vacuumDatabase() {
    console.log('Memory DB vacuum completed (no-op for memory database)');
  }

  exportToJson(outputPath: string) {
    const data = {
      terms: this.terms,
      domains: this.domains,
      termRelations: this.termRelations,
      termSources: this.termSources,
      extractionJobs: this.extractionJobs,
      settings: this.getSettings(),
      translations: this.translations,
      languages: this.languages,
      languagePairs: this.languagePairs
    };
    
    console.log(`Memory DB export to ${outputPath} (not actually saved)`);
    return outputPath;
  }

  // ================== 多语言管理方法 ==================

  // 翻译管理
  addTranslation(translation: {
    term_id: number;
    language_code: string;
    text: string;
    confidence?: number;
    source?: string;
  }) {
    const now = new Date().toISOString();
    const newTranslation: TranslationRecord = {
      id: this.getNextId('translations'),
      term_id: translation.term_id,
      language_code: translation.language_code,
      text: translation.text,
      confidence: translation.confidence,
      source: translation.source,
      created_at: now,
      updated_at: now
    };
    
    this.translations.push(newTranslation);
    return newTranslation.id;
  }

  getTranslations(termId: number, languageCode?: string) {
    let translations = this.translations.filter(t => t.term_id === termId);
    if (languageCode) {
      translations = translations.filter(t => t.language_code === languageCode);
    }
    return translations;
  }

  updateTranslation(id: number, updates: {
    text?: string;
    confidence?: number;
    source?: string;
  }) {
    const translation = this.translations.find(t => t.id === id);
    if (!translation) return null;
    
    if (updates.text !== undefined) translation.text = updates.text;
    if (updates.confidence !== undefined) translation.confidence = updates.confidence;
    if (updates.source !== undefined) translation.source = updates.source;
    translation.updated_at = new Date().toISOString();
    
    return translation;
  }

  deleteTranslation(id: number) {
    const index = this.translations.findIndex(t => t.id === id);
    if (index !== -1) {
      this.translations.splice(index, 1);
    }
    return { changes: 1 };
  }

  // 语言管理
  getLanguages() {
    return this.languages;
  }

  // 获取外文语言列表（排除母语）
  getForeignLanguages(): string[] {
    return this.languages
      .filter(lang => !lang.is_mother_tongue)
      .map(lang => lang.code)
      .sort((a, b) => {
        // 按优先级排序
        const langA = this.languages.find(l => l.code === a);
        const langB = this.languages.find(l => l.code === b);
        const priorityA = langA?.priority || 999;
        const priorityB = langB?.priority || 999;
        return priorityA - priorityB;
      });
  }

  // 获取母语（通常是中文）
  getMotherTongue(): string {
    const motherTongue = this.languages.find(lang => lang.is_mother_tongue);
    return motherTongue?.code || 'zh'; // 默认返回中文
  }

  // 获取系统语言配置
  getSystemLanguageConfig() {
    const motherTongue = this.getMotherTongue();
    const foreignLanguages = this.getForeignLanguages();
    const allLanguages = [motherTongue, ...foreignLanguages];
    
    return {
      mother_tongue: motherTongue,
      foreign_languages: foreignLanguages,
      all_languages: allLanguages
    };
  }

  // 验证语言对是否符合规则
  validateLanguagePair(sourceLang: string, targetLang: string): boolean {
    // 规则1：禁止同语互译
    if (sourceLang === targetLang) return false;
    
    // 规则2：中文作为母语的特殊逻辑
    if (sourceLang === this.getMotherTongue()) {
      // 中文术语可以翻译到任何外文
      return targetLang !== this.getMotherTongue(); // 已经通过规则1确保
    } else {
      // 外文术语只能翻译到中文（母语）
      return targetLang === this.getMotherTongue();
    }
  }

  // 根据源语言获取支持的目标语言
  getSupportedTargetLanguages(sourceLang: string): string[] {
    if (sourceLang === this.getMotherTongue()) {
      // 中文术语支持所有外文
      return this.getForeignLanguages();
    } else {
      // 外文术语只支持中文
      return [this.getMotherTongue()];
    }
  }

  addLanguage(language: {
    code: string;
    name: string;
    native_name: string;
    direction: 'ltr' | 'rtl';
    enabled: boolean;
    is_mother_tongue?: boolean;
    priority?: number;
  }) {
    const now = new Date().toISOString();
    const newLanguage: LanguageRecord = {
      code: language.code,
      name: language.name,
      native_name: language.native_name,
      direction: language.direction,
      enabled: language.enabled,
      is_mother_tongue: language.is_mother_tongue || false,
      priority: language.priority || 999,
      created_at: now
    };
    
    this.languages.push(newLanguage);
    return true;
  }

  // 语言对管理
  getLanguagePairs() {
    // 排除相同语言对，实现同语互轭逻辑
    return this.languagePairs.filter(pair => pair.source_lang !== pair.target_lang);
  }

  // 获取互补语言（同语互轭逻辑）
  private getComplementaryLanguage(language: string): string {
    const complementaryMap: Record<string, string> = {
      'zh': 'en',
      'en': 'zh',
      'ja': 'zh',
      'ko': 'zh',
      'fr': 'zh',
      'de': 'zh',
      'es': 'zh',
      'ru': 'zh'
    };
    return complementaryMap[language] || 'en';
  }

  addLanguagePair(pair: {
    source_lang: string;
    target_lang: string;
    enabled: boolean;
    priority: number;
  }) {
    // 同语互轭逻辑：如果源语言和目标语言相同，自动调整为目标语言的互补语言
    let { source_lang, target_lang } = pair;
    
    if (source_lang === target_lang) {
      target_lang = this.getComplementaryLanguage(source_lang);
      console.log(`同语互轭：检测到相同语言对 ${source_lang}-${pair.target_lang}，自动调整为 ${source_lang}-${target_lang}`);
    }
    
    const now = new Date().toISOString();
    const newPair: LanguagePairRecord = {
      id: this.getNextId('languagePairs'),
      source_lang: source_lang,
      target_lang: target_lang,
      enabled: pair.enabled,
      priority: pair.priority,
      created_at: now
    };
    
    this.languagePairs.push(newPair);
    return newPair.id;
  }

  // 删除语言
  deleteLanguage(code: string) {
    const index = this.languages.findIndex(lang => lang.code === code);
    if (index !== -1) {
      this.languages.splice(index, 1);
    }
    return { changes: 1 };
  }

  // 更新语言对
  updateLanguagePair(id: number, updates: { source_lang?: string; target_lang?: string; enabled?: boolean; priority?: number }) {
    const pair = this.languagePairs.find(p => p.id === id);
    if (!pair) return null;
    
    if (updates.source_lang !== undefined) pair.source_lang = updates.source_lang;
    if (updates.target_lang !== undefined) pair.target_lang = updates.target_lang;
    if (updates.enabled !== undefined) pair.enabled = updates.enabled;
    if (updates.priority !== undefined) pair.priority = updates.priority;
    
    return pair;
  }

  // 删除语言对
  deleteLanguagePair(id: number) {
    const index = this.languagePairs.findIndex(pair => pair.id === id);
    if (index !== -1) {
      this.languagePairs.splice(index, 1);
    }
    return { changes: 1 };
  }

  // 术语锁定功能
  lockTerm(id: number) {
    const term = this.terms.find(t => t.id === id);
    if (!term) return false;
    
    term.locked = true;
    term.updated_at = new Date().toISOString();
    this.saveDataToFile();
    return true;
  }

  unlockTerm(id: number) {
    const term = this.terms.find(t => t.id === id);
    if (!term) return false;
    
    term.locked = false;
    term.updated_at = new Date().toISOString();
    this.saveDataToFile();
    return true;
  }

  batchLockTerms(termIds: number[]) {
    const now = new Date().toISOString();
    let lockedCount = 0;
    
    termIds.forEach(termId => {
      const term = this.terms.find(t => t.id === termId);
      if (term) {
        term.locked = true;
        term.updated_at = now;
        lockedCount++;
      }
    });
    
    if (lockedCount > 0) {
      this.saveDataToFile();
    }
    
    return { locked: lockedCount };
  }

  batchUnlockTerms(termIds: number[]) {
    const now = new Date().toISOString();
    let unlockedCount = 0;
    
    termIds.forEach(termId => {
      const term = this.terms.find(t => t.id === termId);
      if (term) {
        term.locked = false;
        term.updated_at = now;
        unlockedCount++;
      }
    });
    
    if (unlockedCount > 0) {
      this.saveDataToFile();
    }
    
    return { unlocked: unlockedCount };
  }

  // AI翻译建议功能
  async getAITranslationSuggestion(termId: number, targetLang: string): Promise<any> {
    // 此方法需要外部AI客户端支持，这里返回模拟数据
    // 实际实现应该调用AI翻译服务
    const term = this.getTermById(termId);
    if (!term) {
      throw new Error(`术语ID ${termId} 不存在`);
    }
    
    // 模拟AI翻译建议 - 生成基于目标语言的翻译
    const translation = this.generateTranslationSuggestion(term.term_text, term.source_lang, targetLang);
    
    return {
      term_id: termId,
      language_code: targetLang,
      text: translation,
      confidence: 0.85,
      source: 'ai_suggestion',
      abbreviation_suggestion: term.abbreviation || this.generateAbbreviationSuggestion(term.term_text)
    };
  }

  async batchGetAITranslationSuggestions(termIds: number[], targetLang: string): Promise<any[]> {
    console.log(`[Database] Starting batch translation for ${termIds.length} terms, targetLang: ${targetLang}`);
    
    // 如果没有术语ID，直接返回空数组
    if (!termIds || termIds.length === 0) {
      return [];
    }
    
    try {
      // 1. 获取AI配置
      const settings = this.getSettings();
      const aiConfig = getAIConfigFromSettings(settings);
      
      // 2. 获取术语数据
      const terms: Array<{ id: number; text: string; sourceLang: string }> = [];
      for (const termId of termIds) {
        const term = this.getTermById(termId);
        if (term) {
          terms.push({
            id: term.id,
            text: term.term_text,
            sourceLang: term.source_lang
          });
        } else {
          console.warn(`[Database] Term ${termId} not found, skipping`);
        }
      }
      
      if (terms.length === 0) {
        console.warn('[Database] No valid terms found for batch translation');
        return [];
      }
      
      // 3. 构建批量翻译请求
      const batchRequest: BatchTranslationRequest = {
        termIds: terms.map(t => t.id),
        terms,
        targetLang,
        config: aiConfig,
        mode: 'standard' // 可以使用快速模式，但保持向后兼容
      };
      
      // 4. 调用批量翻译服务
      const batchResults = await BatchTranslationService.batchGetAITranslationSuggestions(batchRequest);
      
      // 5. 转换为前端期望的格式
      const suggestions = batchResults.map(result => {
        const term = this.getTermById(result.term_id);
        return {
          term_id: result.term_id,
          language_code: targetLang,
          text: result.text,
          confidence: result.confidence,
          source: result.source || 'ai_batch_suggestion',
          abbreviation_suggestion: term?.abbreviation || this.generateAbbreviationSuggestion(term?.term_text || '')
        };
      });
      
      console.log(`[Database] Batch translation completed, ${suggestions.length} suggestions generated`);
      return suggestions;
      
    } catch (error) {
      console.error('[Database] Batch translation failed:', error);
      
      // 错误时返回降级建议（保持向后兼容）
      const fallbackSuggestions: any[] = [];
      for (const termId of termIds) {
        try {
          const suggestion = await this.getAITranslationSuggestion(termId, targetLang);
          fallbackSuggestions.push(suggestion);
        } catch (innerError) {
          console.error(`获取术语 ${termId} 的AI翻译建议失败:`, innerError);
        }
      }
      return fallbackSuggestions;
    }
  }

  // AI补全建议功能 - 使用真正的AI服务
  async getAITermSuggestion(request: {
    termId: number;
    termText: string;
    sourceLang: string;
    targetLang?: string;
    hasTranslation: boolean;
    hasDomain: boolean;
  }): Promise<any> {
    console.log('getAITermSuggestion called with request:', request);
    
    const term = this.getTermById(request.termId);
    console.log('Found term:', term);
    
    if (!term) {
      throw new Error(`术语ID ${request.termId} 不存在`);
    }
    
    try {
      // 获取AI配置
      const settings = this.getSettings();
      const aiConfig = getAIConfigFromSettings(settings);
      console.log('AI config loaded:', Object.keys(aiConfig).join(', '));
      
      // 如果没有AI配置或API Key，返回降级建议
      if (!aiConfig.apiKey || aiConfig.apiKey.trim() === '') {
        console.warn('AI配置不完整，返回降级建议');
        return this.generateFallbackSuggestions(term, request);
      }
      
      // 构建AI补全建议请求
      const aiCompletionRequest: AICompletionRequest = {
        termText: request.termText || term.term_text,
        sourceLang: request.sourceLang || term.source_lang,
        targetLang: request.targetLang || 'en',
        hasTranslation: request.hasTranslation,
        hasDomain: request.hasDomain,
        domainId: term.domain_id
      };
      
      console.log('Calling AI completion service with request:', aiCompletionRequest);
      
      // 调用AI补全建议服务
      const aiResponse = await getAITermCompletionSuggestion(aiCompletionRequest, aiConfig);
      console.log('AI completion service response:', aiResponse);
      
      // 转换响应格式以匹配前端期望
      const suggestions: any = {};
      
      if (aiResponse.translation) {
        suggestions.translation = {
          text: aiResponse.translation.text,
          lang: aiResponse.translation.lang || request.targetLang || 'en',
          confidence: aiResponse.translation.confidence || 0.8
        };
      }
      
      if (aiResponse.domain) {
        suggestions.domain = {
          id: aiResponse.domain.id,
          name: aiResponse.domain.name,
          confidence: aiResponse.domain.confidence || 0.7
        };
      }
      
      if (aiResponse.abbreviation) {
        suggestions.abbreviation = {
          text: aiResponse.abbreviation.text,
          confidence: aiResponse.abbreviation.confidence || 0.7
        };
      }
      
      if (aiResponse.definition) {
        suggestions.definition = {
          definition: aiResponse.definition.definition,
          background: aiResponse.definition.background,
          confidence: aiResponse.definition.confidence || 0.7
        };
      }
      
      console.log('Final suggestions:', suggestions);
      return suggestions;
      
    } catch (error) {
      console.error('AI补全建议服务调用失败:', error);
      console.log('回退到降级建议');
      
      // 如果AI服务失败，返回降级建议
      const term = this.getTermById(request.termId);
      if (!term) {
        throw new Error(`术语ID ${request.termId} 不存在`);
      }
      
      return this.generateFallbackSuggestions(term, request);
    }
  }
  
  // 生成降级建议（当AI服务不可用时使用）
  private generateFallbackSuggestions(term: Term, request: {
    termId: number;
    termText: string;
    sourceLang: string;
    targetLang?: string;
    hasTranslation: boolean;
    hasDomain: boolean;
  }): any {
    console.log('Generating fallback suggestions for term:', term.term_text);
    
    const suggestions: any = {};
    const defaultTargetLang = request.targetLang || 'en';
    
    // 检查是否有翻译（使用翻译表）
    const translations = this.getTranslations(term.id);
    const hasTranslation = translations.length > 0;
    
    // 如果缺少译文，提供降级翻译建议
    if (!hasTranslation && !request.hasTranslation) {
      const translationText = this.generateTranslationSuggestion(term.term_text, term.source_lang, defaultTargetLang);
      
      // 清理冗余前缀
      const cleanText = translationText
        .replace(/^\[AI翻译\] /, '')
        .replace(/^\[翻译\] /, '')
        .replace(/^AI翻译: /, '')
        .replace(/^翻译: /, '')
        .replace(/ \(Translation\)$/, '')
        .replace(/ \(翻译\)$/, '')
        .trim();
      
      suggestions.translation = {
        text: cleanText,
        lang: defaultTargetLang,
        confidence: 0.5
      };
    }
    
    // 如果缺少领域，提供降级领域建议
    if (!term.domain_id && !request.hasDomain) {
      const termLower = term.term_text.toLowerCase();
      let domainName = '计算机科学技术';
      let confidence = 0.5;
      
      if (termLower.includes('软件') || termLower.includes('代码') || termLower.includes('算法')) {
        domainName = '计算机科学技术';
        confidence = 0.7;
      } else if (termLower.includes('语言') || termLower.includes('翻译') || termLower.includes('语法')) {
        domainName = '语言学';
        confidence = 0.7;
      } else if (termLower.includes('医学') || termLower.includes('健康') || termLower.includes('疾病')) {
        domainName = '医学';
        confidence = 0.7;
      }
      
      const domain = this.domains.find(d => d.name === domainName);
      
      suggestions.domain = {
        id: domain?.id,
        name: domainName,
        confidence
      };
    }
    
    // 提供缩写建议
    const abbreviation = this.generateAbbreviationSuggestion(term.term_text);
    if (abbreviation) {
      suggestions.abbreviation = {
        text: abbreviation,
        confidence: 0.6
      };
    }
    
    return suggestions;
  }

  // 辅助方法：生成缩写建议
  private generateAbbreviationSuggestion(text: string): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return '';
    return words.map((w) => w[0]?.toUpperCase() || '').join('');
  }

  // 辅助方法：生成翻译建议，基于源语言和目标语言
  private generateTranslationSuggestion(text: string, sourceLang: string, targetLang: string): string {
    if (!text) return '';
    
    // 清理文本中的冗余前缀
    let cleanText = text;
    const redundantPrefixes = ['[AI翻译] ', '[翻译] ', 'AI翻译: ', '翻译: '];
    for (const prefix of redundantPrefixes) {
      if (cleanText.startsWith(prefix)) {
        cleanText = cleanText.substring(prefix.length);
      }
    }
    
    // 基于源语言和目标语言生成模拟翻译
    // 这里只是一个简单的模拟实现，实际应该调用AI翻译服务
    // 注意：不再添加冗余后缀，直接返回清理后的文本
    // 如果有翻译需求，应该在返回前进行实际翻译
    return cleanText;
  }
}

// 导出单例实例
let dbInstance: MemoryDatabase | null = null;

export function initDatabase(dataPath?: string) {
  console.log(`Initializing memory database (dataPath: ${dataPath || 'default'})`);
  dbInstance = new MemoryDatabase(dataPath);
  return true;
}

export function getDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

// 导出所有数据库操作方法
export function getSettings() {
  return getDatabase().getSettings();
}

export function setSettings(settings: Record<string, any>) {
  return getDatabase().setSettings(settings);
}

export function getTerms(params?: any) {
  return getDatabase().getTerms(params);
}

export function getTermById(id: number) {
  return getDatabase().getTermById(id);
}

export function addTerm(term: any) {
  return getDatabase().addTerm(term);
}

export function updateTerm(id: number, updates: any) {
  return getDatabase().updateTerm(id, updates);
}

export function deleteTerm(id: number) {
  return getDatabase().deleteTerm(id);
}

export function getDomains() {
  return getDatabase().getDomains();
}

export function getDomainTermCounts() {
  return getDatabase().getDomainTermCounts();
}

export function addDomain(domain: any) {
  return getDatabase().addDomain(domain);
}

export function updateDomain(id: number, updates: { name?: string; parent_id?: number; description?: string }) {
  return getDatabase().updateDomain(id, updates);
}

export function deleteDomain(id: number) {
  return getDatabase().deleteDomain(id);
}

// 新增：获取或创建层级分类路径
export function getOrCreateDomainPath(path: string): number {
  return getDatabase().getOrCreateDomainPath(path);
}

// 新增：根据名称查找领域ID（支持精确匹配和模糊匹配）
export function findDomainIdByName(name: string, parentId?: number): number | null {
  return getDatabase().findDomainIdByName(name, parentId);
}

export function batchUpdateTermDomains(termIds: number[], domainId: number | null) {
  return getDatabase().batchUpdateTermDomains(termIds, domainId);
}

export function addTermRelation(relation: any) {
  return getDatabase().addTermRelation(relation);
}

export function getTermRelations(termId: number) {
  return getDatabase().getTermRelations(termId);
}

export function deleteTermRelation(id: number) {
  return getDatabase().deleteTermRelation(id);
}

export function addTermSource(source: any) {
  return getDatabase().addTermSource(source);
}

export function getTermSources(termId: number) {
  return getDatabase().getTermSources(termId);
}

export function getExtractionJobs() {
  return getDatabase().getExtractionJobs();
}

export function addExtractionJob(job: any) {
  return getDatabase().addExtractionJob(job);
}

export function deleteExtractionJob(id: number) {
  return getDatabase().deleteExtractionJob(id);
}

// ================== 多语言导出方法 ==================

export function addTranslation(translation: any) {
  return getDatabase().addTranslation(translation);
}

export function getTranslations(termId: number, languageCode?: string) {
  return getDatabase().getTranslations(termId, languageCode);
}

export function updateTranslation(id: number, updates: any) {
  return getDatabase().updateTranslation(id, updates);
}

export function deleteTranslation(id: number) {
  return getDatabase().deleteTranslation(id);
}

export function getLanguages() {
  return getDatabase().getLanguages();
}

export function addLanguage(language: any) {
  return getDatabase().addLanguage(language);
}

export function getLanguagePairs() {
  return getDatabase().getLanguagePairs();
}

export function addLanguagePair(pair: any) {
  return getDatabase().addLanguagePair(pair);
}

// ================== 数据库维护函数 ==================

export function backupDatabase(backupPath?: string) {
  return getDatabase().backupDatabase(backupPath);
}

export function vacuumDatabase() {
  return getDatabase().vacuumDatabase();
}

export function exportToJson(outputPath: string) {
  return getDatabase().exportToJson(outputPath);
}

// ================== 语言和语言对管理函数 ==================

export function deleteLanguage(code: string) {
  return getDatabase().deleteLanguage(code);
}

export function updateLanguagePair(id: number, updates: { source_lang?: string; target_lang?: string; enabled?: boolean; priority?: number }) {
  return getDatabase().updateLanguagePair(id, updates);
}

export function deleteLanguagePair(id: number) {
  return getDatabase().deleteLanguagePair(id);
}

// ================== 术语锁定功能 ==================

export function lockTerm(id: number) {
  return getDatabase().lockTerm(id);
}

export function unlockTerm(id: number) {
  return getDatabase().unlockTerm(id);
}

export function batchLockTerms(termIds: number[]) {
  return getDatabase().batchLockTerms(termIds);
}

export function batchUnlockTerms(termIds: number[]) {
  return getDatabase().batchUnlockTerms(termIds);
}

// ================== AI翻译建议功能 ==================

export async function getAITranslationSuggestion(termId: number, targetLang: string): Promise<any> {
  return getDatabase().getAITranslationSuggestion(termId, targetLang);
}

export async function batchGetAITranslationSuggestions(termIds: number[], targetLang: string): Promise<any[]> {
  return getDatabase().batchGetAITranslationSuggestions(termIds, targetLang);
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
  return getDatabase().getAITermSuggestion(request);
}
