import React, { useState, useEffect } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  message,
  Tree,
  TreeSelect,
  Switch,
  Tag,
  Collapse,
  Dropdown,
  Checkbox,
  Spin,
  Radio,
  Divider
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, EyeOutlined, MoreOutlined, ExportOutlined, SettingOutlined, SearchOutlined, LockOutlined, UnlockOutlined, RobotOutlined, StarOutlined } from '@ant-design/icons';
import { ipcApi } from '../ipc-api';
import TermDetail from '../components/TermDetail';
import TranslationEditor from '../components/TranslationEditor';
import type { TranslationEntry } from '../components/TranslationEditor';
import { getLanguageSelectOptions, getDefaultTargetLang, getSupportedTargetLanguages, MOTHER_TONGUE, FOREIGN_LANGUAGES, LANGUAGE_INFO, LANGUAGE_EMOJI, isForeignLanguage, isValidLanguagePair, determineTranslationDirection, getLanguagePairShortLabel, getLanguagePairLabel, getTargetLanguageSelectOptions } from '../utils/language-utils';
import '../styles/TermManager.css';

const { Header, Content, Sider } = Layout;

interface Translation {
  id?: number;
  term_id: number;
  language_code: string;
  text: string;
  confidence?: number;
  source?: 'manual' | 'ai' | 'import' | 'alignment';
  created_at?: string;
  updated_at?: string;
}

interface Term {
  id: number;
  source_lang: string;
  term_text: string;
  abbreviation?: string;
  target_lang?: string;
  target_text?: string;
  domain_id?: number;
  description?: string;
  created_at: string;
  updated_at: string;
  locked?: boolean;
  favorite?: boolean;
  translations?: Translation[]; // 多语言翻译
}

interface Domain {
  id: number;
  name: string;
  parent_id?: number;
  description?: string;
}

interface ExtractedTerm {
  index: number;
  source_term: string;                    // 源术语
  source_lang: string;                    // 源语言
  target_term?: string;                   // 目标术语（来自文件或AI）
  target_lang?: string;                   // 目标语言
  translation_source?: 'file' | 'ai' | 'none'; // 翻译来源：文件对译、AI建议或无
  translation_confidence?: number;        // 对译关系置信度
  domain_suggestion?: string;             // 完整领域路径，如"计算机科学技术>软件工程>人工智能"
  domain_confidence?: number;             // 领域建议置信度
  abbreviation_suggestion?: string;       // 缩写建议
  score: number;                          // 术语相关性得分
  description?: string;                   // 术语描述/上下文
  context?: string;                       // 术语上下文
  // 来源标注字段（与术语详情弹窗保持一致）
  source_type?: 'web_extract' | 'plain_text' | 'high_quality' | 'official' | 'manual' | 'ai_extract';
  source_detail?: string;
  credibility_score?: number;
  // 向后兼容字段
  term_text?: string;                     // 兼容旧字段，实际使用source_term
  abbreviation?: string;                  // 兼容旧字段，实际使用abbreviation_suggestion
  // 编辑状态
  isEditing?: boolean;
  selectedDomainId?: number;              // 用户选择的领域ID
}

interface SmartExtractedTerm extends ExtractedTerm {
  confidence?: number;
  isExistingTerm?: boolean;
  domainMatch?: number;
  translationValue?: number;
}

// 来源类型选项（与术语详情弹窗保持一致）
const sourceTypeOptions = [
  { label: '网络提取', value: 'web_extract' },
  { label: '普通文本', value: 'plain_text' },
  { label: '高质量文本', value: 'high_quality' },
  { label: '官方数据', value: 'official' },
  { label: '人工认证', value: 'manual' },
  { label: 'AI提取', value: 'ai_extract' }
];

// 获取术语文本（兼容新旧数据结构）
const getTermText = (term: ExtractedTerm): string => {
  return term.source_term || term.term_text || '';
};

// 获取缩写（兼容新旧数据结构）
const getAbbreviation = (term: ExtractedTerm): string => {
  return term.abbreviation_suggestion || term.abbreviation || computeAbbreviation(getTermText(term));
};

const computeAbbreviation = (text: string) => {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return '';
  return words.map((w) => w[0]?.toUpperCase() || '').join('');
};

// 标准化目标语言（译入语）- 确保外文术语目标语为中文，中文术语目标语为外文
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
  const supportedLangs = getSupportedTargetLanguages(sourceLang);
  return supportedLangs.includes(targetLang) ? targetLang : 'en';
};

// 判断术语是否可以显示多语种译入语切换
const canShowTranslationLanguageSwitch = (sourceLang: string): boolean => {
  // 只有中文术语可以显示多语种译入语切换
  // 外文术语只支持中文译入语
  return sourceLang === 'zh';
};

  // 获取领域的所有后代ID（包含自身）
  const getAllDescendantDomainIds = (domainId: number, domainsList: Domain[]): number[] => {
    // 特殊处理：-1 表示"未分类"，没有后代ID
    if (domainId === -1) {
      return [];
    }
    
    const result: number[] = [domainId];
    const visited = new Set<number>();
    
    const findChildren = (parentId: number) => {
      if (visited.has(parentId)) return;
      visited.add(parentId);
      
      const children = domainsList.filter(d => d.parent_id === parentId);
      for (const child of children) {
        if (!result.includes(child.id)) {
          result.push(child.id);
        }
        findChildren(child.id);
      }
    };
    
    findChildren(domainId);
    return result;
  };

  // 获取分类深度（需要传递domains数组）
  const getDomainDepth = (domain: Domain, domainsList: Domain[]): number => {
    let depth = 1;
    let current = domain;
    
    while (current.parent_id) {
      const parent = domainsList.find(d => d.id === current.parent_id);
      if (!parent) break;
      depth++;
      current = parent;
    }
    
    return depth;
  };

  // 获取术语的指定语种翻译
  const getTermTranslation = (term: Term, targetLang: string): string | undefined => {
    if (!term.translations || term.translations.length === 0) {
      // 向后兼容：如果没有翻译记录，使用旧的target_text字段
      if (term.target_lang === targetLang) {
        return term.target_text;
      }
      return undefined;
    }
    
    const translation = term.translations.find(t => t.language_code === targetLang);
    return translation?.text;
  };

// 获取术语的主要翻译（中文术语→英文，外文术语→中文）
const getPrimaryTranslation = (term: Term): string | undefined => {
  if (!term.translations || term.translations.length === 0) {
    // 向后兼容：如果没有翻译记录，使用旧的target_text字段
    return term.target_text;
  }
  
  const defaultLang = term.source_lang === 'zh' ? 'en' : 'zh';
  return getTermTranslation(term, defaultLang);
};

// 获取术语所有可用的翻译语种
const getAvailableTranslationLangs = (term: Term): string[] => {
  if (!term.translations) return [];
  return term.translations.map(t => t.language_code);
};

// 获取当前显示的翻译（根据源语言和全局设置）
const getDisplayedTranslation = (term: Term, targetLang?: string, globalTargetLang?: string): string | undefined => {
  // 确定显示语言：强制标准化目标语言，确保外文术语显示中文翻译，中文术语显示外文翻译
  let displayLang: string;
  
  if (term.source_lang === 'zh') {
    // 中文术语：可以使用用户指定的目标语言（如果是外文），否则使用默认英文
    if (globalTargetLang && globalTargetLang !== 'zh' && getSupportedTargetLanguages('zh').includes(globalTargetLang)) {
      displayLang = globalTargetLang;
    } else {
      // 默认使用英文，确保是外文
      displayLang = 'en';
    }
  } else {
    // 外文术语：始终显示中文翻译，忽略用户设置
    displayLang = 'zh';
  }
  
  // 如果显式提供了targetLang参数，使用它（但需要确保不违反同语互译规则）
  if (targetLang && targetLang !== term.source_lang) {
    // 确保目标语言与源语言不同
    displayLang = targetLang;
  }
  
  return getTermTranslation(term, displayLang);
};

const buildTermGroups = (terms: ExtractedTerm[]) => {
  // 过滤掉没有术语文本的项
  const validTerms = terms.filter(term => getTermText(term).trim() !== '');
  const sorted = [...validTerms].sort((a, b) => {
    const aText = getTermText(a);
    const bText = getTermText(b);
    const lenDiff = aText.length - bText.length;
    if (lenDiff !== 0) return lenDiff;
    return b.score - a.score;
  });
  const used = new Set<string>();
  const groups: Array<{ root: ExtractedTerm; children: ExtractedTerm[] }> = [];

  for (const t of sorted) {
    const termText = getTermText(t);
    if (used.has(termText)) continue;
    const children = sorted.filter((c) => {
      const cText = getTermText(c);
      return cText !== termText && cText.startsWith(termText + ' ');
    });
    children.forEach((c) => used.add(getTermText(c)));
    used.add(termText);
    groups.push({ root: t, children });
  }

  return groups;
};

const buildDomainTree = (items: Domain[], countMap: Map<number, number>) => {
  const map: Record<number, any> = {};
  
  // 递归计算某个领域及其所有子领域的术语总数
  const getTotalCount = (domainId: number): number => {
    let total = countMap.get(domainId) || 0;
    const children = items.filter(d => d.parent_id === domainId);
    for (const child of children) {
      total += getTotalCount(child.id);
    }
    return total;
  };
  
  items.forEach((item) => {
    map[item.id] = { ...item, title: item.name, key: item.id, children: [], termCount: getTotalCount(item.id) };
  });

  // 全部术语总数 = 所有领域计数之和（含未分类）
  let totalAll = 0;
  countMap.forEach((count) => {
    totalAll += count;
  });

  // 未分类术语数
  const unclassifiedCount = countMap.get(0) || 0;

  const roots: any[] = [
    { title: '全部', key: 0, termCount: totalAll, children: [] },
    { title: '未分类', key: -1, termCount: unclassifiedCount, children: [] }
  ];
  items.forEach((item) => {
    if (item.parent_id && map[item.parent_id]) {
      map[item.parent_id].children.push(map[item.id]);
    } else {
      roots.push(map[item.id]);
    }
  });

  // 对每个节点的子节点按ID排序，确保一致的显示顺序
  Object.values(map).forEach((node: any) => {
    if (node.children && node.children.length > 0) {
      node.children.sort((a: any, b: any) => a.id - b.id);
    }
  });
  
  // 对根节点的子节点也排序（不包括"全部"节点）
  roots.forEach((node: any) => {
    if (node.children && node.children.length > 0) {
      node.children.sort((a: any, b: any) => a.id - b.id);
    }
  });

  return roots;
};

const calculateDomainTreeDepth = (items: Domain[]): number => {
  if (items.length === 0) return 0;
  
  const map: Record<number, Domain> = {};
  items.forEach(item => {
    map[item.id] = item;
  });
  
  let maxDepth = 1;
  
  const calculateDepth = (item: Domain): number => {
    let depth = 1;
    let current = item;
    
    while (current.parent_id && map[current.parent_id]) {
      depth++;
      current = map[current.parent_id];
    }
    
    return depth;
  };
  
  items.forEach(item => {
    const depth = calculateDepth(item);
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  });
  
  return maxDepth;
};

  // 获取领域筛选器选项（包含"全部"和"未分类"）
  const getDomainFilterOptions = (domainsList: Domain[]) => {
    return [
      { text: '全部', value: 0 },
      { text: '未分类', value: -1 },
      ...domainsList.map(domain => ({
        text: domain.name,
        value: domain.id
      }))
    ];
  };

// 获取领域选择器选项（包含"全部"和"未分类"）
const getDomainSelectOptions = (domainsList: Domain[]) => {
  return [
    { label: '全部', value: 0 },
    { label: '未分类', value: -1 },
    ...domainsList.map(domain => ({
      label: domain.name,
      value: domain.id
    }))
  ];
};

