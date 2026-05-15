/**
 * TranslationEditor 多语翻译编辑器组件
 * 
 * 功能：
 * - 根据源语言动态过滤目标语言选项
 * - 支持添加/编辑/删除多条译文
 * - 自动校验语言对合法性
 * - 显示翻译方向标记
 * 
 * 使用场景：
 * - 新增/编辑术语弹窗
 * - 术语详情页的"多语翻译"Tab
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Select, Input, Tag, Space, message, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  MOTHER_TONGUE,
  FOREIGN_LANGUAGES,
  LANGUAGE_INFO,
  LANGUAGE_EMOJI,
  getSupportedTargetLanguages,
  isValidLanguagePair,
  getLanguagePairShortLabel,
  getDefaultTargetLang,
} from '../utils/language-utils';

/** 翻译条目接口 */
export interface TranslationEntry {
  /** 唯一标识（临时ID，用于前端列表渲染） */
  key: string;
  /** 语言代码 */
  language_code: string;
  /** 译文文本 */
  text: string;
  /** 置信度（0-1） */
  confidence?: number;
  /** 来源 */
  source?: string;
  /** 是否为新增（未保存到数据库） */
  isNew?: boolean;
}

interface TranslationEditorProps {
  /** 源语言代码 */
  sourceLang: string;
  /** 当前翻译列表 */
  translations: TranslationEntry[];
  /** 翻译列表变更回调 */
  onChange: (translations: TranslationEntry[]) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 最大翻译数量（中文源语言时默认10，外文源语言时默认1） */
  maxTranslations?: number;
  /** 是否显示置信度列 */
  showConfidence?: boolean;
}

