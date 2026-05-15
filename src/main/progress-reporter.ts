// 进度报告器 - 用于网页抽取过程的进度反馈
import { BrowserWindow, ipcMain } from 'electron';

export interface ProgressEvent {
  type: 'start' | 'update' | 'complete' | 'error' | 'cancelled';
  stage: string;
  progress: number; // 0-100
  message: string;
  data?: any;
  timestamp: number;
}

export interface ProgressOptions {
  windowId?: number; // 目标窗口ID，如果未指定则发送给所有窗口
  channel?: string; // IPC通道名称
  autoStart?: boolean; // 是否自动开始
}

export class ProgressReporter {
  private currentProgress = 0;
  private currentStage = '';
  private startTime = 0;
  private isActive = false;
  private windowId?: number;
  private channel: string;
  
  constructor(options: ProgressOptions = {}) {
    this.windowId = options.windowId;
    this.channel = options.channel || 'extraction-progress';
    
    if (options.autoStart) {
      this.start('initializing', '初始化进度报告器');
    }
  }
  
  /**
   * 开始进度报告
   */
  start(stage: string, message: string, data?: any): void {
    this.currentProgress = 0;
    this.currentStage = stage;
    this.startTime = Date.now();
    this.isActive = true;
    
    this.sendEvent({
      type: 'start',
      stage,
      progress: 0,
      message,
      data,
      timestamp: Date.now(),
    });
    
    console.log(`[Progress] 开始: ${stage} - ${message}`);
  }
  
  /**
   * 更新进度
   */
  update(progress: number, message: string, data?: any): void {
    if (!this.isActive) {
      console.warn('[Progress] 尝试更新未激活的进度报告器');
      return;
    }
    
    // 确保进度在0-100范围内
    const clampedProgress = Math.max(0, Math.min(100, progress));
    this.currentProgress = clampedProgress;
    
    this.sendEvent({
      type: 'update',
      stage: this.currentStage,
      progress: clampedProgress,
      message,
      data,
      timestamp: Date.now(),
    });
    
    const elapsed = Date.now() - this.startTime;
    console.log(`[Progress] 更新: ${this.currentStage} - ${clampedProgress}% - ${message} (耗时: ${elapsed}ms)`);
  }
  
  /**
   * 更新阶段
   */
  updateStage(stage: string, progress: number, message: string, data?: any): void {
    this.currentStage = stage;
    this.update(progress, message, data);
  }
  
  /**
   * 完成进度
   */
  complete(message: string, data?: any): void {
    if (!this.isActive) {
      console.warn('[Progress] 尝试完成未激活的进度报告器');
      return;
    }
    
    this.currentProgress = 100;
    this.isActive = false;
    
    this.sendEvent({
      type: 'complete',
      stage: this.currentStage,
      progress: 100,
      message,
      data,
      timestamp: Date.now(),
    });
    
    const elapsed = Date.now() - this.startTime;
    console.log(`[Progress] 完成: ${this.currentStage} - ${message} (总耗时: ${elapsed}ms)`);
  }
  
  /**
   * 报告错误
   */
  error(error: Error | string, data?: any): void {
    this.isActive = false;
    
    const errorMessage = error instanceof Error ? error.message : error;
    
    this.sendEvent({
      type: 'error',
      stage: this.currentStage,
      progress: this.currentProgress,
      message: `错误: ${errorMessage}`,
      data: { ...data, error: error instanceof Error ? error.stack : error },
      timestamp: Date.now(),
    });
    
    console.error(`[Progress] 错误: ${this.currentStage} - ${errorMessage}`);
  }
  
  /**
   * 取消进度
   */
  cancel(message = '用户取消操作', data?: any): void {
    this.isActive = false;
    
    this.sendEvent({
      type: 'cancelled',
      stage: this.currentStage,
      progress: this.currentProgress,
      message,
      data,
      timestamp: Date.now(),
    });
    
    console.log(`[Progress] 取消: ${this.currentStage} - ${message}`);
  }
  
  /**
   * 获取当前进度
   */
  getCurrentProgress(): number {
    return this.currentProgress;
  }
  
  /**
   * 获取当前阶段
   */
  getCurrentStage(): string {
    return this.currentStage;
  }
  
