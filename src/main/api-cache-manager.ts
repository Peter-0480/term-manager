/**
 * API缓存管理器 - 减少冗余API调用，提升系统处理速度
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  key: string;
}

export interface CacheOptions {
  ttl?: number; // 缓存存活时间（毫秒），默认5分钟
  maxSize?: number; // 最大缓存条目数，默认100
  enable?: boolean; // 是否启用缓存，默认true
}

export class APICacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private maxSize: number;
  private defaultTTL: number;
  private enabled: boolean;
  
  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 100;
    this.defaultTTL = options.ttl || 5 * 60 * 1000; // 5分钟
    this.enabled = options.enable !== false;
  }
  
  /**
   * 生成缓存键
   */
  private generateKey(prefix: string, params: any): string {
    try {
      const paramStr = typeof params === 'string' ? params : JSON.stringify(params);
      return `${prefix}:${paramStr}`;
    } catch (error) {
      // 如果JSON序列化失败，使用字符串表示
      return `${prefix}:${String(params)}`;
    }
  }
  
  /**
   * 获取缓存数据
   */
  get<T>(prefix: string, params: any): T | null {
    if (!this.enabled) return null;
    
    const key = this.generateKey(prefix, params);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    console.log(`[API Cache] Cache hit for ${prefix}`);
    return entry.data as T;
  }
  
  /**
   * 设置缓存数据
   */
  set<T>(prefix: string, params: any, data: T, options?: { ttl?: number }): void {
    if (!this.enabled) return;
    
    const key = this.generateKey(prefix, params);
    const ttl = options?.ttl || this.defaultTTL;
    const now = Date.now();
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttl,
      key
    };
    
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, entry);
    console.log(`[API Cache] Cache set for ${prefix}, size: ${this.cache.size}`);
  }
  
  /**
   * 删除缓存
   */
  delete(prefix: string, params: any): void {
    const key = this.generateKey(prefix, params);
    this.cache.delete(key);
  }
  
  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    console.log('[API Cache] Cache cleared');
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    enabled: boolean;
    maxSize: number;
    defaultTTL: number;
  } {
    return {
      size: this.cache.size,
      enabled: this.enabled,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL
    };
  }
  
  /**
   * 清理过期缓存
   */
  cleanup(): number {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[API Cache] Cleaned up ${deletedCount} expired entries`);
    }
    
    return deletedCount;
  }
  
  /**
   * 查找最旧的缓存条目
   */
  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }
}

/**
 * 特定API的缓存包装器
 */
export class AICacheWrapper {
  private cacheManager: APICacheManager;
  
  constructor() {
    this.cacheManager = new APICacheManager({
      ttl: 10 * 60 * 1000, // AI结果缓存10分钟
      maxSize: 50, // AI缓存较小，因为数据较大
      enable: true
    });
  }
  
  /**
   * 缓存AI术语提取结果
   */
  async getOrExtractTerms(
    text: string,
    language: string,
    extractor: (text: string, language: string) => Promise<any[]>,
    options?: { useCache?: boolean }
  ): Promise<any[]> {
    const useCache = options?.useCache !== false;
    
    if (useCache) {
      const cached = this.cacheManager.get<any[]>('ai-terms', { text, language });
      if (cached) {
        console.log(`[AI Cache] Using cached terms for text (${text.length} chars)`);
        return cached;
      }
    }
    
    const terms = await extractor(text, language);
    
    if (useCache && terms.length > 0) {
      this.cacheManager.set('ai-terms', { text, language }, terms);
    }
    
    return terms;
  }
  
  /**
   * 缓存AI翻译结果
   */
  async getOrTranslate(
    text: string,
    sourceLang: string,
    targetLang: string,
    translator: (text: string, sourceLang: string, targetLang: string) => Promise<string>,
    options?: { useCache?: boolean }
  ): Promise<string> {
    const useCache = options?.useCache !== false;
    
    if (useCache) {
      const cached = this.cacheManager.get<string>('ai-translation', { text, sourceLang, targetLang });
      if (cached) {
        console.log(`[AI Cache] Using cached translation for "${text.substring(0, 50)}..."`);
        return cached;
      }
    }
    
    const translation = await translator(text, sourceLang, targetLang);
    
    if (useCache && translation) {
      this.cacheManager.set('ai-translation', { text, sourceLang, targetLang }, translation);
    }
    
    return translation;
  }
  
  /**
   * 清除AI相关缓存
   */
  clearAICache(): void {
    // 可以更精细地清除，但这里简单清除所有
    this.cacheManager.clear();
  }
}

/**
 * 网页内容缓存
 */
export class WebContentCache {
  private cacheManager: APICacheManager;
  
  constructor() {
    this.cacheManager = new APICacheManager({
      ttl: 30 * 60 * 1000, // 网页内容缓存30分钟
      maxSize: 20, // 网页缓存较小
      enable: true
    });
  }
  
  /**
   * 获取或抓取网页内容
   */
  async getOrFetch(
    url: string,
    fetcher: (url: string) => Promise<string>,
    options?: { useCache?: boolean }
  ): Promise<string> {
    const useCache = options?.useCache !== false;
    
    if (useCache) {
      const cached = this.cacheManager.get<string>('web-content', url);
      if (cached) {
        console.log(`[Web Cache] Using cached content for ${url}`);
        return cached;
      }
    }
    
    const content = await fetcher(url);
    
    if (useCache && content) {
      this.cacheManager.set('web-content', url, content);
    }
    
    return content;
  }
  
  /**
   * 清除网页缓存
   */
  clearWebCache(): void {
    this.cacheManager.clear();
  }
}

// 全局缓存实例
export const globalCacheManager = new APICacheManager();
export const aiCacheWrapper = new AICacheWrapper();
export const webContentCache = new WebContentCache();

/**
 * 请求合并管理器 - 合并短时间内相同的请求
 */
export class RequestMerger {
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private requestTimestamps: Map<string, number> = new Map();
  private mergeWindow: number; // 合并窗口时间（毫秒）
  private maxPendingTime: number; // 最大等待时间（毫秒），防止死锁
  
  constructor(mergeWindow: number = 1000, maxPendingTime: number = 120000) {
    this.mergeWindow = mergeWindow;
    this.maxPendingTime = maxPendingTime;
  }
  
  /**
   * 合并请求
   */
  async mergeRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    options?: { forceNew?: boolean }
  ): Promise<T> {
    const forceNew = options?.forceNew || false;
    const now = Date.now();
    const lastRequestTime = this.requestTimestamps.get(key) || 0;
    
    // 检查是否有正在进行的相同请求
    if (!forceNew && this.pendingRequests.has(key)) {
      const timeSinceLast = now - lastRequestTime;
      
      // 如果在合并窗口内，返回已有的Promise
      if (timeSinceLast < this.mergeWindow) {
        console.log(`[Request Merger] Merging request for key: ${key}`);
        return this.pendingRequests.get(key)!;
      }
      
      // 如果等待时间超过最大限制，强制创建新请求（防止死锁）
      if (timeSinceLast > this.maxPendingTime) {
        console.warn(`[Request Merger] Pending request for key "${key}" timed out (${timeSinceLast}ms > ${this.maxPendingTime}ms), creating new request`);
        this.pendingRequests.delete(key);
        this.requestTimestamps.delete(key);
      }
    }
    
    // 创建新的请求
    const requestPromise = requestFn().finally(() => {
      // 请求完成后清理
      this.pendingRequests.delete(key);
      this.requestTimestamps.delete(key);
    });
    
    this.pendingRequests.set(key, requestPromise);
    this.requestTimestamps.set(key, now);
    
    return requestPromise;
  }
  
  /**
   * 清除所有待处理请求
   */
  clear(): void {
    this.pendingRequests.clear();
    this.requestTimestamps.clear();
  }
  
  /**
   * 获取待处理请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}

// 全局请求合并器
export const globalRequestMerger = new RequestMerger();