/** 生成临时key */
const generateKey = (): string => `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/** 获取已使用的语言代码集合 */
function getUsedLanguages(translations: TranslationEntry[]): Set<string> {
  return new Set(translations.map(t => t.language_code));
}

/** 获取可选的目标语言列表 */
function getAvailableTargetLangs(sourceLang: string, usedLangs: Set<string>): string[] {
  const supported = getSupportedTargetLanguages(sourceLang);
  return supported.filter(lang => !usedLangs.has(lang));
}

const TranslationEditor: React.FC<TranslationEditorProps> = ({
  sourceLang,
  translations,
  onChange,
  readOnly = false,
  maxTranslations,
  showConfidence = false,
}) => {
  // 编辑状态
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editLang, setEditLang] = useState<string>('');
  const [editConfidence, setEditConfidence] = useState<number>(0);

  // 添加状态
  const [addingNew, setAddingNew] = useState(false);
  const [newLang, setNewLang] = useState<string>('');
  const [newText, setNewText] = useState('');

  // 计算最大翻译数
  const effectiveMax = maxTranslations ?? (sourceLang === MOTHER_TONGUE ? FOREIGN_LANGUAGES.length : 1);
  const usedLangs = getUsedLanguages(translations);
  const availableLangs = getAvailableTargetLangs(sourceLang, usedLangs);
  const canAdd = !readOnly && availableLangs.length > 0 && translations.length < effectiveMax;

  // 当源语言变化时，自动清理不合法的翻译
  useEffect(() => {
    const validTranslations = translations.filter(t =>
      isValidLanguagePair(sourceLang, t.language_code)
    );
    if (validTranslations.length !== translations.length) {
      onChange(validTranslations);
    }
  }, [sourceLang]);

  // 开始编辑
  const startEdit = (entry: TranslationEntry) => {
    if (readOnly) return;
    setEditingKey(entry.key);
    setEditText(entry.text);
    setEditLang(entry.language_code);
    setEditConfidence(entry.confidence || 0);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingKey(null);
    setEditText('');
    setEditLang('');
    setEditConfidence(0);
  };

  // 保存编辑
  const saveEdit = () => {
    if (!editingKey) return;
    if (!editText.trim()) {
      message.warning('译文内容不能为空');
      return;
    }

    const updated = translations.map(t => {
      if (t.key === editingKey) {
        return {
          ...t,
          text: editText.trim(),
          language_code: editLang,
          confidence: editConfidence,
        };
      }
      return t;
    });

    onChange(updated);
    cancelEdit();
  };

  // 删除翻译
  const handleDelete = (key: string) => {
    const updated = translations.filter(t => t.key !== key);
    onChange(updated);
  };

  // 开始添加
  const startAdd = () => {
    if (availableLangs.length === 0) {
      message.warning('所有可用语种已添加');
      return;
    }
    setAddingNew(true);
    setNewLang(availableLangs[0]);
    setNewText('');
  };

  // 取消添加
  const cancelAdd = () => {
    setAddingNew(false);
    setNewLang('');
    setNewText('');
  };

  // 确认添加
  const confirmAdd = () => {
    if (!newLang) {
      message.warning('请选择目标语种');
      return;
    }
    if (!newText.trim()) {
      message.warning('请输入译文内容');
      return;
    }

    const newEntry: TranslationEntry = {
      key: generateKey(),
      language_code: newLang,
      text: newText.trim(),
      isNew: true,
    };

    onChange([...translations, newEntry]);
    cancelAdd();
  };

  // 语言选择器选项
  const langOptions = (sourceLang === MOTHER_TONGUE ? FOREIGN_LANGUAGES : [MOTHER_TONGUE]).map(code => ({
    label: `${LANGUAGE_EMOJI[code] || ''} ${LANGUAGE_INFO[code]?.label || code}`,
    value: code,
    disabled: usedLangs.has(code) && code !== editingKey,
  }));

  // 表格列定义
  const columns = [
    {
      title: '翻译方向',
      key: 'direction',
      width: 100,
      render: (_: any, record: TranslationEntry) => {
        const label = getLanguagePairShortLabel(sourceLang, record.language_code);
        return <Tag>{label}</Tag>;
      },
    },
    {
      title: '目标语种',
      dataIndex: 'language_code',
      key: 'language_code',
      width: 140,
      render: (code: string, record: TranslationEntry) => {
        if (editingKey === record.key) {
          return (
            <Select
              size="small"
              value={editLang}
              onChange={setEditLang}
              style={{ width: 120 }}
              options={langOptions}
            />
          );
        }
        const info = LANGUAGE_INFO[code];
        const emoji = LANGUAGE_EMOJI[code] || '';
        return (
          <span>
            {emoji} {info?.label || code}
            <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>
              ({info?.native || code})
            </span>
          </span>
        );
      },
    },
    {
      title: '译文',
      dataIndex: 'text',
      key: 'text',
      render: (text: string, record: TranslationEntry) => {
        if (editingKey === record.key) {
          return (
            <Input
              size="small"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onPressEnter={saveEdit}
              style={{ width: 200 }}
              autoFocus
            />
          );
        }
        return text || <span style={{ color: '#999', fontStyle: 'italic' }}>待翻译</span>;
      },
    },
    ...(showConfidence
      ? [
          {
            title: '置信度',
            dataIndex: 'confidence',
            key: 'confidence',
            width: 100,
            render: (confidence: number | undefined, record: TranslationEntry) => {
              if (editingKey === record.key) {
                return (
                  <Select
                    size="small"
                    value={editConfidence}
                    onChange={setEditConfidence}
                    style={{ width: 80 }}
                    options={[
                      { label: '高 (1.0)', value: 1.0 },
                      { label: '中 (0.7)', value: 0.7 },
                      { label: '低 (0.4)', value: 0.4 },
                      { label: '待定 (0)', value: 0 },
                    ]}
                  />
                );
              }
              if (confidence === undefined || confidence === 0) return '-';
              const color = confidence >= 0.8 ? 'green' : confidence >= 0.5 ? 'orange' : 'red';
              return <Tag color={color}>{(confidence * 100).toFixed(0)}%</Tag>;
            },
          },
        ]
      : []),
    ...(!readOnly
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 100,
            render: (_: any, record: TranslationEntry) => {
              if (editingKey === record.key) {
                return (
                  <Space>
                    <Button
                      type="link"
                      size="small"
                      icon={<CheckOutlined />}
                      onClick={saveEdit}
                      style={{ color: '#52c41a' }}
                    />
                    <Button
                      type="link"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={cancelEdit}
                      style={{ color: '#ff4d4f' }}
                    />
                  </Space>
                );
              }
              return (
                <Space>
                  <Tooltip title="编辑译文">
                    <Button
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => startEdit(record)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="确认删除此译文？"
                    onConfirm={() => handleDelete(record.key)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Tooltip title="删除译文">
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                      />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              );
            },
          },
        ]
      : []),
  ];

  // 添加行
  const addRow = addingNew ? (
    <div
      style={{
        padding: '8px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Tag style={{ marginRight: 8 }}>
        {getLanguagePairShortLabel(sourceLang, newLang || '?')}
      </Tag>
      <Select
        size="small"
        value={newLang}
        onChange={setNewLang}
        style={{ width: 130 }}
        options={availableLangs.map(code => ({
          label: `${LANGUAGE_EMOJI[code] || ''} ${LANGUAGE_INFO[code]?.label || code}`,
          value: code,
        }))}
      />
      <Input
        size="small"
        value={newText}
        onChange={e => setNewText(e.target.value)}
        placeholder="输入译文"
        style={{ width: 200 }}
        onPressEnter={confirmAdd}
        autoFocus
      />
      <Button
        type="link"
        size="small"
        icon={<CheckOutlined />}
        onClick={confirmAdd}
        style={{ color: '#52c41a' }}
      />
      <Button
        type="link"
        size="small"
        icon={<CloseOutlined />}
        onClick={cancelAdd}
        style={{ color: '#ff4d4f' }}
      />
    </div>
  ) : null;

  return (
    <div>
      {/* 翻译方向提示 */}
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
        <Tag color="blue" style={{ marginRight: 4 }}>
          {LANGUAGE_EMOJI[sourceLang]} {LANGUAGE_INFO[sourceLang]?.label || sourceLang}
        </Tag>
        <span style={{ margin: '0 4px' }}>→</span>
        {translations.length > 0 ? (
          <span>
            {translations.map((t, i) => (
              <React.Fragment key={t.key}>
                {i > 0 && <span style={{ margin: '0 4px', color: '#d9d9d9' }}>|</span>}
                <Tag>{LANGUAGE_EMOJI[t.language_code]} {LANGUAGE_INFO[t.language_code]?.label || t.language_code}</Tag>
              </React.Fragment>
            ))}
          </span>
        ) : (
          <span style={{ color: '#999' }}>（尚未添加译文）</span>
        )}
      </div>

      {/* 翻译列表 */}
      <Table
        rowKey="key"
        columns={columns}
        dataSource={translations}
        pagination={false}
        size="small"
        showHeader={translations.length > 0}
        style={{ marginBottom: 8 }}
        locale={{ emptyText: '暂无译文' }}
      />

      {/* 添加行 */}
      {addRow}

      {/* 添加按钮 */}
      {canAdd && !addingNew && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={startAdd}
          block
        >
          添加{sourceLang === MOTHER_TONGUE ? '外文' : ''}译文
          {availableLangs.length > 0 && (
            <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>
              （可选：{availableLangs.map(c => LANGUAGE_INFO[c]?.label).join('、')}）
            </span>
          )}
        </Button>
      )}

      {/* 翻译数量提示 */}
      {translations.length > 0 && (
        <div style={{ fontSize: 11, color: '#999', marginTop: 4, textAlign: 'right' }}>
          共 {translations.length} 条译文
          {effectiveMax > 1 && ` / 最多 ${effectiveMax} 条`}
        </div>
      )}
    </div>
  );
};

export default TranslationEditor;