  /**
   * 获取已用时间
   */
  getElapsedTime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }
  
  /**
   * 检查是否活跃
   */
  isReporting(): boolean {
    return this.isActive;
  }
  
  /**
   * 发送进度事件到前端
   */
  private sendEvent(event: ProgressEvent): void {
    try {
      // 如果指定了窗口ID，只发送给该窗口
      if (this.windowId) {
        const targetWindow = BrowserWindow.fromId(this.windowId);
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send(this.channel, event);
        }
      } else {
        // 发送给所有窗口
        BrowserWindow.getAllWindows().forEach(window => {
          if (!window.isDestroyed()) {
            window.webContents.send(this.channel, event);
          }
        });
      }
    } catch (error) {
      console.error('[Progress] 发送进度事件失败:', error);
    }
  }
}

/**
 * 创建网页抽取专用的进度报告器
 */
export function createWebExtractionProgressReporter(windowId?: number): ProgressReporter {
  return new ProgressReporter({
    windowId,
    channel: 'web-extraction-progress',
    autoStart: false,
  });
}

/**
 * 进度阶段常量
 */
export const ProgressStages = {
  INITIALIZING: 'initializing',
  URL_VALIDATION: 'url-validation',
  FETCHING: 'fetching',
  JAVASCRIPT_RENDERING: 'javascript-rendering',
  HTML_PARSING: 'html-parsing',
  TEXT_EXTRACTION: 'text-extraction',
  BILINGUAL_DETECTION: 'bilingual-detection',
  TERM_EXTRACTION: 'term-extraction',
  AI_ENHANCEMENT: 'ai-enhancement',
  FINALIZING: 'finalizing',
} as const;

/**
 * 进度消息模板
 */
export const ProgressMessages = {
  start: (url: string) => `开始网页抽取: ${url}`,
  urlValidation: '验证URL格式...',
  fetching: (url: string) => `抓取网页内容: ${url}`,
  javascriptRendering: '使用JavaScript渲染动态内容...',
  htmlParsing: '解析HTML结构...',
  textExtraction: '提取文本内容...',
  bilingualDetection: '检测双语内容...',
  termExtraction: '提取专业术语...',
  aiEnhancement: '使用AI增强术语信息...',
  finalizing: '整理提取结果...',
  complete: (termCount: number) => `抽取完成，共提取 ${termCount} 个术语`,
} as const;

/**
 * 进度估算器 - 根据阶段估算进度百分比
 */
export class ProgressEstimator {
  private stageWeights: Record<string, number>;
  
  constructor() {
    // 各阶段的权重分配（百分比）
    this.stageWeights = {
      [ProgressStages.INITIALIZING]: 5,
      [ProgressStages.URL_VALIDATION]: 5,
      [ProgressStages.FETCHING]: 30,
      [ProgressStages.JAVASCRIPT_RENDERING]: 10,
      [ProgressStages.HTML_PARSING]: 10,
      [ProgressStages.TEXT_EXTRACTION]: 10,
      [ProgressStages.BILINGUAL_DETECTION]: 10,
      [ProgressStages.TERM_EXTRACTION]: 15,
      [ProgressStages.AI_ENHANCEMENT]: 10,
      [ProgressStages.FINALIZING]: 5,
    };
  }
  
  /**
   * 获取阶段的基础进度范围
   */
  getStageProgressRange(stage: string): { start: number; end: number } {
    let accumulated = 0;
    
    // 按阶段顺序计算累积进度
    const stages = Object.keys(this.stageWeights);
    for (const s of stages) {
      const weight = this.stageWeights[s];
      if (s === stage) {
        return { start: accumulated, end: accumulated + weight };
      }
      accumulated += weight;
    }
    
    // 如果未找到阶段，返回默认范围
    return { start: 0, end: 100 };
  }
  
  /**
   * 计算阶段内的子进度
   */
  calculateSubProgress(stage: string, subProgress: number): number {
    const range = this.getStageProgressRange(stage);
    const stageProgress = range.start + (range.end - range.start) * (subProgress / 100);
    return Math.round(stageProgress);
  }
  
  /**
   * 更新权重（根据实际情况动态调整）
   */
  updateWeight(stage: string, weight: number): void {
    this.stageWeights[stage] = weight;
  }
}

// 默认进度估算器实例
export const defaultProgressEstimator = new ProgressEstimator();