export default function TermManager() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(false);
  const [domainCounts, setDomainCounts] = useState<Map<number, number>>(new Map());
  const [selectedDomain, setSelectedDomain] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isTextExtractVisible, setIsTextExtractVisible] = useState(false);
  const [isFileExtractVisible, setIsFileExtractVisible] = useState(false);
  const [isUrlExtractVisible, setIsUrlExtractVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<Term | null>(null);
  const [extractText, setExtractText] = useState('');
  const [extractUrl, setExtractUrl] = useState('');
  const [extractLanguage, setExtractLanguage] = useState<'auto' | 'en' | 'zh'>('auto');
  const [extractSourceType, setExtractSourceType] = useState<string>('plain_text');
  const [useAI, setUseAI] = useState(false);
  const [aiConfig, setAIConfig] = useState<{ apiKey: string; endpoint: string; promptTemplate: string; dataPath: string }>({ 
    apiKey: '', 
    endpoint: '', 
    promptTemplate: `请从以下文本中智能提取术语并提供详细信息：

文本内容：{text}
语言：{language}

请根据《中国学科分类与代码国家标准（GB/T 13745-2009）》或国际通用的学科分类体系，为每个提取的术语提供以下信息：

1. 源术语文本（source_term）
2. 源语种判断（source_language）- 判断术语主要语言（zh/en/ja/ko/fr/de/es等）
3. 学科领域建议（domain_suggestion）- 提供完整的学科领域路径，格式为"一级学科>二级学科>三级学科"，例如：
   - "计算机科学技术>软件工程>人工智能"
   - "语言学>应用语言学>翻译学"
   - "医学>临床医学>内科学"
4. 翻译建议（target_term）：
   - 如果文本中存在双语对译关系（如"人工智能 (Artificial Intelligence)"、"机器学习 (Machine Learning)"），请优先提取文件中已有的译文
   - 如果文本中没有对译关系，请根据术语所属领域提供专业的翻译建议
5. 目标语种（target_language）- 通常为另一种语言
6. 缩写建议（abbreviation_suggestion）- 如有合适的缩写
7. 领域置信度（domain_confidence）- 0-1之间的置信度分数
8. 对译关系置信度（translation_confidence）- 0-1之间，表示对译关系的可靠程度
9. 术语相关性得分（score）- 0-1之间的相关性得分

请基于术语的上下文和专业知识，提供准确、规范的学科领域分类和翻译建议。
如果无法确定具体三级学科，可只提供一级或二级分类。
对于双语文件，请特别关注翻译对关系。

返回格式为JSON数组，每个对象包含上述字段。`,
    dataPath: ''
  });
  const [siderWidth, setSiderWidth] = useState<number>(350);
  const [siderCollapsed, setSiderCollapsed] = useState<boolean>(false);
  // 拖拽相关状态
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartWidth, setDragStartWidth] = useState<number>(280);
  const [extractedTerms, setExtractedTerms] = useState<ExtractedTerm[]>([]);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<number>>(new Set());
  // 普通抽取筛选状态
  const [extractFilterText, setExtractFilterText] = useState('');
  const [extractMinFrequency, setExtractMinFrequency] = useState<number>(0);
  // 智能抽取相关状态
  const [isSmartExtractVisible, setIsSmartExtractVisible] = useState(false);
  const [smartExtractMode, setSmartExtractMode] = useState<'text' | 'file' | 'url'>('text');
  const [smartExtractText, setSmartExtractText] = useState('');
  const [smartExtractUrl, setSmartExtractUrl] = useState('');
  const [smartExtractLanguage, setSmartExtractLanguage] = useState<'auto' | 'en' | 'zh'>('auto');
  const [smartExtractedTerms, setSmartExtractedTerms] = useState<SmartExtractedTerm[]>([]);
  const [selectedSmartExtracted, setSelectedSmartExtracted] = useState<Set<number>>(new Set());
  const [extractionStrategy, setExtractionStrategy] = useState<any>(null);
  // 智能抽取筛选状态
  const [smartExtractFilterText, setSmartExtractFilterText] = useState('');
  const [smartExtractMinConfidence, setSmartExtractMinConfidence] = useState<number>(0);
  const [smartExtractMinTranslationValue, setSmartExtractMinTranslationValue] = useState<number>(0);
  const [smartExtractShowFrequency, setSmartExtractShowFrequency] = useState<boolean>(true);
  // AI状态：'off' | 'ready' | 'needs-config'
  const [aiStatus, setAiStatus] = useState<'off' | 'ready' | 'needs-config'>('off');


  
  // 内联编辑相关状态
  const [editingDomainId, setEditingDomainId] = useState<number | null>(null);
  const [editingDomainName, setEditingDomainName] = useState('');
  const [selectedDomainParentId, setSelectedDomainParentId] = useState<number | undefined>(undefined);
  
  // 右键菜单相关状态
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuDomain, setContextMenuDomain] = useState<Domain | null>(null);
  
  // 添加分类相关状态
  const [isAddingDomain, setIsAddingDomain] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainParentId, setNewDomainParentId] = useState<number | undefined>(undefined);

  // 高级搜索相关状态
  const [isAdvancedSearchVisible, setIsAdvancedSearchVisible] = useState(false);
  const [advancedSearchParams, setAdvancedSearchParams] = useState<{
    keyword: string;
    domains: number[];
    sourceLangs: string[];
    targetLangs: string[];
    locked: boolean | undefined;
    hasTranslation: boolean | undefined;
    favorite: boolean | undefined;
  }>({
    keyword: '',
    domains: [],
    sourceLangs: [],
    targetLangs: [],
    locked: undefined,
    hasTranslation: undefined,
    favorite: undefined
  });

  // 导出对话框状态
  const [isExportDialogVisible, setIsExportDialogVisible] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exportIncludeFields, setExportIncludeFields] = useState<string[]>([
    'id', 'source_lang', 'term_text', 'abbreviation', 'target_lang', 'target_text', 'domain', 'description', 'created_at', 'updated_at'
  ]);

  // 语言筛选器状态
  const [languagePairs, setLanguagePairs] = useState<any[]>([]);
  const [selectedSourceLang, setSelectedSourceLang] = useState<string>('all');
  const [selectedTargetLangs, setSelectedTargetLangs] = useState<string[]>(['all']);
  const [isLanguagePairConfigured, setIsLanguagePairConfigured] = useState<boolean>(false);
  const [showLanguagePairConfig, setShowLanguagePairConfig] = useState<boolean>(true);
  
  // 全局译入语（目标语言）设置
  const [globalTargetLang, setGlobalTargetLang] = useState<string>('en');
  
  // 当前编辑的术语ID（用于区分创建和编辑模式）
  const [editingTermId, setEditingTermId] = useState<number | null>(null);
  
  // 新增/编辑弹窗中的翻译列表状态
  const [modalTranslations, setModalTranslations] = useState<TranslationEntry[]>([]);
  
  // 内联编辑相关函数
  const startInlineEdit = (domain: Domain) => {
    setEditingDomainId(domain.id);
    setEditingDomainName(domain.name);
    setSelectedDomainParentId(domain.parent_id);
  };
  
  const cancelInlineEdit = () => {
    setEditingDomainId(null);
    setEditingDomainName('');
    setSelectedDomainParentId(undefined);
  };
  
  const saveInlineEdit = async () => {
    if (!editingDomainId || !editingDomainName.trim()) {
      message.warning('分类名称不能为空');
      return;
    }
    
    try {
      await ipcApi.updateDomain(editingDomainId, {
        name: editingDomainName.trim(),
        parent_id: selectedDomainParentId
      });
      message.success('分类更新成功');
      cancelInlineEdit();
      await loadDomains();
    } catch (error) {
      message.error('更新分类失败');
    }
  };
  
  const handleDeleteDomain = async (domainId: number, domainName: string) => {
    Modal.confirm({
      title: '删除分类',
      content: `确认删除分类"${domainName}"？该操作不可恢复，且该分类下的术语将变为无分类状态。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await ipcApi.deleteDomain(domainId);
          message.success('分类删除成功');
          await loadDomains();
        } catch (error) {
          message.error('删除分类失败');
        }
      }
    });
  };
  
  // 批量操作相关状态
  const [selectedTermIds, setSelectedTermIds] = useState<Set<number>>(new Set());
  const [isBatchDomainDialogVisible, setIsBatchDomainDialogVisible] = useState(false);
  const [batchDomainId, setBatchDomainId] = useState<number | null>(null);
  
  // AI补全建议相关状态
  const [isAICompletionVisible, setIsAICompletionVisible] = useState(false);
  const [currentTermForAI, setCurrentTermForAI] = useState<Term | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{
    translation?: { text: string; lang: string; confidence: number };
    abbreviation?: { text: string; confidence: number };
    // 注释将作为二次请求功能，不在初始建议中
  } | null>(null);
  // AI注释相关状态（二次请求）
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  const [aiCommentText, setAiCommentText] = useState('');
  const [applyCommentToTerm, setApplyCommentToTerm] = useState(false);
  const [aiCompletionLoading, setAiCompletionLoading] = useState(false);
  
  // 文件抽取进度状态
  const [fileExtractLoading, setFileExtractLoading] = useState(false);
  const [fileExtractProgress, setFileExtractProgress] = useState<string>('');
  const [fileExtractCancelToken, setFileExtractCancelToken] = useState<{ cancelled: boolean } | null>(null);

  // 智能抽取进度状态
  const [smartExtractLoading, setSmartExtractLoading] = useState(false);
  const [smartExtractProgress, setSmartExtractProgress] = useState<string>('');
  const [smartExtractCancelToken, setSmartExtractCancelToken] = useState<{ cancelled: boolean } | null>(null);
  
  const [form] = Form.useForm();
  const [settingsForm] = Form.useForm();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  // 排序状态
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const loadDomains = async () => {
    try {
      const [domainRes, countRes] = await Promise.all([
        ipcApi.getDomains(),
        ipcApi.getDomainTermCounts()
      ]);
      if (domainRes.success) {
        setDomains(domainRes.data || []);
      } else {
        message.error(domainRes.error || '获取领域失败');
      }
      if (countRes.success && countRes.data) {
        // countRes.data is { [domainId: string]: number }, convert to Map<number, number>
        const raw = countRes.data as Record<string, number>;
        const countMap = new Map<number, number>();
        for (const [key, val] of Object.entries(raw)) {
          countMap.set(Number(key), val);
        }
        setDomainCounts(countMap);
      }
    } catch {
      message.error('获取领域失败');
    }
  };

  const loadTerms = async () => {
    setLoading(true);
    try {
      // 构建搜索参数，合并高级搜索参数
      // 处理特殊领域值：0=全部（不筛选），-1=未分类（使用-1而不是null，因为后端if (params?.domain)检查null时为false）
      const domainParam = selectedDomain === 0 ? undefined : selectedDomain;
      
      const searchParams: any = {
        page,
        pageSize,
        keyword: keyword || undefined
      };
      
      // 只有当domainParam不是undefined时才添加domain参数
      if (domainParam !== undefined) {
        searchParams.domain = domainParam;
      }
      
      // 添加排序参数
      if (sortField) {
        searchParams.sortField = sortField;
        searchParams.sortOrder = sortOrder;
      }
      
      // 添加语言对过滤（可选筛选）
      if (selectedSourceLang && selectedSourceLang !== 'all') {
        searchParams.sourceLang = selectedSourceLang;
      }
      if (selectedTargetLangs && selectedTargetLangs.length > 0 && !selectedTargetLangs.includes('all')) {
        searchParams.targetLangs = selectedTargetLangs;
      }
      
      // 如果有高级搜索参数，合并到请求中
      if (advancedSearchParams.keyword) {
        searchParams.keyword = advancedSearchParams.keyword;
      }
      if (advancedSearchParams.domains && advancedSearchParams.domains.length > 0) {
        searchParams.domains = advancedSearchParams.domains;
      }
      if (advancedSearchParams.sourceLangs && advancedSearchParams.sourceLangs.length > 0) {
        searchParams.sourceLangs = advancedSearchParams.sourceLangs;
      }
      if (advancedSearchParams.targetLangs && advancedSearchParams.targetLangs.length > 0) {
        searchParams.targetLangs = advancedSearchParams.targetLangs;
      }
      if (advancedSearchParams.locked !== undefined) {
        searchParams.locked = advancedSearchParams.locked;
      }
      if (advancedSearchParams.hasTranslation !== undefined) {
        searchParams.hasTranslation = advancedSearchParams.hasTranslation;
      }
      if (advancedSearchParams.favorite !== undefined) {
        searchParams.favorite = advancedSearchParams.favorite;
      }
      
      const res = await ipcApi.getTerms(searchParams);
      if (res.success) {
        setTerms(res.data || []);
        setTotal(res.total || 0);
      } else {
        message.error(res.error || '获取术语失败');
      }
    } catch {
      message.error('获取术语失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedTermIds.size === 0) {
      message.warning('请先选择术语');
      return;
    }

    // 检查是否有锁定的术语
    const lockedTerms: Term[] = [];
    const unlockableTermIds: number[] = [];
    
    Array.from(selectedTermIds).forEach(id => {
      const term = terms.find(t => t.id === id);
      if (term) {
        if (term.locked) {
          lockedTerms.push(term);
        } else {
          unlockableTermIds.push(id);
        }
      }
    });

    // 如果所有选中的术语都已锁定
    if (lockedTerms.length === selectedTermIds.size) {
      message.error('无法删除已锁定的术语');
      return;
    }

    // 如果有部分术语已锁定
    let content = '';
    if (lockedTerms.length > 0) {
      content = `选中的 ${selectedTermIds.size} 个术语中，有 ${lockedTerms.length} 个术语已被锁定，无法删除。`;
      if (unlockableTermIds.length > 0) {
        content += ` 确认删除 ${unlockableTermIds.length} 个未锁定的术语？`;
      } else {
        return;
      }
    } else {
      content = `确认删除选中的 ${selectedTermIds.size} 个术语？此操作不可恢复。`;
    }

    Modal.confirm({
      title: '批量删除术语',
      content: content,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          // 只删除未锁定的术语
          const deletePromises = unlockableTermIds.map(id => ipcApi.deleteTerm(id));
          await Promise.all(deletePromises);
          
          message.success(`成功删除 ${unlockableTermIds.length} 个术语`);
          setSelectedTermIds(new Set());
          await loadTerms();
        } catch (error) {
          message.error('批量删除失败');
        }
      }
    });
  };

  useEffect(() => {
    loadDomains();
    loadTerms();
    loadAIConfig();
  }, []);

  useEffect(() => {
    loadTerms();
  }, [selectedDomain, keyword, page, pageSize]);

  // 拖拽事件处理
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - dragStartX;
      const newWidth = Math.max(200, Math.min(500, dragStartWidth + deltaX));
      setSiderWidth(newWidth);
      
      // 如果宽度小于一定阈值，自动折叠
      if (newWidth < 150 && !siderCollapsed) {
        setSiderCollapsed(true);
      } else if (newWidth >= 150 && siderCollapsed) {
        setSiderCollapsed(false);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (isDragging) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, [isDragging, dragStartX, dragStartWidth, siderCollapsed]);

  // 检测AI配置状态
  const checkAIStatus = (config: typeof aiConfig): 'off' | 'ready' | 'needs-config' => {
    // 更宽松的验证规则
    if (!config.apiKey || config.apiKey.trim().length < 3) {
      return 'needs-config';
    }
    if (!config.endpoint || config.endpoint.trim().length < 2) {
      return 'needs-config';
    }
    // endpoint可以是模型名称（如"gpt-4"）或URL
    return 'ready';
  };

  const loadAIConfig = async () => {
    try {
      const res = await ipcApi.getAIConfig();
      if (res.success && res.data) {
        const newConfig = {
          apiKey: res.data.apiKey || '',
          endpoint: res.data.endpoint || '',
          promptTemplate: res.data.promptTemplate || aiConfig.promptTemplate,
          dataPath: res.data.dataPath || ''
        };
        setAIConfig(newConfig);
        
        // 更新AI状态
        const status = checkAIStatus(newConfig);
        setAiStatus(status);
        
        // 如果AI未配置，但useAI是true，则自动关闭
        if (status === 'needs-config' && useAI) {
          setUseAI(false);
          message.warning('AI配置不完整，已自动关闭AI增强功能');
        }
      } else {
        setAiStatus('needs-config');
      }
    } catch {
      setAiStatus('needs-config');
    }
  };

  const saveAIConfig = async (values: { apiKey: string; endpoint: string; promptTemplate: string; dataPath: string }) => {
    try {
      const res = await ipcApi.setAIConfig(values);
      if (res.success) {
        // 立即更新本地状态
        setAIConfig(values);
        
        // 立即计算并更新AI状态
        const newStatus = checkAIStatus(values);
        setAiStatus(newStatus);
        
        // 如果AI状态为ready，保持useAI状态；否则关闭AI增强
        if (newStatus === 'needs-config' && useAI) {
          setUseAI(false);
        }
        
        // 重新加载配置以确保数据一致性
        await loadAIConfig();
        
        message.success('系统设置已保存');
        setIsSettingsVisible(false);
      } else {
        message.error(res.error || '保存失败');
      }
    } catch (error) {
      console.error('保存AI配置失败:', error);
      message.error('保存失败');
    }
  };

  const openSettings = () => {
    settingsForm.setFieldsValue(aiConfig);
    setIsSettingsVisible(true);
  };

  const exportTerms = async () => {
    try {
      const result = await ipcApi.showSaveDialog({
        title: '导出术语',
        defaultPath: `terms-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return;

      const header = ['id', 'source_lang', 'term_text', 'abbreviation', 'target_lang', 'target_text', 'domain', 'description', 'created_at', 'updated_at'];
      const rows = terms.map((t) => {
        const domain = domains.find((d) => d.id === t.domain_id)?.name || '';
        return [
          t.id,
          t.source_lang,
          t.term_text,
          t.abbreviation || '',
          t.target_lang || '',
          t.target_text || '',
          domain,
          t.description || '',
          t.created_at,
          t.updated_at
        ]
          .map((v) => `"${String(v || '').replace(/"/g, '""')}"`)
          .join(',');
      });
      const content = [header.join(','), ...rows].join('\n');
      const saveRes = await ipcApi.saveFile(result.filePath, content);
      if (saveRes.success) {
        message.success('导出成功');
      } else {
        message.error(saveRes.error || '导出失败');
      }
    } catch {
      message.error('导出失败');
    }
  };

  const importFromFile = async () => {
    try {
      const openRes = await ipcApi.showOpenDialog({
        title: '选择术语文件进行抽取',
        properties: ['openFile'],
        filters: [
          { name: '所有文件', extensions: ['*'] },
          { name: '支持的文件格式', extensions: ['txt', 'md', 'csv', 'json', 'rtf', 'xml', 'doc', 'xls', 'xlsx', 'docx', 'pdf', 'html', 'htm'] }
        ]
      });
      if (openRes.canceled || !openRes.filePaths?.length) return;

      const filePath = openRes.filePaths[0];
      
      // 设置加载状态
      setFileExtractLoading(true);
      setFileExtractProgress('正在读取文件...');
      const cancelToken = { cancelled: false };
      setFileExtractCancelToken(cancelToken);
      
      // 显示文件抽取结果Modal（先显示加载界面）
      setIsFileExtractVisible(true);
      
      try {
        // 更新进度信息
        setFileExtractProgress('正在分析文件内容...');
        
        // 检查是否需要取消
        if (cancelToken.cancelled) {
          setFileExtractLoading(false);
          setFileExtractProgress('');
          message.info('文件抽取已取消');
          return;
        }
        
        const res = await ipcApi.extractTermsFromFile(filePath, extractLanguage, useAI, aiConfig, extractSourceType);
        
        // 检查是否需要取消
        if (cancelToken.cancelled) {
          setFileExtractLoading(false);
          setFileExtractProgress('');
          return;
        }
        
        if (res.success) {
          const data = (res.data || []).map((item: any, index: number) => ({ index, ...item, abbreviation: item.abbreviation || computeAbbreviation(item.term_text) }));
          setExtractedTerms(data);
          setSelectedExtracted(new Set());
          setFileExtractProgress('文件抽取完成！');
          
          // 短暂显示完成状态，然后清除进度信息
          setTimeout(() => {
            setFileExtractLoading(false);
            setFileExtractProgress('');
          }, 1000);
        } else {
          setFileExtractLoading(false);
          setFileExtractProgress('');
          message.error(res.error || '文件抽取失败');
        }
      } catch (error) {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        console.error('File extraction error:', error);
        message.error('文件抽取失败');
      }
    } catch (error) {
      setFileExtractLoading(false);
      setFileExtractProgress('');
      console.error('File selection error:', error);
      message.error('文件选择失败');
    }
  };

  const selectDataPath = async () => {
    try {
      const openRes = await ipcApi.showOpenDialog({
        title: '选择术语数据保存目录',
        properties: ['openDirectory']
      });
      if (openRes.canceled || !openRes.filePaths?.length) return;

      const selectedPath = openRes.filePaths[0];
      // 更新表单中的 dataPath 字段
      settingsForm.setFieldsValue({ dataPath: selectedPath });
      
      // 同时更新本地状态，确保UI立即响应
      setAIConfig(prev => ({ ...prev, dataPath: selectedPath }));
      
      // 给用户反馈
      message.success(`已选择目录: ${selectedPath}`);
    } catch (error) {
      console.error('选择目录失败:', error);
      message.error('选择目录失败');
    }
  };

  const openNewTermModal = () => {
    setEditingTermId(null); // 确保为新增模式
    form.resetFields();
    // 设置默认的源语言和目标语言
    form.setFieldsValue({
      source_lang: 'zh',
      target_lang: undefined // 不设置默认值，由用户选择或根据源语言自动确定
    });
    setIsModalVisible(true);
  };

  const saveTerm = async (values: any) => {
    try {
      // 从 modalTranslations 中提取主译文（第一个非空译文）
      const primaryTranslation = modalTranslations.find(t => t.text.trim() !== '');
      const targetLang = primaryTranslation?.language_code || getDefaultTargetLang(values.source_lang);
      const targetText = primaryTranslation?.text || '';

      if (editingTermId) {
        // 编辑模式：更新现有术语
        await ipcApi.updateTerm(editingTermId, {
          source_lang: values.source_lang,
          term_text: values.term_text,
          abbreviation: values.abbreviation || computeAbbreviation(values.term_text),
          target_lang: targetLang,
          target_text: targetText,
          domain_id: values.domain_id,
          description: values.description,
          // 传递完整翻译列表
          translations: modalTranslations
            .filter(t => t.text.trim() !== '')
            .map(t => ({
              language_code: t.language_code,
              text: t.text.trim(),
              confidence: t.confidence || 1.0,
              source: 'manual' as const,
            })),
        });
        message.success('术语更新成功');
      } else {
        // 创建模式：添加新术语
        await ipcApi.addTerm({
          source_lang: values.source_lang,
          term_text: values.term_text,
          abbreviation: values.abbreviation || computeAbbreviation(values.term_text),
          target_lang: targetLang,
          target_text: targetText,
          domain_id: values.domain_id,
          description: values.description,
          // 传递完整翻译列表
          translations: modalTranslations
            .filter(t => t.text.trim() !== '')
            .map(t => ({
              language_code: t.language_code,
              text: t.text.trim(),
              confidence: t.confidence || 1.0,
              source: 'manual' as const,
            })),
        });
        message.success('新增术语成功');
      }
      setIsModalVisible(false);
      setEditingTermId(null); // 重置编辑ID
      setModalTranslations([]); // 清空翻译列表
      loadTerms();
      loadDomains(); // 刷新领域计数
    } catch (error: any) {
      if (error.message?.includes('已存在')) {
        message.error('术语已存在，请修改术语文本或源语言');
      } else {
        message.error(editingTermId ? '更新术语失败' : '新增术语失败');
      }
    }
  };

  const removeTerm = (id: number) => {
    // 检查术语是否被锁定
    const term = terms.find(t => t.id === id);
    if (term?.locked) {
      message.error('无法删除已锁定的术语');
      return;
    }
    
    Modal.confirm({
      title: '删除术语',
      content: '确认删除该术语？',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await ipcApi.deleteTerm(id);
          message.success('删除成功');
          loadTerms();
          loadDomains(); // 刷新领域计数
        } catch {
          message.error('删除失败');
        }
      }
    });
  };

  const extractFromText = async () => {
    if (!extractText.trim()) {
      message.warning('请输入要抽取的文本');
      return;
    }

    // 设置加载状态与超时保护
    setFileExtractLoading(true);
    setFileExtractProgress('正在分析文本内容...');
    const cancelToken = { cancelled: false };
    setFileExtractCancelToken(cancelToken);

    try {

      // 创建超时控制（启用AI时大文本最多等待5分钟，小文本2分钟；非AI模式缩短）
      const isAIEnabled = useAI && aiStatus === 'ready';
      const timeoutMs = isAIEnabled
        ? (extractText.length > 8000 ? 300000 : 120000)
        : 60000; // 非AI模式60秒
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`文本抽取超时（${timeoutMs / 1000}秒），请尝试减少文本量或检查网络连接`)), timeoutMs);
      });

      setFileExtractProgress(isAIEnabled ? '正在调用AI服务进行术语抽取（可能需要较长时间）...' : '正在抽取术语...');

      const res = await Promise.race([
        ipcApi.extractTermsFromText(extractText, extractLanguage, useAI, aiConfig),
        timeoutPromise
      ]);

      // 检查是否需要取消
      if (cancelToken.cancelled) {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        return;
      }

      if (res.success) {
        const data = (res.data || []).map((item: any, index: number) => ({
          index,
          ...item,
          abbreviation: item.abbreviation || computeAbbreviation(item.term_text),
          // 添加来源标注：文本抽取默认为普通文本
          source_type: 'plain_text',
          credibility_score: 3,
          source_detail: '文本抽取'
        }));
        setExtractedTerms(data);
        setSelectedExtracted(new Set());
        setFileExtractProgress('文本抽取完成！');
        
        // 如果后端返回了警告信息（例如AI失败但返回空结果），显示给用户
        if (res.warning) {
          setTimeout(() => {
            message.warning(res.warning);
          }, 500);
        }
        
        setTimeout(() => {
          setFileExtractLoading(false);
          setFileExtractProgress('');
        }, 1000);
      } else {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        message.error(res.error || '抽取失败');
      }
    } catch (error) {
      setFileExtractLoading(false);
      setFileExtractProgress('');
      message.error(error instanceof Error ? error.message : '抽取失败');
    }
  };
  const extractFromUrl = async () => {
    if (!extractUrl.trim()) {
      message.warning('请输入要抽取的URL');
      return;
    }

    // 设置加载状态与超时保护
    setFileExtractLoading(true);
    setFileExtractProgress('正在抓取网页内容...');
    const cancelToken = { cancelled: false };
    setFileExtractCancelToken(cancelToken);

    try {
      // 创建超时控制（URL抽取通常涉及网页抓取+AI，使用较长超时）
      const isAIEnabled = useAI && aiStatus === 'ready';
      const timeoutMs = isAIEnabled ? 300000 : 120000; // AI模式5分钟，非AI模式2分钟
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`URL网页抽取超时（${timeoutMs / 1000}秒），请确认URL可访问并检查网络连接`)), timeoutMs);
      });

      if (cancelToken.cancelled) {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        return;
      }

      const res = await Promise.race([
        ipcApi.extractTermsFromUrl(extractUrl, extractLanguage, useAI, aiConfig),
        timeoutPromise
      ]);

      // 检查是否需要取消
      if (cancelToken.cancelled) {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        return;
      }

      if (res.success) {
        const data = (res.data || []).map((item: any, index: number) => ({ 
          index, 
          ...item, 
          abbreviation: item.abbreviation || computeAbbreviation(item.term_text),
          // 添加来源标注：URL抽取默认为网络提取
          source_type: 'web_extract',
          credibility_score: 3,
          source_detail: `URL: ${extractUrl}`
        }));
        setExtractedTerms(data);
        setSelectedExtracted(new Set());
        setFileExtractProgress('URL抽取完成！');
        
        // 如果后端返回了警告信息（例如AI失败但返回空结果），显示给用户
        if (res.warning) {
          setTimeout(() => {
            message.warning(res.warning);
          }, 500);
        }
        
        setTimeout(() => {
          setFileExtractLoading(false);
          setFileExtractProgress('');
        }, 1000);
      } else {
        setFileExtractLoading(false);
        setFileExtractProgress('');
        message.error(res.error || '抽取失败');
      }
    } catch (error) {
      setFileExtractLoading(false);
      setFileExtractProgress('');
      message.error(error instanceof Error ? error.message : '抽取失败');
    }
  };

  const addExtractedTerms = async () => {
    const selected = Array.from(selectedExtracted);
    if (selected.length === 0) {
      message.warning('请选择要导入的抽取术语');
      return;
    }

    try {
      const toAdd = selected.map((idx) => extractedTerms.find((item) => item.index === idx)).filter(Boolean) as ExtractedTerm[];
      
      // 批量导入，捕获所有错误
      const results = await Promise.allSettled(toAdd.map(async (t) => {
        // 确定源语言 - 优先使用抽取术语的源语言，如果未定义则尝试从术语文本中检测
        let sourceLang = t.source_lang;
        
        // 如果源语言未定义，尝试根据术语文本内容判断
        if (!sourceLang || sourceLang === 'auto') {
          const termText = getTermText(t);
          // 简单的中英文检测逻辑
          if (/[\u4e00-\u9fff]/.test(termText)) {
            sourceLang = 'zh';
          } else {
            // 默认假设为英文或其他外文
            sourceLang = 'en';
          }
        }
        
        // 构建术语数据 - 使用 translations 数组实现要素模块一一对应
        // 与 saveTerm（添加术语弹窗）保持相同的数据结构规格
        const termData: any = {
          source_lang: sourceLang,
          term_text: getTermText(t),
          abbreviation: getAbbreviation(t),
          domain_id: t.domain_suggestion || null,  // 导入术语优先使用AI建议的领域
          description: t.description || t.context || ''  // 保留抽取结果的描述/上下文
        };
        
        // 构建翻译数组：从抽取结果中提取翻译建议
        const translations: Array<{ language_code: string; text: string; confidence?: number; source?: string }> = [];
        
        if (t.target_term && t.target_lang) {
          // 标准化目标语言
          const normalizedTargetLang = normalizeTargetLang(sourceLang, t.target_lang);
          
          if (normalizedTargetLang !== sourceLang) {
            // 添加翻译记录
            translations.push({
              language_code: normalizedTargetLang,
              text: t.target_term,
              confidence: t.translation_confidence || 0.5,
              source: 'extraction'
            });
            // 将主译文同步到 termData 顶层字段（与 saveTerm 规格统一）
            termData.target_lang = normalizedTargetLang;
            termData.target_text = t.target_term;
            console.log(`[导入] 翻译记录: ${sourceLang} -> ${normalizedTargetLang}: ${t.target_term.substring(0, 30)}...`);
          } else {
            // 标准化为同语时，强制设置为正确目标语言
            const forcedTargetLang = sourceLang === 'zh' ? 'en' : 'zh';
            translations.push({
              language_code: forcedTargetLang,
              text: t.target_term,
              confidence: t.translation_confidence || 0.5,
              source: 'extraction'
            });
            // 将主译文同步到 termData 顶层字段（与 saveTerm 规格统一）
            termData.target_lang = forcedTargetLang;
            termData.target_text = t.target_term;
            console.log(`[导入] 强制修复同语互译: ${sourceLang} -> ${forcedTargetLang}: ${t.target_term.substring(0, 30)}...`);
          }
        }
        // 如果没有翻译建议，不添加空翻译记录（让后端自动创建默认配置）
        
        // 将翻译数组附加到术语数据中（与 saveTerm 规格统一）
        termData.translations = translations;
        
        // 添加术语并获取ID
        const result = await ipcApi.addTerm(termData);
        if (result.success) {
          const termId = result.data;
          // 添加术语来源信息
          const sourceData = {
            term_id: termId,
            source_type: t.source_type || 'plain_text',
            source_detail: t.source_detail || '抽取导入',
            credibility_score: t.credibility_score || 3
          };
          await ipcApi.addTermSource(sourceData);
          console.log(`已为术语添加来源标注: ${getTermText(t)} -> ${sourceData.source_type}`);
        }
        return result;
      }));
      
      // 统计成功和失败的数量
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      let successMessage = '';
      let warningMessage = '';
      
      if (successes.length > 0) {
        successMessage = `成功导入 ${successes.length} 个抽取术语`;
      }
      
      if (failures.length > 0) {
        // 获取失败的术语信息
        const failedTerms = failures.map((f, index) => {
          const t = toAdd[index];
          if (t) {
            return getTermText(t);
          }
          return '未知术语';
        }).filter(Boolean);
        
        warningMessage = `有 ${failures.length} 个术语导入失败（可能已存在）：${failedTerms.slice(0, 3).join(', ')}${failedTerms.length > 3 ? '...' : ''}`;
      }
      
      // 如果有成功导入的，显示成功消息
      if (successes.length > 0) {
        message.success(successMessage);
      }
      
      // 如果有失败的，显示警告消息
      if (failures.length > 0) {
        message.warning(warningMessage);
      }
      
      // 只有全部失败时才显示错误消息
      if (successes.length === 0 && failures.length > 0) {
        message.error('导入抽取术语失败，所有术语都已存在或发生错误');
      }
      
      // 刷新术语列表
      loadTerms();
      
      // 如果所有术语都成功导入，关闭窗口并清空选择
      if (failures.length === 0) {
        setIsTextExtractVisible(false);
        setExtractedTerms([]);
        setSelectedExtracted(new Set());
      } else {
        // 如果有失败，只清除成功导入的选择
        const failedIndices = failures.map((_, index) => toAdd[index]?.index).filter(Boolean) as number[];
        const newSelected = new Set(selectedExtracted);
        failedIndices.forEach(index => newSelected.add(index));
        setSelectedExtracted(newSelected);
      }
    } catch (error) {
      console.error('导入抽取术语失败:', error);
      message.error('导入抽取术语失败');
    }
  };

  const openTermDetail = (term: Term) => {
    setSelectedTerm(term);
    setIsDetailVisible(true);
  };

  const handleTermUpdate = () => {
    loadTerms();
  };

  // 术语锁定/解锁功能
  const toggleTermLock = async (id: number, locked: boolean) => {
    try {
      await ipcApi.updateTerm(id, { locked });
      message.success(`已${locked ? '锁定' : '解锁'}术语`);
      loadTerms();
    } catch (error) {
      message.error(`${locked ? '锁定' : '解锁'}术语失败`);
    }
  };

  // 术语收藏/取消收藏功能
  const toggleTermFavorite = async (id: number, favorite: boolean) => {
    try {
      await ipcApi.updateTerm(id, { favorite });
      message.success(`已${favorite ? '收藏' : '取消收藏'}术语`);
      loadTerms();
    } catch (error) {
      message.error(`${favorite ? '收藏' : '取消收藏'}术语失败`);
    }
  };

  // 智能抽取方法
  const loadDefaultStrategy = async () => {
    try {
      const res = await ipcApi.getDefaultExtractionStrategy();
      if (res.success) {
        // Inject AI config from current state and set mode based on useAI
        const strategy = { ...res.data };
        strategy.aiConfig = {
          apiKey: aiConfig.apiKey,
          endpoint: aiConfig.endpoint,
          model: (aiConfig as any).model || 'gpt-4',
          promptTemplate: aiConfig.promptTemplate,
          dataPath: aiConfig.dataPath,
        };
        strategy.mode = useAI && aiStatus === 'ready' ? 'hybrid' : 'rules-only';
        setExtractionStrategy(strategy);
      }
    } catch {
      // ignore
    }
  };

  const smartExtractFromText = async () => {
    if (!smartExtractText.trim()) {
      message.warning('请输入要抽取的文本');
      return;
    }

    try {
      // 设置加载状态
      setSmartExtractLoading(true);
      setSmartExtractProgress('正在分析文本...');
      const cancelToken = { cancelled: false };
      setSmartExtractCancelToken(cancelToken);

      // 检查是否需要取消
      if (cancelToken.cancelled) {
        setSmartExtractLoading(false);
        setSmartExtractProgress('');
        return;
      }

      // 创建超时控制（大文本最多等待5分钟，小文本2分钟）
      const timeoutMs = smartExtractText.length > 8000 ? 300000 : 120000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`智能抽取超时（${timeoutMs / 1000}秒），请尝试减少文本量或检查网络连接`)), timeoutMs);
      });
      
      const res = await Promise.race([
        ipcApi.smartExtractTermsFromText(smartExtractText, smartExtractLanguage, extractionStrategy),
        timeoutPromise
      ]);
      
      // 检查是否需要取消
      if (cancelToken.cancelled) {
        setSmartExtractLoading(false);
        setSmartExtractProgress('');
        return;
      }

      if (res.success) {
        const data = (res.data || []).map((item: any, index: number) => ({ 
          index, 
          ...item, 
          abbreviation: item.abbreviation || computeAbbreviation(item.term_text),
          confidence: item.confidence || 0,
          isExistingTerm: item.isExistingTerm || false,
          translationValue: item.translationValue || 0
        }));
        setSmartExtractedTerms(data);
        setSelectedSmartExtracted(new Set());
        setSmartExtractProgress('智能抽取完成！');
        
        // 短暂显示完成状态，然后清除进度信息
        setTimeout(() => {
          setSmartExtractLoading(false);
          setSmartExtractProgress('');
        }, 1000);
        message.success(`智能抽取完成，找到 ${data.length} 个专业术语`);
      } else {
        setSmartExtractLoading(false);
        setSmartExtractProgress('');
        message.error(res.error || '智能抽取失败');
      }
    } catch (error) {
      setSmartExtractLoading(false);
      setSmartExtractProgress('');
      console.error('Smart extraction error:', error);
      message.error(error instanceof Error ? error.message : '智能抽取失败');
    }
  };

  const smartExtractFromFile = async () => {
    try {
      const openRes = await ipcApi.showOpenDialog({
        title: '选择文件进行智能抽取',
        properties: ['openFile'],
        filters: [
          { name: '支持的文件格式', extensions: ['txt', 'md', 'csv', 'json', 'rtf', 'xml', 'doc', 'xls', 'xlsx', 'docx', 'pdf', 'html', 'htm'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (openRes.canceled || !openRes.filePaths?.length) return;

      const filePath = openRes.filePaths[0];
      const ext = filePath.split('.').pop()?.toLowerCase();
      
      // 设置加载状态
      setSmartExtractLoading(true);
      setSmartExtractProgress('正在读取文件...');
      const cancelToken = { cancelled: false };
      setSmartExtractCancelToken(cancelToken);

      // 检查是否需要取消
      if (cancelToken.cancelled) {
        setSmartExtractLoading(false);
        setSmartExtractProgress('');
        return;
      }

      try {
        // PDF文件且AI已启用 → 使用AI Vision模式（支持图片型PDF）
        const isPDFWithAI = ext === 'pdf' && useAI && aiStatus === 'ready';
        
        let res: any;
        
        if (isPDFWithAI) {
          setSmartExtractProgress('正在使用AI视觉解析PDF（支持扫描件/图片型PDF）...');
          
          res = await ipcApi.extractTermsFromPDFWithAI(
            filePath,
            smartExtractLanguage,
            {
              apiKey: aiConfig.apiKey,
              endpoint: aiConfig.endpoint,
              model: (aiConfig as any).model || 'gpt-4',
              promptTemplate: aiConfig.promptTemplate,
              dataPath: aiConfig.dataPath,
            },
            (progress: any) => {
              if (!cancelToken.cancelled) {
                setSmartExtractProgress(`AI Vision PDF: ${progress.message || 'Processing...'} (${progress.currentPage || 0}/${progress.totalPages || '?'} pages)`);
              }
            }
          );
        } else {
          // 更新进度信息
          setSmartExtractProgress('正在分析文件内容...');

          res = await ipcApi.smartExtractTermsFromFile(filePath, smartExtractLanguage, extractionStrategy);
        }
        
        // 检查是否需要取消
        if (cancelToken.cancelled) {
          setSmartExtractLoading(false);
          setSmartExtractProgress('');
          return;
        }

        if (res.success) {
          const data = (res.data || []).map((item: any, index: number) => ({ 
            index, 
            ...item, 
            abbreviation: item.abbreviation || computeAbbreviation(item.term_text),
            confidence: item.confidence || 0,
            isExistingTerm: item.isExistingTerm || false,
            translationValue: item.translationValue || 0
          }));
          setSmartExtractedTerms(data);
          setSelectedSmartExtracted(new Set());
          setSmartExtractProgress('智能抽取完成！');
          
          // 短暂显示完成状态，然后清除进度信息
          setTimeout(() => {
            setSmartExtractLoading(false);
            setSmartExtractProgress('');
          }, 1000);
          message.success(`智能抽取完成，找到 ${data.length} 个专业术语`);
        } else {
          setSmartExtractLoading(false);
          setSmartExtractProgress('');
          message.error(res.error || '智能抽取失败');
        }
      } catch (error) {
        setSmartExtractLoading(false);
        setSmartExtractProgress('');
        console.error('Smart extraction error:', error);
        message.error('智能抽取失败');
      }
    } catch (error) {
      setSmartExtractLoading(false);
      setSmartExtractProgress('');
      console.error('File selection error:', error);
      message.error('文件选择失败');
    }
  };

  const smartExtractFromUrl = async () => {
    if (!smartExtractUrl.trim()) {
      message.warning('请输入要抽取的URL');
      return;
    }

    try {
      const res = await ipcApi.smartExtractTermsFromUrl(smartExtractUrl, smartExtractLanguage, extractionStrategy);
      if (res.success) {
        const data = (res.data || []).map((item: any, index: number) => ({ 
          index, 
          ...item, 
          abbreviation: item.abbreviation || computeAbbreviation(item.term_text),
          confidence: item.confidence || 0,
          isExistingTerm: item.isExistingTerm || false,
          translationValue: item.translationValue || 0
        }));
        setSmartExtractedTerms(data);
        setSelectedSmartExtracted(new Set());
        message.success(`智能抽取完成，找到 ${data.length} 个专业术语`);
      } else {
        message.error(res.error || '智能抽取失败');
      }
    } catch (error) {
      console.error('Smart extraction error:', error);
      message.error('智能抽取失败');
    }
  };

  // 普通抽取批量操作方法
  const handleSelectAllExtracted = () => {
    const filtered = getFilteredExtractedTerms();
    const allIndices = filtered.map(term => term.index);
    setSelectedExtracted(new Set(allIndices));
  };

  const handleInvertExtractedSelection = () => {
    const filtered = getFilteredExtractedTerms();
    const filteredIndices = new Set(filtered.map(term => term.index));
    const next = new Set(selectedExtracted);
    
    filteredIndices.forEach(index => {
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
    });
    
    setSelectedExtracted(next);
  };

  const handleClearExtractedSelection = () => {
    setSelectedExtracted(new Set());
  };

  const handleSelectByFrequency = (minFrequency: number) => {
    const filtered = getFilteredExtractedTerms();
    const selected = new Set(selectedExtracted);
    
    filtered.forEach(term => {
      if (term.score !== undefined && term.score >= minFrequency) {
        selected.add(term.index);
      }
    });
    
    setSelectedExtracted(selected);
  };

  // 获取筛选后的普通抽取术语
  const getFilteredExtractedTerms = (): ExtractedTerm[] => {
    return extractedTerms.filter(term => {
      // 文本筛选
      if (extractFilterText && !getTermText(term).toLowerCase().includes(extractFilterText.toLowerCase())) {
        return false;
      }
      // 词频筛选
      if (extractMinFrequency > 0 && (term.score === undefined || term.score < extractMinFrequency)) {
        return false;
      }
      return true;
    });
  };

  const addSmartExtractedTerms = async () => {
    const selected = Array.from(selectedSmartExtracted);
    if (selected.length === 0) {
      message.warning('请选择要导入的智能抽取术语');
      return;
    }

    try {
      const toAdd = selected.map((idx) => smartExtractedTerms.find((item) => item.index === idx)).filter(Boolean) as SmartExtractedTerm[];
      
      // 批量导入，捕获所有错误
      const results = await Promise.allSettled(toAdd.map(async (t) => {
        // 确定源语言
        const sourceLang = t.source_lang || 'zh';
        
        // 构建术语数据 - 与 saveTerm（添加术语弹窗）保持相同的数据结构规格
        const termData: any = {
          source_lang: sourceLang,
          term_text: getTermText(t),
          abbreviation: getAbbreviation(t),
          domain_id: (t as any).domain_suggestion || (t as any).domain_id || null,  // 优先使用AI建议的领域
          description: (t as any).description || (t as any).context || (t.translationValue ? `翻译价值评分: ${t.translationValue}/10` : '')  // 保留抽取结果的描述/上下文
        };
        
        // 构建翻译数组：从智能抽取结果中提取翻译建议
        const translations: Array<{ language_code: string; text: string; confidence?: number; source?: string }> = [];
        
        if (t.target_term && t.target_lang) {
          // 标准化目标语言
          const normalizedTargetLang = normalizeTargetLang(sourceLang, t.target_lang);
          
          if (normalizedTargetLang !== sourceLang) {
            // 添加翻译记录
            translations.push({
              language_code: normalizedTargetLang,
              text: t.target_term,
              confidence: t.translationValue ? Math.min(t.translationValue / 10, 1) : 0.5,
              source: 'smart-extraction'
            });
            // 将主译文同步到 termData 顶层字段（与 saveTerm 规格统一）
            termData.target_lang = normalizedTargetLang;
            termData.target_text = t.target_term;
            console.log(`[智能导入] 翻译记录: ${sourceLang} -> ${normalizedTargetLang}: ${t.target_term.substring(0, 30)}...`);
          } else {
            // 标准化为同语时，强制设置为正确目标语言
            const forcedTargetLang = sourceLang === 'zh' ? 'en' : 'zh';
            translations.push({
              language_code: forcedTargetLang,
              text: t.target_term,
              confidence: t.translationValue ? Math.min(t.translationValue / 10, 1) : 0.5,
              source: 'smart-extraction'
            });
            // 将主译文同步到 termData 顶层字段（与 saveTerm 规格统一）
            termData.target_lang = forcedTargetLang;
            termData.target_text = t.target_term;
            console.log(`[智能导入] 强制修复同语互译: ${sourceLang} -> ${forcedTargetLang}: ${t.target_term.substring(0, 30)}...`);
          }
        }
        // 如果没有翻译建议，不添加空翻译记录（让后端自动创建默认配置）
        
        // 将翻译数组附加到术语数据中（与 saveTerm 规格统一）
        termData.translations = translations;

        return await ipcApi.addTerm(termData);
      }));
      
      // 统计成功和失败的数量
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      let successMessage = '';
      let warningMessage = '';
      
      if (successes.length > 0) {
        successMessage = `成功导入 ${successes.length} 个智能抽取术语`;
      }
      
      if (failures.length > 0) {
        // 获取失败的术语信息
        const failedTerms = failures.map((f, index) => {
          const t = toAdd[index];
          if (t) {
            return getTermText(t);
          }
          return '未知术语';
        }).filter(Boolean);
        
        warningMessage = `有 ${failures.length} 个术语导入失败（可能已存在）：${failedTerms.slice(0, 3).join(', ')}${failedTerms.length > 3 ? '...' : ''}`;
      }
      
      // 如果有成功导入的，显示成功消息
      if (successes.length > 0) {
        message.success(successMessage);
      }
      
      // 如果有失败的，显示警告消息
      if (failures.length > 0) {
        message.warning(warningMessage);
      }
      
      // 只有全部失败时才显示错误消息
      if (successes.length === 0 && failures.length > 0) {
        message.error('导入智能抽取术语失败，所有术语都已存在或发生错误');
      }
      
      // 刷新术语列表
      loadTerms();
      
      // 如果所有术语都成功导入，关闭窗口并清空选择
      if (failures.length === 0) {
        setIsSmartExtractVisible(false);
        setSmartExtractedTerms([]);
        setSelectedSmartExtracted(new Set());
      } else {
        // 如果有失败，只清除成功导入的选择
        const failedIndices = failures.map((_, index) => toAdd[index]?.index).filter(Boolean) as number[];
        const newSelected = new Set(selectedSmartExtracted);
        failedIndices.forEach(index => newSelected.add(index));
        setSelectedSmartExtracted(newSelected);
      }
    } catch (error) {
      console.error('导入智能抽取术语失败:', error);
      message.error('导入智能抽取术语失败');
    }
  };

  const openSmartExtract = (mode: 'text' | 'file' | 'url') => {
    setSmartExtractMode(mode);
    setIsSmartExtractVisible(true);
    loadDefaultStrategy();
    // 重置筛选状态
    setSmartExtractFilterText('');
    setSmartExtractMinConfidence(0);
    setSmartExtractMinTranslationValue(0);
  };

  // 智能抽取批量操作方法
  const handleSelectAllSmartExtracted = () => {
    const filtered = getFilteredSmartExtractedTerms();
    const allIndices = filtered.map(term => term.index);
    setSelectedSmartExtracted(new Set(allIndices));
  };

  const handleInvertSelection = () => {
    const filtered = getFilteredSmartExtractedTerms();
    const filteredIndices = new Set(filtered.map(term => term.index));
    const next = new Set(selectedSmartExtracted);
    
    filteredIndices.forEach(index => {
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
    });
    
    setSelectedSmartExtracted(next);
  };

  const handleClearSelection = () => {
    setSelectedSmartExtracted(new Set());
  };

  const handleSelectByConfidence = (minConfidence: number) => {
    const filtered = getFilteredSmartExtractedTerms();
    const selected = new Set(selectedSmartExtracted);
    
    filtered.forEach(term => {
      if (term.confidence !== undefined && term.confidence >= minConfidence) {
        selected.add(term.index);
      }
    });
    
    setSelectedSmartExtracted(selected);
  };

  const handleSelectByTranslationValue = (minValue: number) => {
    const filtered = getFilteredSmartExtractedTerms();
    const selected = new Set(selectedSmartExtracted);
    
    filtered.forEach(term => {
      if (term.translationValue !== undefined && term.translationValue >= minValue) {
        selected.add(term.index);
      }
    });
    
    setSelectedSmartExtracted(selected);
  };

  // 获取筛选后的智能抽取术语
  const getFilteredSmartExtractedTerms = (): SmartExtractedTerm[] => {
    return smartExtractedTerms.filter(term => {
      // 文本筛选
      const termText = getTermText(term);
      if (smartExtractFilterText && !termText.toLowerCase().includes(smartExtractFilterText.toLowerCase())) {
        return false;
      }
      // 置信度筛选
      if (smartExtractMinConfidence > 0 && (term.confidence === undefined || term.confidence < smartExtractMinConfidence)) {
        return false;
      }
      // 翻译价值筛选
      if (smartExtractMinTranslationValue > 0 && (term.translationValue === undefined || term.translationValue < smartExtractMinTranslationValue)) {
        return false;
      }
      return true;
    });
  };

  // AI补全建议功能
  const showAICompletion = async (term: Term) => {
    setCurrentTermForAI(term);
    // 重置AI注释相关状态，确保每个术语独立
    setAiCommentText('');
    setApplyCommentToTerm(false);
    // 立即显示弹窗
    setIsAICompletionVisible(true);
    // 设置加载状态
    setAiCompletionLoading(true);

    try {
      console.log('Requesting AI suggestion for term:', term);

      // 确定目标语言（译入语）：强制标准化目标语言，确保外文术语目标语为中文，中文术语目标语为外文
      // 修复问题：不使用全局设置，而是根据术语的源语言强制标准化
      let targetLang: string;

      if (term.source_lang === 'zh') {
        // 中文术语：默认使用英文作为目标语言
        // 如果术语已有目标语言且是有效的外文（非中文），使用它
        if (term.target_lang && term.target_lang !== 'zh' && getSupportedTargetLanguages('zh').includes(term.target_lang)) {
          targetLang = term.target_lang;
        } else {
          // 默认使用英文，确保是外文
          targetLang = 'en';
        }
      } else {
        // 外文术语：始终使用中文作为目标语言
        targetLang = 'zh';
      }

      console.log('AI补全目标语言（标准化后）:', targetLang);

      // 调用AI服务获取建议
      const res = await ipcApi.getAITermSuggestion({
        termId: term.id,
        termText: term.term_text,
        sourceLang: term.source_lang,
        targetLang: targetLang, // 使用标准化后的译入语
        hasTranslation: !!term.target_text,
        hasDomain: !!term.domain_id
      });

      console.log('AI suggestion response:', res);
      console.log('Target language for AI completion:', targetLang);

      if (res.success && res.data) {
        // 修正AI返回的建议数据，确保翻译建议的语言标签与当前译入语一致
        const correctedSuggestions = { ...res.data };
        if (correctedSuggestions.translation) {
          // 如果AI返回的翻译建议语言标签不正确，修正为当前目标语言
          correctedSuggestions.translation = {
            ...correctedSuggestions.translation,
            lang: targetLang // 确保使用当前译入语
          };
        }
        setAiSuggestions(correctedSuggestions);
      } else {
        console.error('AI suggestion failed:', res.error);
        message.error(res.error || '获取AI建议失败');
      }
    } catch (error: any) {
      console.error('AI建议请求失败:', error);
      message.error(`请求AI建议失败: ${error.message || '未知错误'}`);
    } finally {
      setAiCompletionLoading(false);
    }
  };

  const handleApplyAISuggestion = async () => {
    if (!currentTermForAI) return;
    
    // 在函数作用域声明updates，确保所有内部函数都能访问
    const updates: any = {};
    let hasUpdates = false;
    
    try {
      // 应用AI建议（译文和缩写）
      if (aiSuggestions) {
        // 应用译文建议
        if (aiSuggestions.translation && !currentTermForAI.target_text) {
          updates.target_text = aiSuggestions.translation.text;
          updates.target_lang = aiSuggestions.translation.lang || currentTermForAI.target_lang;
          console.log('应用译文建议:', aiSuggestions.translation.text);
          hasUpdates = true;
        }
        
        // 注：领域建议已从初始AI建议中移除，因为用户反馈AI领域建议质量不高
        // 用户可以通过手动选择或使用搜索来分配领域
        
        // 应用简称建议（问题三：确保缩写被应用）
        if (aiSuggestions.abbreviation) {
          // 如果已有缩写，询问是否覆盖；如果没有缩写，直接应用
          const abbreviationText = aiSuggestions.abbreviation.text;
          if (currentTermForAI.abbreviation && currentTermForAI.abbreviation.trim() !== '') {
            // 使用Modal确认而不是浏览器confirm，因为Electron中confirm可能有问题
            Modal.confirm({
              title: '覆盖缩写确认',
              content: `术语已有缩写"${currentTermForAI.abbreviation}"，是否覆盖为AI建议的缩写"${abbreviationText}"？`,
              onOk: () => {
                updates.abbreviation = abbreviationText;
                console.log('应用缩写建议（覆盖）:', abbreviationText);
                hasUpdates = true;
                // 在确认后继续执行后续更新
                executeUpdates();
              },
              onCancel: () => {
                console.log('用户取消覆盖缩写');
                // 用户取消覆盖缩写，但仍然检查是否有其他更新（包括注释）
                checkForOtherUpdates();
              }
            });
            // 由于Modal.confirm是异步的，我们需要提前返回
            return;
          } else {
            updates.abbreviation = abbreviationText;
            console.log('应用缩写建议:', abbreviationText);
            hasUpdates = true;
          }
        }
      }
      
      // 应用AI注释到术语描述字段
      if (applyCommentToTerm && aiCommentText && aiCommentText.trim() !== '') {
        updates.description = aiCommentText.trim();
        console.log('应用AI注释到术语描述字段:', aiCommentText.substring(0, 50) + '...');
        hasUpdates = true;
      }
      
      // 如果有需要更新的字段
      if (hasUpdates && Object.keys(updates).length > 0) {
        await executeUpdates();
      } else {
        message.info('没有需要应用的AI建议');
      }
    } catch (error) {
      console.error('应用AI建议失败:', error);
      message.error('应用AI建议失败');
    }
    
    // 辅助函数：执行更新操作
    async function executeUpdates() {
      console.log('更新字段:', updates);
      await ipcApi.updateTerm(currentTermForAI!.id, updates);
      message.success('AI建议已应用');
      setIsAICompletionVisible(false);
      setCurrentTermForAI(null);
      setAiSuggestions(null);
      // 重置AI注释相关状态
      setAiCommentText('');
      setApplyCommentToTerm(false);
      loadTerms();
    }
    
    // 辅助函数：检查是否有其他更新（当用户取消覆盖缩写时）
    function checkForOtherUpdates() {
      const otherUpdates: any = {};
      let otherHasUpdates = false;
      
      // 检查是否有译文更新
      if (aiSuggestions?.translation && !currentTermForAI!.target_text) {
        otherUpdates.target_text = aiSuggestions.translation.text;
        otherUpdates.target_lang = aiSuggestions.translation.lang || currentTermForAI!.target_lang;
        otherHasUpdates = true;
      }
      
      // 检查是否有注释更新
      if (applyCommentToTerm && aiCommentText && aiCommentText.trim() !== '') {
        otherUpdates.description = aiCommentText.trim();
        otherHasUpdates = true;
      }
      
      if (otherHasUpdates) {
        // 执行其他更新
        ipcApi.updateTerm(currentTermForAI!.id, otherUpdates).then(() => {
          message.success('部分AI建议已应用');
          setIsAICompletionVisible(false);
          setCurrentTermForAI(null);
          setAiSuggestions(null);
          setAiCommentText('');
          setApplyCommentToTerm(false);
          loadTerms();
        }).catch(error => {
          console.error('应用部分AI建议失败:', error);
          message.error('应用部分AI建议失败');
        });
      } else {
        message.info('没有需要应用的AI建议');
      }
    }
  };

  // 注：表头筛选功能已通过Ant Design Table的filterDropdown和filters属性实现
  // 不再需要单独的状态管理

  const columns = [
    {
      title: '术语原文',
      dataIndex: 'term_text',
      key: 'term_text',
      width: 260,
      filters: [
        { text: '中文', value: 'zh' },
        { text: '英文', value: 'en' },
        { text: '法文', value: 'fr' },
        { text: '西班牙文', value: 'es' },
        { text: '德文', value: 'de' },
        { text: '日文', value: 'ja' },
        { text: '俄文', value: 'ru' },
        { text: '葡萄牙文', value: 'pt' },
        { text: '意大利文', value: 'it' },
        { text: '韩文', value: 'ko' },
        { text: '阿拉伯文', value: 'ar' }
      ],
      onFilter: (value: React.Key | boolean, record: Term) => {
        return record.source_lang === value;
      },
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      render: (text: string, record: Term) => (
        <>
          <Tag color="blue">{record.source_lang}</Tag>
          {text}
        </>
      )
    },
    {
      title: '术语译文',
      dataIndex: 'target_text',
      key: 'target_text',
      width: 240,
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => {
        // 解析当前筛选条件
        const filterValue = selectedKeys[0] ? JSON.parse(selectedKeys[0]) : { language: [], translationStatus: 'all' };
        
  // 语种选项
  const languageOptions = [
    { label: '中文', value: 'zh' },
    { label: '英文', value: 'en' },
    { label: '法文', value: 'fr' },
    { label: '西班牙文', value: 'es' },
    { label: '德文', value: 'de' },
    { label: '日文', value: 'ja' },
    { label: '俄文', value: 'ru' },
    { label: '葡萄牙文', value: 'pt' },
    { label: '意大利文', value: 'it' },
    { label: '韩文', value: 'ko' },
    { label: '阿拉伯文', value: 'ar' }
  ];
        
        // 译文状态选项
        const translationStatusOptions = [
          { label: '全部', value: 'all' },
          { label: '有译文', value: 'has_translation' },
          { label: '无译文', value: 'no_translation' }
        ];
        
        return (
          <div style={{ padding: 8, width: 220 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: '#666' }}>语种筛选</div>
              <Select
                mode="multiple"
                placeholder="选择目标语种"
                value={filterValue.language}
                onChange={(value) => {
                  const newFilter = { ...filterValue, language: value };
                  setSelectedKeys([JSON.stringify(newFilter)]);
                }}
                style={{ width: '100%' }}
                options={languageOptions}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: '#666' }}>译文状态筛选</div>
              <Select
                placeholder="选择译文状态"
                value={filterValue.translationStatus}
                onChange={(value) => {
                  const newFilter = { ...filterValue, translationStatus: value };
                  setSelectedKeys([JSON.stringify(newFilter)]);
                }}
                style={{ width: '100%' }}
                options={translationStatusOptions}
              />
            </div>
            <Space>
              <Button
                type="primary"
                onClick={() => confirm()}
                size="small"
                style={{ width: 90 }}
              >
                筛选
              </Button>
              <Button
                onClick={() => {
                  // 重置为默认值
                  setSelectedKeys([JSON.stringify({ language: [], translationStatus: 'all' })]);
                  clearFilters();
                }}
                size="small"
                style={{ width: 90 }}
              >
                重置
              </Button>
            </Space>
          </div>
        );
      },
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      onFilter: (value: React.Key | boolean, record: Term) => {
        if (!value) return true;
        
        try {
          const filterValue = JSON.parse(String(value));
          const { language = [], translationStatus = 'all' } = filterValue;
          
          // 语种筛选逻辑
          let languageMatch = true;
          if (language.length > 0) {
            // 如果选择了语种，则记录的目标语言必须匹配其中一个
            languageMatch = record.target_lang ? language.includes(record.target_lang) : false;
          }
          
          // 译文状态筛选逻辑
          let translationStatusMatch = true;
          if (translationStatus === 'has_translation') {
            translationStatusMatch = !!(record.target_text && record.target_text.trim() !== '');
          } else if (translationStatus === 'no_translation') {
            translationStatusMatch = !record.target_text || record.target_text.trim() === '';
          }
          
          // 两个条件都需要满足（AND逻辑）
          return languageMatch && translationStatusMatch;
        } catch (error) {
          console.error('Filter parsing error:', error);
          return true;
        }
      },
      render: (text: string, record: Term) => {
        // 获取当前显示的翻译
        const displayedTranslation = getDisplayedTranslation(record, globalTargetLang);
        
        // 根据getDisplayedTranslation的内部逻辑确定实际显示的语言
        let targetLang: string;
        if (record.source_lang === 'zh') {
          // 中文术语：可以使用用户指定的目标语言（如果是外文），否则使用默认英文
          if (globalTargetLang && globalTargetLang !== 'zh' && getSupportedTargetLanguages('zh').includes(globalTargetLang)) {
            targetLang = globalTargetLang;
          } else {
            // 默认使用英文，确保是外文
            targetLang = 'en';
          }
        } else {
          // 外文术语：始终显示中文翻译，忽略用户设置
          targetLang = 'zh';
        }
        
        if (displayedTranslation) {
          // 有译文：显示语言标签和译文
          return <><Tag color="green">{targetLang}</Tag>{displayedTranslation}</>;
        } else {
          // 无译文：显示语言标签和待翻译状态（消除空状态）
          return <><Tag color="orange">{targetLang}</Tag><span style={{color: '#999', fontStyle: 'italic'}}>待翻译</span></>;
        }
      }
    },
    {
      title: '领域',
      dataIndex: 'domain_id',
      key: 'domain_id',
      width: 120,
      filters: getDomainFilterOptions(domains),
      onFilter: (value: React.Key | boolean, record: Term) => {
        // 处理特殊值：0=全部（显示所有记录），-1=未分类（null）
        // 注意：value可能是字符串或数字，需要转换为数字比较
        const numValue = Number(value);
        if (numValue === 0) {
          return true; // 全部：不过滤
        } else if (numValue === -1) {
          return record.domain_id === null || record.domain_id === undefined;
        } else {
          // 获取选定分类及其所有子分类的ID，检查术语的domain_id是否在其中
          const selectedDomainIds = getAllDescendantDomainIds(numValue, domains);
          return record.domain_id !== undefined && selectedDomainIds.includes(record.domain_id);
        }
      },
      filterMultiple: true,
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      render: (id: number) => {
        // 处理"全部"和"未分类"的特殊情况
        if (id === 0) {
          return <Tag color="blue">全部</Tag>;
        } else if (id === -1) {
          return <Tag color="orange">未分类</Tag>;
        }
        
        const domain = domains.find((d) => d.id === id);
        return domain ? <Tag>{domain.name}</Tag> : '-';
      }
    },
    {
      title: '简称',
      dataIndex: 'abbreviation',
      key: 'abbreviation',
      width: 80,
      filters: [
        { text: '有简称', value: 'has_abbreviation' },
        { text: '无简称', value: 'no_abbreviation' }
      ],
      onFilter: (value: React.Key | boolean, record: Term) => {
        if (value === 'has_abbreviation') {
          return !!record.abbreviation && record.abbreviation.trim() !== '';
        } else if (value === 'no_abbreviation') {
          return !record.abbreviation || record.abbreviation.trim() === '';
        }
        return true;
      },
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      render: (text: string) => text || '-'
    },
    {
      title: '收藏',
      dataIndex: 'favorite',
      key: 'favorite',
      width: 80,
      filters: [
        { text: '已收藏', value: true },
        { text: '未收藏', value: false }
      ],
      onFilter: (value: React.Key | boolean, record: Term) => {
        if (value === true) {
          return !!record.favorite;
        } else if (value === false) {
          return !record.favorite;
        }
        return true;
      },
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      render: (favorite: boolean | undefined, record: Term) => {
        const isFavorited = favorite === true;
        return (
          <Button
            type="text"
            size="small"
            icon={<StarOutlined style={{ color: isFavorited ? '#faad14' : '#d9d9d9' }} />}
            onClick={() => toggleTermFavorite(record.id, !isFavorited)}
            title={isFavorited ? '取消收藏' : '添加到收藏'}
          />
        );
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      fixed: 'right' as const,
      render: (_: any, record: Term) => {
        // 判断术语是否需要AI补全建议
        // 检查同语互译：如果目标语言与源语言相同，视为无效翻译
        const hasSameLangTranslation = record.target_text && record.target_lang && record.target_lang === record.source_lang;
        // 检查翻译是否有效：有翻译文本且不是同语互译
        const hasValidTranslation = record.target_text && !hasSameLangTranslation;
        const needsAICompletion = !record.locked && (!hasValidTranslation || !record.domain_id);
        
        return (
          <Space>
            <Button
              size="small"
              type="primary"
              icon={<EyeOutlined />}
              onClick={() => openTermDetail(record)}
            />
            {!record.locked && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  form.setFieldsValue(record);
                  setEditingTermId(record.id); // 设置编辑模式
                  setIsModalVisible(true);
                }}
                title="编辑术语"
              />
            )}
            {needsAICompletion && (
              <Button
                size="small"
                type="default"
                icon={<RobotOutlined />}
                onClick={() => showAICompletion(record)}
                title="AI补全建议"
              />
            )}
            {record.locked ? (
              <Button 
                size="small" 
                type="default"
                icon={<LockOutlined />}
                onClick={() => toggleTermLock(record.id, false)}
                title="解锁术语（当前已锁定）"
              />
            ) : (
              <Button 
                size="small" 
                type="default"
                icon={<UnlockOutlined />}
                onClick={() => toggleTermLock(record.id, true)}
                title="锁定术语（当前未锁定）"
              />
            )}
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeTerm(record.id)} />
          </Space>
        );
      }
    }
  ];

  // 表格行选择配置
  const rowSelection = {
    selectedRowKeys: Array.from(selectedTermIds),
    onChange: (selectedRowKeys: React.Key[]) => {
      setSelectedTermIds(new Set(selectedRowKeys.map(k => Number(k))));
    },
    getCheckboxProps: (record: Term) => ({
      disabled: false,
      name: record.term_text,
    }),
  };

  return (
    <Layout className="term-manager" style={{ height: '100vh' }}>
      <Header style={{ 
        color: '#fff', 
        padding: '0 24px', 
        background: '#001529',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h2 style={{ color: '#fff', margin: 0 }}>术语管理</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* 搜索框 */}
          <Input.Search
            placeholder="搜索术语或译文..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => {
              setPage(1);
              loadTerms();
            }}
            style={{ width: 280, marginRight: 8 }}
            allowClear
          />
          
          {/* 按钮组 */}
          <Space>
            {/* 新增术语按钮 */}
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={openNewTermModal}
            >
              新增术语
            </Button>
            
            {/* 刷新按钮 - 同时刷新术语和领域目录 */}
            <Button 
              icon={<ReloadOutlined />}
              onClick={() => {
                loadTerms();
                loadDomains();
              }}
            >
              刷新
            </Button>
            
            {/* 排序按钮 */}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'updated_at_desc',
                    label: '按更新时间（最新）',
                    onClick: () => {
                      setSortField('updated_at');
                      setSortOrder('desc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'updated_at_asc',
                    label: '按更新时间（最早）',
                    onClick: () => {
                      setSortField('updated_at');
                      setSortOrder('asc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'created_at_desc',
                    label: '按创建时间（最新）',
                    onClick: () => {
                      setSortField('created_at');
                      setSortOrder('desc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'created_at_asc',
                    label: '按创建时间（最早）',
                    onClick: () => {
                      setSortField('created_at');
                      setSortOrder('asc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'term_text_asc',
                    label: '按术语名称（A-Z）',
                    onClick: () => {
                      setSortField('term_text');
                      setSortOrder('asc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'term_text_desc',
                    label: '按术语名称（Z-A）',
                    onClick: () => {
                      setSortField('term_text');
                      setSortOrder('desc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'source_lang_asc',
                    label: '按源语言（A-Z）',
                    onClick: () => {
                      setSortField('source_lang');
                      setSortOrder('asc');
                      setPage(1);
                      loadTerms();
                    }
                  },
                  {
                    key: 'source_lang_desc',
                    label: '按源语言（Z-A）',
                    onClick: () => {
                      setSortField('source_lang');
                      setSortOrder('desc');
                      setPage(1);
                      loadTerms();
                    }
                  }
                ]
              }}
            >
              <Button 
                icon={<ExportOutlined />}
                title={`当前排序: ${sortField === 'updated_at' ? '更新时间' : sortField === 'created_at' ? '创建时间' : sortField === 'term_text' ? '术语名称' : '源语言'} (${sortOrder === 'desc' ? '降序' : '升序'})`}
              >
                排序
              </Button>
            </Dropdown>
            
            
            {/* 导出术语按钮 */}
            <Button 
              icon={<ExportOutlined />}
              onClick={() => setIsExportDialogVisible(true)}
            >
              导出术语
            </Button>
            
            {/* 系统设置按钮 */}
            <Button 
              icon={<SettingOutlined />}
              onClick={openSettings}
            >
              系统设置
            </Button>
          </Space>
        </div>
      </Header>
      <Layout>
        <Sider
          width={siderWidth}
          collapsed={siderCollapsed}
          collapsedWidth={0}
          theme="light"
          style={{
            borderRight: '1px solid #f0f0f0',
            position: 'relative',
            overflow: 'auto'
          }}
        >
          <Tree
            blockNode
            defaultExpandAll
            selectedKeys={selectedDomain ? [selectedDomain.toString()] : []}
            onSelect={(keys) => {
              const key = keys.length > 0 ? Number(keys[0]) : undefined;
              setSelectedDomain(key);
              setPage(1);
            }}
            treeData={buildDomainTree(domains, domainCounts)}
            draggable={{
              icon: false
            }}
            onDrop={async (info) => {
              const { dragNode, node, dropPosition, dropToGap } = info;
              const draggedDomain = domains.find(d => d.id === dragNode.key);
              const targetDomain = node ? domains.find(d => d.id === node.key) : undefined;
              
              if (!draggedDomain) return;
              
              // 计算新的parent_id
              let newParentId: number | undefined = undefined;
              if (targetDomain) {
                if (dropPosition === -1) {
                  // 放置在目标节点之前
                  newParentId = targetDomain.parent_id;
                } else if (dropToGap) {
                  // 放置在间隙中（同级）
                  newParentId = targetDomain.parent_id;
                } else {
                  // 放置在目标节点内（作为子节点）
                  newParentId = targetDomain.id;
                }
              } else {
                // 放置在根节点
                newParentId = undefined;
              }
              
              // 备份原始数据以便回滚
              const originalDomains = [...domains];
              
              // 更新本地状态（乐观更新）
              const updatedDomains = domains.map(d => {
                if (d.id === draggedDomain.id) {
                  return { ...d, parent_id: newParentId };
                }
                return d;
              });
              setDomains(updatedDomains);
              
              try {
                // 保存到数据库
                await ipcApi.updateDomain(draggedDomain.id, { parent_id: newParentId });
                
                // 数据库更新成功，保持当前UI状态，不再重新加载
                message.success('分类位置已保存');
                
                // 对于同级别拖拽，确保状态数组重新排序以便Tree组件正确显示
                if (draggedDomain.parent_id === newParentId) {
                  // parent_id没有变化，但我们需要强制重新排序domains数组
                  // 创建一个新的数组引用，确保React重新渲染
                  setDomains(prev => [...prev]);
                }
              } catch (error) {
                // 数据库更新失败，回滚本地状态
                setDomains(originalDomains);
                message.error('保存失败，已恢复原位置');
                console.error('拖拽更新失败:', error);
              }
            }}
            titleRender={(node) => {
              if (node.key === 0) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{node.title}</span>
                    <Button 
                      type="text" 
                      size="small"
                      icon={<PlusOutlined style={{ fontSize: 12 }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsAddingDomain(true);
                        setNewDomainParentId(undefined);
                      }}
                      title="添加顶级分类"
                    />
                  </div>
                );
              }
              
              const domain = domains.find(d => d.id === node.key);
              if (!domain) return <span>{node.title}</span>;
              
              // 检查当前节点是否处于编辑模式
              const isEditing = editingDomainId === domain.id;
              
              return (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  width: '100%'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    {isEditing ? (
                      <>
                        <Input
                          value={editingDomainName}
                          onChange={(e) => setEditingDomainName(e.target.value)}
                          size="small"
                          style={{ width: 150, marginRight: 8 }}
                          autoFocus
                          onPressEnter={saveInlineEdit}
                        />
                        <TreeSelect
                          size="small"
                          style={{ width: 120, marginRight: 8 }}
                          value={selectedDomainParentId}
                          onChange={(value) => setSelectedDomainParentId(value)}
                          placeholder="父级分类"
                          treeData={[
                            { label: '顶级分类', value: undefined },
                            ...domains
                              .filter(d => d.id !== domain.id) // 排除自身
                              .map(d => ({ label: d.name, value: d.id }))
                          ]}
                        />
                        <Button 
                          type="link" 
                          size="small" 
                          onClick={saveInlineEdit}
                          style={{ color: '#52c41a' }}
                        >
                          保存
                        </Button>
                        <Button 
                          type="link" 
                          size="small" 
                          onClick={cancelInlineEdit}
                          style={{ color: '#ff4d4f' }}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <>
                        <span style={{ cursor: 'pointer' }}>
                          {node.title}
                        </span>
                        <Tag color="default" style={{ marginLeft: 8, fontSize: 12 }}>
                          {(node as any).termCount || 0}
                        </Tag>
                      </>
                    )}
                  </div>
                  
                  {!isEditing && (
                    <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
                      <Button 
                        type="text" 
                        size="small"
                        icon={<PlusOutlined style={{ fontSize: 10, lineHeight: 1 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddingDomain(true);
                          setNewDomainParentId(domain.id);
                        }}
                        title="添加子分类"
                        style={{ minWidth: 20, width: 20, height: 20 }}
                      />
                      <Button 
                        type="text" 
                        size="small"
                        icon={<EditOutlined style={{ fontSize: 10, lineHeight: 1 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          startInlineEdit(domain);
                        }}
                        title="编辑分类"
                        style={{ minWidth: 20, width: 20, height: 20 }}
                      />
                      <Button 
                        type="text" 
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 10, lineHeight: 1 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDomain(domain.id, domain.name);
                        }}
                        title="删除分类"
                        style={{ minWidth: 20, width: 20, height: 20 }}
                      />
                    </div>
                  )}
                </div>
              );
            }}
          />
          {selectedTermIds.size > 0 && (
            <div style={{ marginTop: 16, padding: '12px', background: '#f0f9ff', borderRadius: 6, border: '1px solid #91d5ff' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#1890ff' }}>
                批量操作（已选 {selectedTermIds.size} 个术语）
              </div>
              <Space wrap>
                <Button size="small" type="primary" onClick={() => setIsBatchDomainDialogVisible(true)}>
                  设置分类
                </Button>
                <Button size="small" danger onClick={() => handleBatchDelete()}>
                  批量删除
                </Button>
                <Button size="small" onClick={() => setSelectedTermIds(new Set())}>
                  取消选择
                </Button>
              </Space>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Space>
              {/* AI增强三态开关 */}
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  padding: '4px 8px',
                  borderRadius: 4,
                  backgroundColor: aiStatus === 'needs-config' ? '#fff7e6' : aiStatus === 'ready' ? '#f6ffed' : '#fafafa',
                  border: aiStatus === 'needs-config' ? '1px solid #ffd591' : aiStatus === 'ready' ? '1px solid #b7eb8f' : '1px solid #d9d9d9'
                }}
              >
                <div 
                  onClick={() => {
                    if (aiStatus === 'needs-config') {
                      message.warning('请先配置AI API设置');
                      openSettings();
                      return;
                    }
                    setUseAI(!useAI);
                  }}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: useAI && aiStatus === 'ready' ? '#52c41a' : '#bfbfbf',
                      position: 'relative',
                      marginRight: 8,
                      transition: 'background-color 0.3s'
                    }}
                  >
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: '#fff',
                        position: 'absolute',
                        top: 2,
                        left: useAI && aiStatus === 'ready' ? 18 : 2,
                        transition: 'left 0.3s',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                    />
                  </div>
                  <span style={{ 
                    color: aiStatus === 'needs-config' ? '#fa8c16' : aiStatus === 'ready' ? useAI ? '#52c41a' : '#8c8c8c' : '#8c8c8c',
                    fontWeight: aiStatus === 'needs-config' ? 500 : 'normal'
                  }}>
                    AI增强
                    {aiStatus === 'needs-config' && <span style={{ marginLeft: 4, fontSize: 12, color: '#fa8c16' }}>(需配置)</span>}
                    {aiStatus === 'ready' && useAI && <span style={{ marginLeft: 4, fontSize: 12, color: '#52c41a' }}>(智能模式)</span>}
                    {aiStatus === 'ready' && !useAI && <span style={{ marginLeft: 4, fontSize: 12, color: '#8c8c8c' }}>(规则模式)</span>}
                  </span>
                </div>
              </div>
            </Space>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button type="default" block onClick={() => setIsTextExtractVisible(true)}>
              文本抽取
            </Button>
            <Button type="default" block onClick={importFromFile} style={{ marginTop: 8 }}>
              文件抽取
            </Button>
            <Button type="default" block onClick={() => setIsUrlExtractVisible(true)} style={{ marginTop: 8 }}>
              网页抽取
            </Button>
          </div>
          
          {/* 拖拽手柄 */}
          <div
            onMouseDown={(e) => {
              setIsDragging(true);
              setDragStartX(e.clientX);
              setDragStartWidth(siderWidth);
              e.preventDefault();
            }}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              backgroundColor: isDragging ? '#1890ff' : 'transparent',
              zIndex: 1000,
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={() => {
              if (!isDragging) {
                const el = document.querySelector('.drag-handle-hover-area');
                if (el) (el as HTMLElement).style.backgroundColor = '#f0f0f0';
              }
            }}
            onMouseLeave={() => {
              if (!isDragging) {
                const el = document.querySelector('.drag-handle-hover-area');
                if (el) (el as HTMLElement).style.backgroundColor = 'transparent';
              }
            }}
          />
          <div
            className="drag-handle-hover-area"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 12,
              cursor: 'col-resize',
              zIndex: 999,
            }}
          />
        </Sider>
        <Content style={{ padding: 16, overflow: 'auto' }}>
          <Table
            rowKey="id"
            rowSelection={rowSelection}
            columns={columns}
            dataSource={terms}
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (p, size) => {
                setPage(p);
                setPageSize(size);
              }
            }}
            scroll={{ x: 960, y: 'calc(100vh - 220px)' }}
          />
        </Content>
      </Layout>

      <Modal
        title={editingTermId ? "编辑术语" : "新增术语"}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={saveTerm} initialValues={{ source_lang: 'zh' }}>
          <Form.Item name="source_lang" label="源语言" rules={[{ required: true }]}>
            <Select
              options={getLanguageSelectOptions()}
              onChange={(value: string) => {
                // 源语言变化时，自动更新翻译方向
                const defaultTarget = getDefaultTargetLang(value);
                form.setFieldsValue({ target_lang: defaultTarget });
                // 清空翻译列表状态
                setModalTranslations([]);
              }}
            />
          </Form.Item>
          <Form.Item name="term_text" label="术语原文" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="abbreviation" label="简称">
            <Input />
          </Form.Item>

          {/* 多语翻译编辑器 */}
          <Form.Item label="译文管理" style={{ marginBottom: 8 }}>
            <TranslationEditor
              sourceLang={form.getFieldValue('source_lang') || 'zh'}
              translations={modalTranslations}
              onChange={setModalTranslations}
            />
          </Form.Item>

          <Form.Item name="domain_id" label="领域">
            <Select allowClear options={getDomainSelectOptions(domains)} />
          </Form.Item>
          <Form.Item name="description" label="注释">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="文本抽取"
        open={isTextExtractVisible}
        onCancel={() => {
          // 如果正在加载，则取消操作
          if (fileExtractLoading && fileExtractCancelToken) {
            fileExtractCancelToken.cancelled = true;
            setFileExtractLoading(false);
            setFileExtractProgress('');
            message.info('文本抽取已取消');
          }
          setIsTextExtractVisible(false);
        }}
        onOk={addExtractedTerms}
        okText="导入选中术语"
        footer={[
          fileExtractLoading ? (
            <Button key="cancel" danger onClick={() => {
              if (fileExtractCancelToken) {
                fileExtractCancelToken.cancelled = true;
                setFileExtractLoading(false);
                setFileExtractProgress('');
                message.info('文本抽取已取消');
              }
            }}>
              取消处理
            </Button>
          ) : (
            <Button key="cancel" onClick={() => setIsTextExtractVisible(false)}>
              取消
            </Button>
          ),
          <Button key="extract" type="primary" disabled={fileExtractLoading} onClick={extractFromText}>
            抽取
          </Button>,
          <Button key="import" type="primary" disabled={selectedExtracted.size === 0 || fileExtractLoading} onClick={addExtractedTerms}>
            导入选中术语 ({selectedExtracted.size})
          </Button>,
        ]}
        width={1000}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 文本抽取进度提示 */}
          {fileExtractLoading && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #e8e8e8'
            }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: '50%', 
                  border: '4px solid #f0f0f0',
                  borderTop: '4px solid #1890ff',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite'
                }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                正在处理文本...
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {fileExtractProgress}
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                {useAI ? '使用AI增强时可能需要较长时间，请耐心等待' : '正在使用规则引擎抽取术语...'}
              </div>
            </div>
          )}
          
          {!fileExtractLoading && (
            <Space wrap>
              <Select
                value={extractLanguage}
                onChange={(v) => setExtractLanguage(v as 'auto' | 'en' | 'zh')}
                options={[
                  { label: '自动', value: 'auto' },
                  { label: '中文', value: 'zh' },
                  { label: '英文', value: 'en' }
                ]}
                style={{ width: 120 }}
              />
              <Switch checked={useAI} onChange={setUseAI} />
              <span>AI增强</span>
              <Select
                value={extractSourceType}
                onChange={(v) => setExtractSourceType(v as string)}
                options={sourceTypeOptions}
                style={{ width: 120 }}
                placeholder="来源类型"
              />
            </Space>
          )}
          {!fileExtractLoading && (
            <Input.TextArea
              rows={5}
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              placeholder="输入待抽取文本"
            />
          )}
          
          {!fileExtractLoading && extractedTerms.length === 0 && extractText && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px dashed #e8e8e8'
            }}>
              <div style={{ fontSize: 16, color: '#999', marginBottom: 16 }}>
                未提取到术语
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                当前文本未提取到有效术语，请尝试调整文本内容或切换语言/AI设置
              </div>
            </div>
          )}
          
          {!fileExtractLoading && extractedTerms.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                抽取结果 ({extractedTerms.length} 个术语)
              </div>
              
              {/* 筛选工具栏 */}
              <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: 6 }}>
                <Space wrap>
                  <Input
                    placeholder="筛选术语"
                    value={extractFilterText}
                    onChange={(e) => setExtractFilterText(e.target.value)}
                    style={{ width: 180 }}
                    allowClear
                  />
                  <Select
                    placeholder="词频筛选"
                    style={{ width: 120 }}
                    value={extractMinFrequency || undefined}
                    onChange={setExtractMinFrequency}
                    allowClear
                  >
                    <Select.Option value={1}>≥1次</Select.Option>
                    <Select.Option value={2}>≥2次</Select.Option>
                    <Select.Option value={3}>≥3次</Select.Option>
                    <Select.Option value={5}>≥5次</Select.Option>
                  </Select>
                </Space>
                
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" onClick={handleSelectAllExtracted}>
                    全选
                  </Button>
                  <Button size="small" onClick={handleInvertExtractedSelection}>
                    反选
                  </Button>
                  <Button size="small" onClick={handleClearExtractedSelection}>
                    清空
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'freq-2', label: '选择词频≥2', onClick: () => handleSelectByFrequency(2) },
                        { key: 'freq-3', label: '选择词频≥3', onClick: () => handleSelectByFrequency(3) },
                        { key: 'freq-5', label: '选择词频≥5', onClick: () => handleSelectByFrequency(5) },
                      ]
                    }}
                  >
                    <Button size="small">
                      按词频选择
                    </Button>
                  </Dropdown>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                    已选中: {selectedExtracted.size} / {getFilteredExtractedTerms().length}
                  </span>
                </Space>
              </div>
              
              <Table
                rowKey="index"
                columns={[
                  { 
                    title: '选择', 
                    dataIndex: 'index', 
                    key: 'index',
                    width: 60,
                    render: (index: number) => (
                      <input
                        type="checkbox"
                        checked={selectedExtracted.has(index)}
                        onChange={(e) => {
                          const next = new Set(selectedExtracted);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          setSelectedExtracted(next);
                        }}
                      />
                    )
                  },
                  { 
                    title: '语种', 
                    dataIndex: 'source_lang', 
                    key: 'source_lang',
                    width: 80,
                    render: (lang: string, record: ExtractedTerm) => (
                      <Tag color="blue">{lang}</Tag>
                    )
                  },
                  { 
                    title: '术语原文', 
                    dataIndex: 'source_term', 
                    key: 'source_term',
                    width: 200,
                    render: (text: string, record: ExtractedTerm) => (
                      <span>
                        <strong style={{ display: 'block', marginBottom: 2 }}>{text || record.term_text}</strong>
                        <span style={{ fontSize: 12, color: '#666' }}>
                          词频: {record.score.toFixed(2)}
                        </span>
                      </span>
                    )
                  },
                  { 
                    title: '来源', 
                    dataIndex: 'source_type', 
                    key: 'source_type',
                    width: 100,
                    render: (type: string, record: ExtractedTerm) => {
                      const label = sourceTypeOptions.find(opt => opt.value === type)?.label || type;
                      const color = {
                        official: 'green',
                        high_quality: 'blue',
                        manual: 'gold',
                        web_extract: 'purple',
                        plain_text: 'gray',
                        ai_extract: 'cyan'
                      }[type] || 'default';
                      
                      return (
                        <>
                          <Tag color={color}>{label}</Tag>
                          {record.credibility_score && (
                            <div style={{ fontSize: 10, color: '#666' }}>
                              {record.credibility_score}星
                            </div>
                          )}
                        </>
                      );
                    }
                  },
                  { 
                    title: '术语译文', 
                    dataIndex: 'target_term', 
                    key: 'target_term',
                    width: 220,
                    render: (translation: string, record: ExtractedTerm) => (
                      translation ? (
                        <span>
                          <div>{translation}</div>
                          <span style={{ fontSize: 12, color: '#666', display: 'block' }}>
                            {record.target_lang && <Tag style={{ marginRight: 4 }}>{record.target_lang}</Tag>}
                            {record.translation_confidence && (
                              <span style={{ marginRight: 4 }}>{`置信度: ${(record.translation_confidence * 100).toFixed(0)}%`}</span>
                            )}
                            {record.translation_source && (
                              <Tag color={record.translation_source === 'file' ? 'green' : 'blue'} style={{ fontSize: '10px' }}>
                                {record.translation_source === 'file' ? '文件对译' : 'AI建议'}
                              </Tag>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                      )
                    )
                  },
                  { 
                    title: '缩写', 
                    dataIndex: 'abbreviation_suggestion', 
                    key: 'abbreviation_suggestion',
                    width: 80,
                    render: (abbr: string, record: ExtractedTerm) => (
                      abbr ? (
                        <Tag color="purple">{abbr}</Tag>
                      ) : (
                        <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                      )
                    )
                  },
                  { 
                    title: '分数', 
                    dataIndex: 'score', 
                    key: 'score',
                    width: 70,
                    render: (score: number) => (
                      <span style={{ 
                        color: score > 0.8 ? '#52c41a' : score > 0.5 ? '#faad14' : '#ff4d4f',
                        fontWeight: 'bold'
                      }}>
                        {score.toFixed(2)}
                      </span>
                    )
                  },
                ]}
                dataSource={getFilteredExtractedTerms()}
                pagination={{ pageSize: 10 }}
                scroll={{ y: 300 }}
              />
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title="URL抽取"
        open={isUrlExtractVisible}
        onCancel={() => {
          // 如果正在加载，则取消操作
          if (fileExtractLoading && fileExtractCancelToken) {
            fileExtractCancelToken.cancelled = true;
            setFileExtractLoading(false);
            setFileExtractProgress('');
            message.info('URL抽取已取消');
          }
          setIsUrlExtractVisible(false);
        }}
        onOk={addExtractedTerms}
        okText="导入选中术语"
        footer={[
          fileExtractLoading ? (
            <Button key="cancel" danger onClick={() => {
              if (fileExtractCancelToken) {
                fileExtractCancelToken.cancelled = true;
                setFileExtractLoading(false);
                setFileExtractProgress('');
                message.info('URL抽取已取消');
              }
            }}>
              取消处理
            </Button>
          ) : (
            <Button key="cancel" onClick={() => setIsUrlExtractVisible(false)}>
              取消
            </Button>
          ),
          <Button key="extract" type="primary" disabled={fileExtractLoading} onClick={extractFromUrl}>
            抽取
          </Button>,
          <Button key="import" type="primary" disabled={selectedExtracted.size === 0 || fileExtractLoading} onClick={addExtractedTerms}>
            导入选中术语 ({selectedExtracted.size})
          </Button>,
        ]}
        width={1000}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* URL抽取进度提示 */}
          {fileExtractLoading && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #e8e8e8'
            }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: '50%', 
                  border: '4px solid #f0f0f0',
                  borderTop: '4px solid #1890ff',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite'
                }} />
                <style>
                  {`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}
                </style>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                正在抓取网页...
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {fileExtractProgress}
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                网页抓取或使用AI增强时可能需要较长时间，请耐心等待
              </div>
            </div>
          )}

          {!fileExtractLoading && (
            <Space wrap>
              <Select
                value={extractLanguage}
                onChange={(v) => setExtractLanguage(v as 'auto' | 'en' | 'zh')}
                options={[
                  { label: '自动', value: 'auto' },
                  { label: '中文', value: 'zh' },
                  { label: '英文', value: 'en' }
                ]}
                style={{ width: 120 }}
              />
              <Switch checked={useAI} onChange={setUseAI} />
              <span>AI增强</span>
            </Space>
          )}
          {!fileExtractLoading && (
            <Input
              value={extractUrl}
              onChange={(e) => setExtractUrl(e.target.value)}
              placeholder="输入待抽取URL"
            />
          )}
          
          {!fileExtractLoading && extractedTerms.length === 0 && extractUrl && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px dashed #e8e8e8'
            }}>
              <div style={{ fontSize: 16, color: '#999', marginBottom: 16 }}>
                未提取到术语
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                该URL网页未提取到有效术语，请尝试其他URL、调整语言设置或启用AI增强
              </div>
            </div>
          )}
          
          {!fileExtractLoading && extractedTerms.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                抽取结果 ({extractedTerms.length} 个术语)
              </div>
              
              {/* 筛选工具栏 */}
              <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: 6 }}>
                <Space wrap>
                  <Input
                    placeholder="筛选术语"
                    value={extractFilterText}
                    onChange={(e) => setExtractFilterText(e.target.value)}
                    style={{ width: 180 }}
                    allowClear
                  />
                  <Select
                    placeholder="词频筛选"
                    style={{ width: 120 }}
                    value={extractMinFrequency || undefined}
                    onChange={setExtractMinFrequency}
                    allowClear
                  >
                    <Select.Option value={1}>≥1次</Select.Option>
                    <Select.Option value={2}>≥2次</Select.Option>
                    <Select.Option value={3}>≥3次</Select.Option>
                    <Select.Option value={5}>≥5次</Select.Option>
                  </Select>
                </Space>
                
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" onClick={handleSelectAllExtracted}>
                    全选
                  </Button>
                  <Button size="small" onClick={handleInvertExtractedSelection}>
                    反选
                  </Button>
                  <Button size="small" onClick={handleClearExtractedSelection}>
                    清空
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'freq-2', label: '选择词频≥2', onClick: () => handleSelectByFrequency(2) },
                        { key: 'freq-3', label: '选择词频≥3', onClick: () => handleSelectByFrequency(3) },
                        { key: 'freq-5', label: '选择词频≥5', onClick: () => handleSelectByFrequency(5) },
                      ]
                    }}
                  >
                    <Button size="small">
                      按词频选择
                    </Button>
                  </Dropdown>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                    已选中: {selectedExtracted.size} / {getFilteredExtractedTerms().length}
                  </span>
                </Space>
              </div>
              
              <Table
                rowKey="index"
                columns={[
                  { 
                    title: '选择', 
                    dataIndex: 'index', 
                    key: 'index',
                    width: 60,
                    render: (index: number) => (
                      <input
                        type="checkbox"
                        checked={selectedExtracted.has(index)}
                        onChange={(e) => {
                          const next = new Set(selectedExtracted);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          setSelectedExtracted(next);
                        }}
                      />
                    )
                  },
                  { 
                    title: '语种', 
                    dataIndex: 'source_lang', 
                    key: 'source_lang',
                    width: 100,
                    render: (lang: string, record: ExtractedTerm) => (
                      <Tag color="blue">{lang}</Tag>
                    )
                  },
                  { 
                    title: '术语原文', 
                    dataIndex: 'source_term', 
                    key: 'source_term',
                    render: (text: string, record: ExtractedTerm) => (
                      <div>
                        <strong>{text || record.term_text}</strong>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                          词频: {record.score.toFixed(2)}
                        </div>
                      </div>
                    )
                  },
                  { 
                    title: '术语译文', 
                    dataIndex: 'target_term', 
                    key: 'target_term',
                    width: 150,
                    render: (translation: string, record: ExtractedTerm) => (
                      <div>
                        {translation ? (
                          <>
                            <div>{translation}</div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                              {record.target_lang && <Tag>{record.target_lang}</Tag>}
                              {record.translation_confidence && (
                                <span style={{ marginLeft: 4 }}>{`置信度: ${(record.translation_confidence * 100).toFixed(0)}%`}</span>
                              )}
                              {record.translation_source && (
                                <Tag color={record.translation_source === 'file' ? 'green' : 'blue'} style={{ marginLeft: 4, fontSize: '10px' }}>
                                  {record.translation_source === 'file' ? '文件对译' : 'AI建议'}
                                </Tag>
                              )}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                        )}
                      </div>
                    )
                  },
                  { 
                    title: '缩写', 
                    dataIndex: 'abbreviation_suggestion', 
                    key: 'abbreviation_suggestion',
                    width: 100,
                    render: (abbr: string, record: ExtractedTerm) => (
                      <div>
                        {abbr ? (
                          <Tag color="purple">{abbr}</Tag>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                        )}
                      </div>
                    )
                  },
                  { 
                    title: '分数', 
                    dataIndex: 'score', 
                    key: 'score',
                    width: 80,
                    render: (score: number) => (
                      <span style={{ 
                        color: score > 0.8 ? '#52c41a' : score > 0.5 ? '#faad14' : '#ff4d4f',
                        fontWeight: 'bold'
                      }}>
                        {score.toFixed(2)}
                      </span>
                    )
                  },
                ]}
                dataSource={getFilteredExtractedTerms()}
                pagination={{ pageSize: 10 }}
                scroll={{ y: 300 }}
              />
            </div>
          )}
        </Space>
      </Modal>

      {/* 文件抽取结果Modal */}
      <Modal
        title="文件抽取结果"
        open={isFileExtractVisible}
        onCancel={() => {
          // 如果正在加载，则取消操作
          if (fileExtractLoading && fileExtractCancelToken) {
            fileExtractCancelToken.cancelled = true;
            setFileExtractLoading(false);
            setFileExtractProgress('');
            message.info('文件抽取已取消');
          }
          setIsFileExtractVisible(false);
        }}
        onOk={addExtractedTerms}
        okText="导入选中术语"
        footer={[
          fileExtractLoading ? (
            <Button key="cancel" danger onClick={() => {
              if (fileExtractCancelToken) {
                fileExtractCancelToken.cancelled = true;
                setFileExtractLoading(false);
                setFileExtractProgress('');
                message.info('文件抽取已取消');
              }
            }}>
              取消处理
            </Button>
          ) : (
            <Button key="cancel" onClick={() => setIsFileExtractVisible(false)}>
              关闭
            </Button>
          ),
          <Button key="import" type="primary" disabled={selectedExtracted.size === 0 || fileExtractLoading} onClick={addExtractedTerms}>
            导入选中术语 ({selectedExtracted.size})
          </Button>,
        ]}
        width={1000}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 文件抽取进度提示 */}
          {fileExtractLoading && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #e8e8e8'
            }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: '50%', 
                  border: '4px solid #f0f0f0',
                  borderTop: '4px solid #1890ff',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite'
                }} />
                <style>
                  {`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}
                </style>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                正在处理文件...
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {fileExtractProgress}
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                文件较大或使用AI增强时可能需要较长时间，请耐心等待
              </div>
            </div>
          )}
          
          {!fileExtractLoading && extractedTerms.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                抽取结果 ({extractedTerms.length} 个术语)
              </div>
              
              {/* 筛选工具栏 */}
              <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: 6 }}>
                <Space wrap>
                  <Input
                    placeholder="筛选术语"
                    value={extractFilterText}
                    onChange={(e) => setExtractFilterText(e.target.value)}
                    style={{ width: 180 }}
                    allowClear
                  />
                  <Select
                    placeholder="词频筛选"
                    style={{ width: 120 }}
                    value={extractMinFrequency || undefined}
                    onChange={setExtractMinFrequency}
                    allowClear
                  >
                    <Select.Option value={1}>≥1次</Select.Option>
                    <Select.Option value={2}>≥2次</Select.Option>
                    <Select.Option value={3}>≥3次</Select.Option>
                    <Select.Option value={5}>≥5次</Select.Option>
                  </Select>
                </Space>
                
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" onClick={handleSelectAllExtracted}>
                    全选
                  </Button>
                  <Button size="small" onClick={handleInvertExtractedSelection}>
                    反选
                  </Button>
                  <Button size="small" onClick={handleClearExtractedSelection}>
                    清空
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'freq-2', label: '选择词频≥2', onClick: () => handleSelectByFrequency(2) },
                        { key: 'freq-3', label: '选择词频≥3', onClick: () => handleSelectByFrequency(3) },
                        { key: 'freq-5', label: '选择词频≥5', onClick: () => handleSelectByFrequency(5) },
                      ]
                    }}
                  >
                    <Button size="small">
                      按词频选择
                    </Button>
                  </Dropdown>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                    已选中: {selectedExtracted.size} / {getFilteredExtractedTerms().length}
                  </span>
                </Space>
              </div>
              
              <Table
                rowKey="index"
                columns={[
                  { 
                    title: '选择', 
                    dataIndex: 'index', 
                    key: 'index',
                    width: 60,
                    render: (index: number) => (
                      <input
                        type="checkbox"
                        checked={selectedExtracted.has(index)}
                        onChange={(e) => {
                          const next = new Set(selectedExtracted);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          setSelectedExtracted(next);
                        }}
                      />
                    )
                  },
                  { 
                    title: '语种', 
                    dataIndex: 'source_lang', 
                    key: 'source_lang',
                    width: 100,
                    render: (lang: string, record: ExtractedTerm) => (
                      <Tag color="blue">{lang}</Tag>
                    )
                  },
                  { 
                    title: '术语原文', 
                    dataIndex: 'source_term', 
                    key: 'source_term',
                    render: (text: string, record: ExtractedTerm) => (
                      <div>
                        <strong>{text || record.term_text}</strong>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                          词频: {record.score.toFixed(2)}
                        </div>
                      </div>
                    )
                  },
                  { 
                    title: '术语译文', 
                    dataIndex: 'target_term', 
                    key: 'target_term',
                    width: 150,
                    render: (translation: string, record: ExtractedTerm) => (
                      <div>
                        {translation ? (
                          <>
                            <div>{translation}</div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                              {record.target_lang && <Tag>{record.target_lang}</Tag>}
                              {record.translation_confidence && (
                                <span style={{ marginLeft: 4 }}>{`置信度: ${(record.translation_confidence * 100).toFixed(0)}%`}</span>
                              )}
                              {record.translation_source && (
                                <Tag color={record.translation_source === 'file' ? 'green' : 'blue'} style={{ marginLeft: 4, fontSize: '10px' }}>
                                  {record.translation_source === 'file' ? '文件对译' : 'AI建议'}
                                </Tag>
                              )}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                        )}
                      </div>
                    )
                  },
                  { 
                    title: '缩写', 
                    dataIndex: 'abbreviation_suggestion', 
                    key: 'abbreviation_suggestion',
                    width: 100,
                    render: (abbr: string, record: ExtractedTerm) => (
                      <div>
                        {abbr ? (
                          <Tag color="purple">{abbr}</Tag>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>无</span>
                        )}
                      </div>
                    )
                  },
                  { 
                    title: '分数', 
                    dataIndex: 'score', 
                    key: 'score',
                    width: 80,
                    render: (score: number) => (
                      <span style={{ 
                        color: score > 0.8 ? '#52c41a' : score > 0.5 ? '#faad14' : '#ff4d4f',
                        fontWeight: 'bold'
                      }}>
                        {score.toFixed(2)}
                      </span>
                    )
                  },
                ]}
                dataSource={getFilteredExtractedTerms()}
                pagination={{ pageSize: 10 }}
                scroll={{ y: 300 }}
              />
            </div>
          )}
          
          {!fileExtractLoading && extractedTerms.length === 0 && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px dashed #e8e8e8'
            }}>
              <div style={{ fontSize: 16, color: '#999', marginBottom: 16 }}>
                暂无抽取结果
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                请尝试重新选择文件或检查文件内容
              </div>
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title="系统设置"
        open={isSettingsVisible}
        onCancel={() => setIsSettingsVisible(false)}
        onOk={() => {
          settingsForm.validateFields().then((values) => {
            saveAIConfig(values as any);
          });
        }}
        footer={[
          <Button key="test" onClick={async () => {
            try {
              const values = await settingsForm.validateFields();
              const res = await ipcApi.testAIConnection(values);
              if (res.success) {
                message.success(`连接测试成功: ${res.data.message}`);
              } else {
                message.error(`连接测试失败: ${res.data.message}`);
              }
            } catch (error) {
              message.error('验证失败，请检查表单');
            }
          }}>
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => setIsSettingsVisible(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={() => {
            settingsForm.validateFields().then((values) => {
              saveAIConfig(values as any);
            });
          }}>
            保存
          </Button>,
        ]}
      >
        <Form
          form={settingsForm}
          layout="vertical"
          initialValues={aiConfig}
        >
          <Form.Item name="apiKey" label="AI API Key" rules={[{ required: true, message: '请填写API Key' }]}>
            <Input.Password 
              placeholder="请输入AI API Key" 
              visibilityToggle={true}
            />
          </Form.Item>
          <Form.Item name="endpoint" label="模型版本号" rules={[{ required: true, message: '请填写模型版本号' }]}>
            <Input placeholder="例如：gpt-4, claude-3" />
          </Form.Item>
          <Form.Item name="promptTemplate" label="提示词模版">
            <Input.TextArea rows={4} placeholder="系统将提供默认提示词，您可以修改" />
          </Form.Item>
          <Form.Item name="dataPath" label="术语数据保存地址">
            <Input 
              placeholder="留空使用默认地址，确保数据安全" 
              addonAfter={
                <Button type="link" onClick={selectDataPath} style={{ padding: '4px 8px' }}>
                  选择
                </Button>
              }
              readOnly
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 智能抽取Modal */}
      <Modal
        title={`智能${smartExtractMode === 'text' ? '文本' : smartExtractMode === 'file' ? '文件' : '网页'}抽取`}
        open={isSmartExtractVisible}
        onCancel={() => {
          // 如果正在加载，则取消操作
          if (smartExtractLoading && smartExtractCancelToken) {
            smartExtractCancelToken.cancelled = true;
            setSmartExtractLoading(false);
            setSmartExtractProgress('');
            message.info('智能抽取已取消');
          }
          setIsSmartExtractVisible(false);
        }}
        onOk={smartExtractMode === 'text' ? smartExtractFromText : smartExtractMode === 'file' ? smartExtractFromFile : smartExtractFromUrl}
        okText="开始抽取"
        footer={[
          smartExtractLoading ? (
            <Button key="cancel" danger onClick={() => {
              if (smartExtractCancelToken) {
                smartExtractCancelToken.cancelled = true;
                setSmartExtractLoading(false);
                setSmartExtractProgress('');
                message.info('智能抽取已取消');
              }
            }}>
              取消处理
            </Button>
          ) : (
            <Button key="cancel" onClick={() => setIsSmartExtractVisible(false)}>
              关闭
            </Button>
          ),
          <Button key="extract" type="primary" disabled={smartExtractLoading} onClick={smartExtractMode === 'text' ? smartExtractFromText : smartExtractMode === 'file' ? smartExtractFromFile : smartExtractFromUrl}>
            开始抽取
          </Button>,
          <Button key="import" type="primary" disabled={selectedSmartExtracted.size === 0 || smartExtractLoading} onClick={addSmartExtractedTerms}>
            导入选中术语 ({selectedSmartExtracted.size})
          </Button>,
        ]}
        width={800}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 智能抽取进度提示 */}
          {smartExtractLoading && (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #e8e8e8'
            }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: '50%', 
                  border: '4px solid #f0f0f0',
                  borderTop: '4px solid #1890ff',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite'
                }} />
                <style>
                  {`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}
                </style>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                正在智能分析...
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {smartExtractProgress}
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                文本较大或复杂时可能需要较长时间，请耐心等待
              </div>
            </div>
          )}
          
          {!smartExtractLoading && (
            <>
              <Space wrap>
                <Select
                  value={smartExtractLanguage}
                  onChange={(v) => setSmartExtractLanguage(v as 'auto' | 'en' | 'zh')}
                  options={[
                    { label: '自动检测', value: 'auto' },
                    { label: '中文', value: 'zh' },
                    { label: '英文', value: 'en' }
                  ]}
                  style={{ width: 120 }}
                />
                <span>抽取策略: {extractionStrategy?.name || '智能融合'}</span>
              </Space>
              
              {smartExtractMode === 'text' && (
                <Input.TextArea
                  rows={6}
                  value={smartExtractText}
                  onChange={(e) => setSmartExtractText(e.target.value)}
                  placeholder="输入待抽取文本，智能抽取将分析术语频率、领域匹配度、翻译价值等因素..."
                />
              )}
              
              {smartExtractMode === 'file' && (
                <div>
                  <Button type="default" onClick={smartExtractFromFile}>
                    选择文件进行智能抽取
                  </Button>
                  <p style={{ marginTop: 8, color: '#666' }}>
                    支持.txt、.docx、.pdf、.html等格式，智能抽取将分析文档结构和上下文
                  </p>
                </div>
              )}
              
              {smartExtractMode === 'url' && (
                <Input
                  value={smartExtractUrl}
                  onChange={(e) => setSmartExtractUrl(e.target.value)}
                  placeholder="输入待抽取URL，智能抽取将抓取网页内容进行分析"
                />
              )}
            </>
          )}
          
          {smartExtractedTerms.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                智能抽取结果 ({smartExtractedTerms.length} 个专业术语)
              </div>
              
              {/* 筛选工具栏 */}
              <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: 6 }}>
                <Space wrap>
                  <Input
                    placeholder="筛选术语"
                    value={smartExtractFilterText}
                    onChange={(e) => setSmartExtractFilterText(e.target.value)}
                    style={{ width: 180 }}
                    allowClear
                  />
                  <Select
                    placeholder="置信度筛选"
                    style={{ width: 120 }}
                    value={smartExtractMinConfidence || undefined}
                    onChange={setSmartExtractMinConfidence}
                    allowClear
                  >
                    <Select.Option value={0.6}>≥60%</Select.Option>
                    <Select.Option value={0.7}>≥70%</Select.Option>
                    <Select.Option value={0.8}>≥80%</Select.Option>
                    <Select.Option value={0.9}>≥90%</Select.Option>
                  </Select>
                  <Select
                    placeholder="翻译价值筛选"
                    style={{ width: 120 }}
                    value={smartExtractMinTranslationValue || undefined}
                    onChange={setSmartExtractMinTranslationValue}
                    allowClear
                  >
                    <Select.Option value={5}>≥5分</Select.Option>
                    <Select.Option value={6}>≥6分</Select.Option>
                    <Select.Option value={7}>≥7分</Select.Option>
                    <Select.Option value={8}>≥8分</Select.Option>
                  </Select>
                  <Switch
                    checked={smartExtractShowFrequency}
                    onChange={setSmartExtractShowFrequency}
                    checkedChildren="显示词频"
                    unCheckedChildren="隐藏词频"
                  />
                </Space>
                
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" onClick={handleSelectAllSmartExtracted}>
                    全选
                  </Button>
                  <Button size="small" onClick={handleInvertSelection}>
                    反选
                  </Button>
                  <Button size="small" onClick={handleClearSelection}>
                    清空
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'confidence-0.7', label: '选择置信度≥70%', onClick: () => handleSelectByConfidence(0.7) },
                        { key: 'confidence-0.8', label: '选择置信度≥80%', onClick: () => handleSelectByConfidence(0.8) },
                        { key: 'confidence-0.9', label: '选择置信度≥90%', onClick: () => handleSelectByConfidence(0.9) },
                        { type: 'divider' },
                        { key: 'value-6', label: '选择翻译价值≥6分', onClick: () => handleSelectByTranslationValue(6) },
                        { key: 'value-7', label: '选择翻译价值≥7分', onClick: () => handleSelectByTranslationValue(7) },
                        { key: 'value-8', label: '选择翻译价值≥8分', onClick: () => handleSelectByTranslationValue(8) },
                      ]
                    }}
                  >
                    <Button size="small">
                      按条件选择
                    </Button>
                  </Dropdown>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                    已选中: {selectedSmartExtracted.size} / {getFilteredSmartExtractedTerms().length}
                  </span>
                </Space>
              </div>
              
              <Table
                rowKey="index"
                columns={[
                  { 
                    title: '选择', 
                    dataIndex: 'index', 
                    key: 'index',
                    width: 60,
                    render: (index: number) => (
                      <input
                        type="checkbox"
                        checked={selectedSmartExtracted.has(index)}
                        onChange={(e) => {
                          const next = new Set(selectedSmartExtracted);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          setSelectedSmartExtracted(next);
                        }}
                      />
                    )
                  },
                  { 
                    title: '术语原文', 
                    dataIndex: 'term_text', 
                    key: 'term_text',
                    render: (text: string, record: SmartExtractedTerm) => (
                      <>
                        <Tag color="blue">{record.source_lang}</Tag>
                        {text}
                        {smartExtractShowFrequency && (
                          <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>
                            (词频: {record.score})
                          </span>
                        )}
                        {record.isExistingTerm && <Tag color="orange" style={{ marginLeft: 4 }}>已存在</Tag>}
                      </>
                    )
                  },
                  { 
                    title: '置信度', 
                    dataIndex: 'confidence', 
                    key: 'confidence',
                    render: (confidence: number) => (
                      <span style={{ color: confidence > 0.8 ? '#52c41a' : confidence > 0.6 ? '#faad14' : '#ff4d4f' }}>
                        {(confidence * 100).toFixed(0)}%
                      </span>
                    )
                  },
                  { 
                    title: '翻译价值', 
                    dataIndex: 'translationValue', 
                    key: 'translationValue',
                    render: (value: number) => (
                      <span style={{ color: value > 7 ? '#52c41a' : value > 4 ? '#faad14' : '#d9d9d9' }}>
                        {value}/10
                      </span>
                    )
                  },
                  { 
                    title: '领域匹配', 
                    dataIndex: 'domainMatch', 
                    key: 'domainMatch',
                    render: (match: number) => match ? `${(match * 100).toFixed(0)}%` : '-'
                  },
                ]}
                dataSource={getFilteredSmartExtractedTerms()}
                pagination={{ pageSize: 10 }}
                scroll={{ y: 300 }}
              />
            </div>
          )}
        </Space>
      </Modal>

      {/* 批量设置分类Modal */}
      <Modal
        title="批量设置领域分类"
        open={isBatchDomainDialogVisible}
        onCancel={() => {
          setIsBatchDomainDialogVisible(false);
          setBatchDomainId(null);
        }}
        onOk={async () => {
          if (selectedTermIds.size === 0) {
            message.warning('请先选择术语');
            return;
          }
          try {
            const termIds = Array.from(selectedTermIds);
            await ipcApi.batchUpdateTermDomains(termIds, batchDomainId);
            message.success(`成功为 ${termIds.length} 个术语设置分类`);
            setIsBatchDomainDialogVisible(false);
            setBatchDomainId(null);
            setSelectedTermIds(new Set());
            await loadTerms();
          } catch (error) {
            message.error('批量设置分类失败');
          }
        }}
        okText="确认设置"
        okButtonProps={{ disabled: selectedTermIds.size === 0 }}
      >
        <div>
          <p>已选择 <strong>{selectedTermIds.size}</strong> 个术语</p>
          <Form layout="vertical">
            <Form.Item label="设置领域分类">
              <Select
                allowClear
                placeholder="选择分类（留空则为清除分类）"
                value={batchDomainId}
                onChange={setBatchDomainId}
                options={[
                  { label: '-- 清除分类 --', value: null },
                  ...getDomainSelectOptions(domains)
                    .filter(option => option.value !== 0) // 过滤掉"全部"选项（0），因为批量设置时不能设置为"全部"
                ]}
              />
            </Form.Item>
          </Form>
        </div>
      </Modal>


      {/* 添加分类Modal */}
      <Modal
        title="添加分类"
        open={isAddingDomain}
        onCancel={() => {
          setIsAddingDomain(false);
          setNewDomainName('');
          setNewDomainParentId(undefined);
        }}
        onOk={async () => {
          if (!newDomainName.trim()) {
            message.warning('分类名称不能为空');
            return;
          }
          
          try {
            await ipcApi.addDomain({
              name: newDomainName.trim(),
              parent_id: newDomainParentId
            });
            message.success('分类创建成功');
            setIsAddingDomain(false);
            setNewDomainName('');
            setNewDomainParentId(undefined);
            await loadDomains();
          } catch (error) {
            message.error('创建分类失败');
          }
        }}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Form.Item label="分类名称">
            <Input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              placeholder="请输入分类名称"
              autoFocus
            />
          </Form.Item>
          <Form.Item label="父级分类">
            <TreeSelect
              style={{ width: '100%' }}
              placeholder="选择父级分类（可选）"
              value={newDomainParentId}
              onChange={(value) => setNewDomainParentId(value)}
              treeData={[
                { label: '顶级分类', value: undefined },
                ...domains.map(d => ({ label: d.name, value: d.id }))
              ]}
              allowClear
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#666' }}>
            提示：选择父级分类可将此分类作为子分类创建
          </div>
        </Space>
      </Modal>

      {/* AI补全建议Modal */}
      <Modal
        title={`AI补全建议 - ${currentTermForAI?.term_text || '术语'}`}
        open={isAICompletionVisible}
        onCancel={() => {
          setIsAICompletionVisible(false);
          setCurrentTermForAI(null);
          setAiSuggestions(null);
        }}
        onOk={handleApplyAISuggestion}
        okText="应用建议"
        cancelText="取消"
        width={600}
      >
        {currentTermForAI && (
          aiCompletionLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, fontSize: 16, color: '#666' }}>
                正在获取AI建议...
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: '#999' }}>
                请稍等，AI正在分析术语并生成建议
              </div>
            </div>
          ) : aiSuggestions ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ padding: 8, backgroundColor: '#f6f6f6', borderRadius: 4 }}>
                <div><strong>源术语：</strong>{currentTermForAI.term_text}</div>
                <div><strong>源语言：</strong>{currentTermForAI.source_lang}</div>
              </div>
              
              {/* 译文建议 */}
              {aiSuggestions.translation && (
                <div>
                  <h4 style={{ marginBottom: 8 }}>译文建议</h4>
                  <Input.TextArea
                    rows={2}
                    value={aiSuggestions.translation.text}
                    onChange={(e) => setAiSuggestions({
                      ...aiSuggestions,
                      translation: { ...aiSuggestions.translation!, text: e.target.value }
                    })}
                    placeholder="AI建议的译文"
                  />
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>语言：</span>
                    <Select
                      value={aiSuggestions.translation.lang}
                      onChange={(value) => setAiSuggestions({
                        ...aiSuggestions,
                        translation: { ...aiSuggestions.translation!, lang: value }
                      })}
                      style={{ width: 120 }}
                      options={[
                        { label: '中文', value: 'zh' },
                        { label: '英文', value: 'en' },
                        { label: '日文', value: 'ja' },
                        { label: '韩文', value: 'ko' },
                        { label: '法文', value: 'fr' },
                        { label: '德文', value: 'de' },
                        { label: '西班牙文', value: 'es' }
                      ]}
                    />
                    <span>置信度：{aiSuggestions.translation.confidence.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    目标语言：根据当前设置，应为 
                    <Tag color="blue" style={{ marginLeft: 4 }}>
                      {(() => {
                        // 智能计算目标语言：外文术语→中文，中文术语→外文
                        const sourceLang = currentTermForAI?.source_lang || 'zh';
                        
                        // 如果是外文术语（源语言≠zh），目标语言必须是中文
                        if (sourceLang !== 'zh') {
                          return 'zh';
                        }
                        
                        // 中文术语：可以使用用户指定的全局目标语言（如果是外文）
                        // 否则使用术语已有的目标语言，最后使用默认英文
                        if (globalTargetLang && globalTargetLang !== 'zh' && getSupportedTargetLanguages('zh').includes(globalTargetLang)) {
                          return globalTargetLang;
                        }
                        
                        if (currentTermForAI?.target_lang && currentTermForAI.target_lang !== 'zh') {
                          return currentTermForAI.target_lang;
                        }
                        
                        return 'en';
                      })()}
                    </Tag>
                    {aiSuggestions.translation.lang !== (() => {
                        // 使用相同的逻辑计算默认目标语言
                        const sourceLang = currentTermForAI?.source_lang || 'zh';
                        
                        if (sourceLang !== 'zh') {
                          return 'zh';
                        }
                        
                        if (globalTargetLang && globalTargetLang !== 'zh' && getSupportedTargetLanguages('zh').includes(globalTargetLang)) {
                          return globalTargetLang;
                        }
                        
                        if (currentTermForAI?.target_lang && currentTermForAI.target_lang !== 'zh') {
                          return currentTermForAI.target_lang;
                        }
                        
                        return 'en';
                      })() && (
                      <span style={{ marginLeft: 8, color: '#faad14' }}>
                        （注意：当前选择与默认译入语不一致）
                      </span>
                    )}
                  </div>
                </div>
              )}
              
              {/* 简称建议 */}
              {aiSuggestions.abbreviation && (
                <div>
                  <h4 style={{ marginBottom: 8 }}>简称建议</h4>
                  <Input
                    value={aiSuggestions.abbreviation.text}
                    onChange={(e) => setAiSuggestions({
                      ...aiSuggestions,
                      abbreviation: { ...aiSuggestions.abbreviation!, text: e.target.value }
                    })}
                    placeholder="AI建议的简称"
                  />
                  <div style={{ marginTop: 4 }}>
                    置信度：{aiSuggestions.abbreviation.confidence.toFixed(2)}
                  </div>
                </div>
              )}
              
              {/* AI注释功能 - 二次请求 */}
              <div>
                <h4 style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>AI注释</span>
                  <Button 
                    type="link" 
                    size="small" 
                    loading={aiCommentLoading}
                    onClick={async () => {
                      if (!currentTermForAI || aiCommentLoading) return;
                      
                      setAiCommentLoading(true);
                      try {
                        // 请求AI建议，现在包含专业定义和背景信息
                        const res = await ipcApi.getAITermSuggestion({
                          termId: currentTermForAI.id,
                          termText: currentTermForAI.term_text,
                          sourceLang: currentTermForAI.source_lang,
                          targetLang: currentTermForAI.source_lang === 'zh' ? 'en' : 'zh',
                          hasTranslation: !!currentTermForAI.target_text,
                          hasDomain: !!currentTermForAI.domain_id
                        });
                        
                        if (res.success && res.data) {
                          // 基于AI建议创建专业的注释，仅包含定义和背景信息
                          let comment = '';
                          if (res.data.definition) {
                            comment += `定义: ${res.data.definition.definition}\n`;
                          }
                          if (res.data.definition && res.data.definition.background) {
                            comment += `\n背景信息: ${res.data.definition.background}`;
                          }
                          
                          // 如果AI没有返回定义信息，则使用降级建议
                          if (!comment.trim()) {
                            // 使用其他AI建议作为备选
                            if (res.data.translation) {
                              comment += `翻译建议: ${res.data.translation.text} (${res.data.translation.lang})`;
                            }
                            if (res.data.abbreviation) {
                              if (comment) comment += '\n';
                              comment += `缩写建议: ${res.data.abbreviation.text}`;
                            }
                          }
                          
                          setAiCommentText(comment.trim());
                          message.success('AI注释已生成（基于AI补全建议）');
                        } else {
                          // 生成基础注释建议
                          const baseComment = `术语: ${currentTermForAI.term_text}\n源语言: ${currentTermForAI.source_lang}\n分类: ${currentTermForAI.domain_id ? '已分类' : '未分类'}\n翻译状态: ${currentTermForAI.target_text ? '已翻译' : '待翻译'}`;
                          setAiCommentText(baseComment);
                          message.success('基础AI注释已生成');
                        }
                      } catch (error: any) {
                        console.error('生成AI注释失败:', error);
                        // 生成一个基本的注释作为回退
                        const fallbackComment = `术语: ${currentTermForAI.term_text}\n源语言: ${currentTermForAI.source_lang}\n创建时间: ${new Date().toLocaleDateString()}`;
                        setAiCommentText(fallbackComment);
                        message.success('基础注释已生成');
                      } finally {
                        setAiCommentLoading(false);
                      }
                    }}
                  >
                    {aiCommentText ? '重新生成' : '生成AI注释'}
                  </Button>
                </h4>
                <Input.TextArea
                  rows={3}
                  value={aiCommentText}
                  onChange={(e) => setAiCommentText(e.target.value)}
                  placeholder="点击上方按钮生成AI注释，或手动输入术语注释、解释或背景信息"
                  disabled={aiCommentLoading}
                />
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Checkbox
                    checked={applyCommentToTerm}
                    onChange={(e) => setApplyCommentToTerm(e.target.checked)}
                  >
                    应用此注释到术语描述字段
                  </Checkbox>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    {aiCommentLoading ? '正在生成...' : aiCommentText ? '注释已生成' : '点击生成按钮获取AI建议'}
                  </span>
                </div>
              </div>
              
              <div style={{ paddingTop: 16, borderTop: '1px solid #eee' }}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  <strong>应用说明：</strong>AI建议将自动填充术语的空缺字段。已锁定的术语不会显示AI补全按钮。
                </div>
              </div>
            </Space>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 16, color: '#666' }}>
                未能获取AI建议
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: '#999' }}>
                请检查AI配置或网络连接，然后重试
              </div>
            </div>
          )
        )}
      </Modal>
        
        {/* 高级搜索Modal */}
        <Modal
          title="高级搜索"
          open={isAdvancedSearchVisible}
          onCancel={() => setIsAdvancedSearchVisible(false)}
          footer={null}
          width={600}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
          <Form layout="vertical">
            <Form.Item label="关键词">
              <Input
                placeholder="术语或译文内容"
                value={advancedSearchParams.keyword}
                onChange={(e) => setAdvancedSearchParams({...advancedSearchParams, keyword: e.target.value})}
                allowClear
              />
            </Form.Item>
            
            <Form.Item label="源语言">
              <Select
                mode="multiple"
                placeholder="选择源语言"
                value={advancedSearchParams.sourceLangs}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, sourceLangs: value})}
                allowClear
                style={{ width: '100%' }}
                options={[
                  { label: '中文', value: 'zh' },
                  { label: '英文', value: 'en' },
                  { label: '日文', value: 'ja' },
                  { label: '韩文', value: 'ko' },
                  { label: '法文', value: 'fr' },
                  { label: '德文', value: 'de' },
                  { label: '西班牙文', value: 'es' }
                ]}
              />
            </Form.Item>
            
            <Form.Item label="目标语言">
              <Select
                mode="multiple"
                placeholder="选择目标语言"
                value={advancedSearchParams.targetLangs}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, targetLangs: value})}
                allowClear
                style={{ width: '100%' }}
                options={[
                  { label: '中文', value: 'zh' },
                  { label: '英文', value: 'en' },
                  { label: '日文', value: 'ja' },
                  { label: '韩文', value: 'ko' },
                  { label: '法文', value: 'fr' },
                  { label: '德文', value: 'de' },
                  { label: '西班牙文', value: 'es' }
                ]}
              />
            </Form.Item>
            
            <Form.Item label="领域">
              <TreeSelect
                treeData={buildDomainTree(domains, domainCounts)}
                placeholder="选择领域"
                value={advancedSearchParams.domains}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, domains: value})}
                treeCheckable
                showCheckedStrategy="SHOW_PARENT"
                allowClear
                style={{ width: '100%' }}
              />
            </Form.Item>
            
            <Form.Item label="锁定状态">
              <Select
                placeholder="选择锁定状态"
                value={advancedSearchParams.locked}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, locked: value})}
                allowClear
                style={{ width: '100%' }}
                options={[
                  { label: '已锁定', value: true },
                  { label: '未锁定', value: false }
                ]}
              />
            </Form.Item>
            
            <Form.Item label="译文状态">
              <Select
                placeholder="选择译文状态"
                value={advancedSearchParams.hasTranslation}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, hasTranslation: value})}
                allowClear
                style={{ width: '100%' }}
                options={[
                  { label: '有译文', value: true },
                  { label: '无译文', value: false }
                ]}
              />
            </Form.Item>
            
            <Form.Item label="收藏状态">
              <Select
                placeholder="选择收藏状态"
                value={advancedSearchParams.favorite}
                onChange={(value) => setAdvancedSearchParams({...advancedSearchParams, favorite: value})}
                allowClear
                style={{ width: '100%' }}
                options={[
                  { label: '已收藏', value: true },
                  { label: '未收藏', value: false }
                ]}
              />
            </Form.Item>
          </Form>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => {
              setAdvancedSearchParams({
                keyword: '',
                domains: [],
                sourceLangs: [],
                targetLangs: [],
                locked: undefined,
                hasTranslation: undefined,
                favorite: undefined
              });
            }}>
              重置条件
            </Button>
            <Button type="primary" onClick={async () => {
              setIsAdvancedSearchVisible(false);
              setPage(1);
              await loadTerms();
            }}>
              开始搜索
            </Button>
          </div>
        </Space>
      </Modal>

      {/* 导出对话框 */}
      <Modal
        title="导出设置"
        open={isExportDialogVisible}
        onCancel={() => setIsExportDialogVisible(false)}
        onOk={exportTerms}
        okText="导出"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>选择导出格式</strong>
            <Radio.Group
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              style={{ marginTop: 8 }}
            >
              <Radio value="csv">CSV (Excel兼容)</Radio>
              <Radio value="json">JSON (结构化数据)</Radio>
            </Radio.Group>
          </div>
          
          <Divider />
          
          <div>
            <strong>选择包含字段</strong>
            <Checkbox.Group
              value={exportIncludeFields}
              onChange={(values) => setExportIncludeFields(values as string[])}
              style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}
            >
              <Checkbox value="id">ID</Checkbox>
              <Checkbox value="source_lang">源语言</Checkbox>
              <Checkbox value="term_text">术语原文</Checkbox>
              <Checkbox value="abbreviation">简称</Checkbox>
              <Checkbox value="target_lang">目标语言</Checkbox>
              <Checkbox value="target_text">术语译文</Checkbox>
              <Checkbox value="domain">领域</Checkbox>
              <Checkbox value="description">注释</Checkbox>
              <Checkbox value="created_at">创建时间</Checkbox>
              <Checkbox value="updated_at">更新时间</Checkbox>
            </Checkbox.Group>
          </div>
          
          <Divider />
          
          <div style={{ fontSize: 12, color: '#666' }}>
            <p><strong>提示：</strong></p>
            <p>• CSV格式适合Excel查看和编辑，支持中文</p>
            <p>• JSON格式适合程序读取和导入，包含完整数据结构</p>
            <p>• 导出的文件将包含所有当前显示的术语（包括筛选后的结果）</p>
          </div>
        </Space>
      </Modal>

      <TermDetail
        term={selectedTerm}
        visible={isDetailVisible}
        onClose={() => setIsDetailVisible(false)}
        onUpdate={handleTermUpdate}
      />
    </Layout>
  );
}
