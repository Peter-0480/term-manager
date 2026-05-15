/**
 * TranslationPopover 表格内多语翻译预览/快速编辑组件
 * 
 * 功能：
 * - 在表格单元格中显示主译文 + 多语种指示器
 * - 悬停或点击可查看所有译文
 * - 支持快速编辑译文
 */

import React, { useState } from 'react';
import { Popover, Tag, Space, Input, Button, message, Tooltip } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined, MoreOutlined } from '@ant-design/icons';
import {
  LANGUAGE_INFO,
  LANGUAGE_EMOJI,
  getLanguagePairShortLabel,
  getDefaultTargetLang,
} from '../utils/language-utils';
import type { TranslationEntry } from './TranslationEditor';

interface TranslationPopoverProps {
  /** 源语言 */
  sourceLang: string;
  /** 翻译列表 */
  translations: TranslationEntry[];
  /** 主译文语言代码（默认根据源语言自动推导） */
  primaryLang?: string;
  /** 主译文文本（兼容旧数据） */
  legacyTargetText?: string;
  /** 旧数据的目标语言（兼容旧数据） */
  legacyTargetLang?: string;
  /** 译文变更回调 */
  onTranslationChange?: (translations: TranslationEntry[]) => void;
  /** 是否只读 */
  readOnly?: boolean;
}

/** 获取主译文 */
function getPrimaryTranslation(
  translations: TranslationEntry[],
  primaryLang: string,
  legacyTargetText?: string,
  legacyTargetLang?: string,
): { text: string; lang: string } | null {
  // 优先从 translations 数组中查找
  const primary = translations.find(t => t.language_code === primaryLang);
  if (primary?.text) {
    return { text: primary.text, lang: primary.language_code };
  }

  // 如果有其他译文，返回第一个
  if (translations.length > 0 && translations[0].text) {
    return { text: translations[0].text, lang: translations[0].language_code };
  }

  // 兼容旧数据
  if (legacyTargetText && legacyTargetLang) {
    return { text: legacyTargetText, lang: legacyTargetLang };
  }

  return null;
}

const TranslationPopover: React.FC<TranslationPopoverProps> = ({
  sourceLang,
  translations,
  primaryLang,
  legacyTargetText,
  legacyTargetLang,
  onTranslationChange,
  readOnly = false,
}) => {
  const [editingLang, setEditingLang] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const defaultPrimaryLang = primaryLang || getDefaultTargetLang(sourceLang);
  const primary = getPrimaryTranslation(translations, defaultPrimaryLang, legacyTargetText, legacyTargetLang);
  const otherTranslations = translations.filter(t => t.language_code !== defaultPrimaryLang && t.text);

  // 开始编辑
  const startEdit = (lang: string, currentText: string) => {
    if (readOnly) return;
    setEditingLang(lang);
    setEditText(currentText);
  };

  // 保存编辑
  const saveEdit = () => {
    if (!editingLang || !onTranslationChange) return;
    if (!editText.trim()) {
      message.warning('译文内容不能为空');
      return;
    }

    const updated = translations.map(t => {
      if (t.language_code === editingLang) {
        return { ...t, text: editText.trim() };
      }
      return t;
    });

    // 如果编辑的语言不在列表中，添加新条目
    if (!translations.find(t => t.language_code === editingLang)) {
      updated.push({
        key: `trans_popover_${Date.now()}`,
        language_code: editingLang,
        text: editText.trim(),
        isNew: true,
      });
    }

    onTranslationChange(updated);
    setEditingLang(null);
    setEditText('');
    message.success('译文已更新');
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingLang(null);
    setEditText('');
  };

  // 渲染译文内容
  const renderContent = () => {
    const allEntries = [...translations];

    // 如果有旧数据但不在 translations 中，添加为只读条目
    if (legacyTargetText && legacyTargetLang && !allEntries.find(t => t.language_code === legacyTargetLang)) {
      allEntries.unshift({
        key: 'legacy',
        language_code: legacyTargetLang,
        text: legacyTargetText,
      });
    }

    if (allEntries.length === 0) {
      return <div style={{ color: '#999', fontStyle: 'italic', padding: 8 }}>暂无译文</div>;
    }

    return (
      <div style={{ minWidth: 250, maxWidth: 400 }}>
        {allEntries.map((entry, index) => {
          const isEditing = editingLang === entry.language_code;
          const info = LANGUAGE_INFO[entry.language_code];
          const emoji = LANGUAGE_EMOJI[entry.language_code] || '';
          const directionLabel = getLanguagePairShortLabel(sourceLang, entry.language_code);

          return (
            <div
              key={entry.key || entry.language_code}
              style={{
                padding: '6px 0',
                borderBottom: index < allEntries.length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Tag style={{ margin: 0, flexShrink: 0 }}>{directionLabel}</Tag>
              <span style={{ flexShrink: 0, fontSize: 12, color: '#666', width: 60 }}>
                {emoji} {info?.label}
              </span>
              {isEditing ? (
                <>
                  <Input
                    size="small"
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onPressEnter={saveEdit}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={saveEdit}
                    style={{ color: '#52c41a', flexShrink: 0 }}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={cancelEdit}
                    style={{ color: '#ff4d4f', flexShrink: 0 }}
                  />
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>
                    {entry.text || (
                      <span style={{ color: '#999', fontStyle: 'italic' }}>待翻译</span>
                    )}
                  </span>
                  {!readOnly && (
                    <Tooltip title="快速编辑">
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => startEdit(entry.language_code, entry.text || '')}
                        style={{ flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 主译文显示
  const renderPrimaryDisplay = () => {
    if (primary) {
      const info = LANGUAGE_INFO[primary.lang];
      const emoji = LANGUAGE_EMOJI[primary.lang] || '';
      return (
        <span>
          <Tag color="green" style={{ marginRight: 4 }}>{emoji}</Tag>
          {primary.text}
          {otherTranslations.length > 0 && (
            <Tag
              color="blue"
              style={{ marginLeft: 6, cursor: 'pointer', fontSize: 11 }}
            >
              +{otherTranslations.length} 更多
            </Tag>
          )}
        </span>
      );
    }

    // 无译文
    return (
      <span>
        <Tag color="orange" style={{ marginRight: 4 }}>
          {LANGUAGE_EMOJI[defaultPrimaryLang]}
        </Tag>
        <span style={{ color: '#999', fontStyle: 'italic' }}>待翻译</span>
      </span>
    );
  };

  return (
    <Popover
      content={renderContent()}
      title={
        <div style={{ fontSize: 12, color: '#666' }}>
          多语翻译
          <Tag style={{ marginLeft: 8 }}>
            {LANGUAGE_EMOJI[sourceLang]} → {translations.map(t => LANGUAGE_EMOJI[t.language_code]).join(' | ')}
          </Tag>
        </div>
      }
      trigger="click"
      placement="bottomLeft"
      overlayStyle={{ maxWidth: 450 }}
    >
      <span style={{ cursor: 'pointer' }}>
        {renderPrimaryDisplay()}
      </span>
    </Popover>
  );
};

export default TranslationPopover;
