import { useState, useEffect } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  Select,
  Button,
  Table,
  Space,
  Tag,
  message,
  InputNumber,
  Divider,
  Typography,
  Popconfirm,
  Rate
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  CheckOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { ipcApi } from '../ipc-api';
import TranslationEditor from './TranslationEditor';
import type { TranslationEntry } from './TranslationEditor';
import { getLanguageSelectOptions, getTargetLanguageSelectOptions } from '../utils/language-utils';

const { Text } = Typography;
const { TabPane } = Tabs;

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
  translations?: Translation[]; // 多语言翻译
}

interface TermRelation {
  id: number;
  term_id: number;
  relation_type: 'synonym' | 'near_synonym' | 'polysemy' | 'antonym' | 'related';
  related_term_id: number;
  note?: string;
  created_at: string;
  term_text?: string;
  source_lang?: string;
  target_text?: string;
  target_lang?: string;
}

interface TermSource {
  id: number;
  term_id: number;
  source_type: 'web_extract' | 'plain_text' | 'high_quality' | 'official' | 'manual' | 'ai_extract';
  source_detail?: string;
  credibility_score: number;
  created_at: string;
}

interface Domain {
  id: number;
  name: string;
  parent_id?: number;
  description?: string;
}

interface TermDetailProps {
  term: Term | null;
  visible: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

const sourceTypeOptions = [
  { label: '网络提取', value: 'web_extract' },
  { label: '普通文本', value: 'plain_text' },
  { label: '高质量文本', value: 'high_quality' },
  { label: '官方数据', value: 'official' },
  { label: '人工认证', value: 'manual' },
  { label: 'AI提取', value: 'ai_extract' }
];

const relationTypeOptions = [
  { label: '同义词', value: 'synonym' },
  { label: '近义词', value: 'near_synonym' },
  { label: '一词多义', value: 'polysemy' },
  { label: '反义词', value: 'antonym' },
  { label: '相关词', value: 'related' }
];

export default function TermDetail({ term, visible, onClose, onUpdate }: TermDetailProps) {
  const [form] = Form.useForm();
  const [relationForm] = Form.useForm();
  const [sourceForm] = Form.useForm();
  const [translationForm] = Form.useForm();
  const [relations, setRelations] = useState<TermRelation[]>([]);
  const [sources, setSources] = useState<TermSource[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [targetTextKey, setTargetTextKey] = useState(0); // 用于强制刷新 target_text 输入框

  /**
   * 将 translations 数组中对应目标语言的译文同步到基本信息表单
   */
  const syncTargetText = (targetLang: string | undefined) => {
    if (!targetLang) {
      form.setFieldsValue({ target_text: '' });
      return;
    }
    const trans = translations.find(t => t.language_code === targetLang);
    form.setFieldsValue({ target_text: trans?.text || '' });
    setTargetTextKey(prev => prev + 1);
  };

  // 当 translations 数据加载完成后，同步当前目标语言的译文到表单
  useEffect(() => {
    if (translations.length > 0) {
      const targetLang = form.getFieldValue('target_lang');
      if (targetLang) {
        syncTargetText(targetLang);
      }
    }
  }, [translations]);

  useEffect(() => {
    if (term && visible) {
      loadTermData();
      loadAllTerms();
      loadDomains();
      form.setFieldsValue({
        ...term,
        abbreviation: term.abbreviation || '',
        description: term.description || ''
      });
    }
  }, [term, visible]);

  const loadTermData = async () => {
    if (!term) return;
    
    try {
      setLoading(true);
      const [relationsRes, sourcesRes, translationsRes] = await Promise.all([
        ipcApi.getTermRelations(term.id),
        ipcApi.getTermSources(term.id),
        ipcApi.getTranslations(term.id)
      ]);

      if (relationsRes.success) {
        setRelations(relationsRes.data || []);
      }

      if (sourcesRes.success) {
        setSources(sourcesRes.data || []);
      }
      
      if (translationsRes.success) {
        setTranslations(translationsRes.data || []);
      }
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadAllTerms = async () => {
    try {
      const res = await ipcApi.getTerms({ page: 1, pageSize: 1000 });
      if (res.success) {
        setTerms(res.data || []);
      }
    } catch (error) {
      console.error('加载术语列表失败:', error);
    }
  };

  const loadDomains = async () => {
    try {
      const res = await ipcApi.getDomains();
      if (res.success) {
        setDomains(res.data || []);
      }
    } catch (error) {
      console.error('加载领域列表失败:', error);
    }
  };

  const handleUpdateTerm = async (values: any) => {
    if (!term) return;
    
    try {
      const res = await ipcApi.updateTerm(term.id, values);
      if (res.success) {
        // 同步目标语言译文到 translations 数组
        const targetLang = values.target_lang;
        const targetText = values.target_text;
        if (targetLang) {
          const existing = translations.find(t => t.language_code === targetLang);
          if (existing?.id && targetText !== undefined) {
            // 更新已有译文
            await ipcApi.updateTranslation(existing.id, {
              text: targetText,
              confidence: existing.confidence || 1.0,
            });
          } else if (!existing && targetText && targetText.trim()) {
            // 添加新译文
            await ipcApi.addTranslation({
              term_id: term.id,
              language_code: targetLang,
              text: targetText.trim(),
              confidence: 1.0,
              source: 'manual',
            });
          }
          // 如果 targetText 为空且已有译文存在，可以考虑删除（或留空）- 此处保持现有译文不变
        }

        message.success('术语更新成功');
        loadTermData(); // 重新加载以刷新 translations 状态
        onUpdate();
      } else {
        message.error(res.error || '更新失败');
      }
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleAddRelation = async (values: any) => {
    if (!term) return;
    
    try {
      const res = await ipcApi.addTermRelation({
        term_id: term.id,
        ...values
      });
      
      if (res.success) {
        message.success('关系添加成功');
        relationForm.resetFields();
        loadTermData();
      } else {
        message.error(res.error || '添加失败');
      }
    } catch (error) {
      message.error('添加失败');
    }
  };

  const handleDeleteRelation = async (id: number) => {
    try {
      const res = await ipcApi.deleteTermRelation(id);
      if (res.success) {
        message.success('关系删除成功');
        loadTermData();
      } else {
        message.error(res.error || '删除失败');
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleAddSource = async (values: any) => {
    if (!term) return;
    
    try {
      const res = await ipcApi.addTermSource({
        term_id: term.id,
        ...values
      });
      
      if (res.success) {
        message.success('来源添加成功');
        sourceForm.resetFields();
        loadTermData();
      } else {
        message.error(res.error || '添加失败');
      }
    } catch (error) {
      message.error('添加失败');
    }
  };

  const handleDeleteSource = async (id: number) => {
    try {
      // 注意：这里需要添加deleteTermSource的API函数
      // 暂时使用通用的删除逻辑
      message.warning('删除来源功能待实现');
    } catch (error) {
      message.error('删除失败');
    }
  };

  const relationColumns = [
    {
      title: '关系类型',
      dataIndex: 'relation_type',
      key: 'relation_type',
      render: (type: string) => {
        const label = relationTypeOptions.find(opt => opt.value === type)?.label || type;
        const color = {
          synonym: 'green',
          near_synonym: 'blue',
          polysemy: 'orange',
          antonym: 'red',
          related: 'purple'
        }[type] || 'default';
        
        return <Tag color={color}>{label}</Tag>;
      }
    },
    {
      title: '相关术语',
      dataIndex: 'term_text',
      key: 'term_text',
      render: (text: string, record: TermRelation) => (
        <div>
          <div>
            <Tag color={record.source_lang === 'zh' ? 'blue' : 'green'}>
              {record.source_lang === 'zh' ? '中' : '英'}
            </Tag>
            <Text strong>{text}</Text>
          </div>
          {record.target_text && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
              译文: {record.target_text}
            </div>
          )}
        </div>
      )
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: (note: string) => note || '-'
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: TermRelation) => (
        <Popconfirm
          title="确认删除此关系？"
          onConfirm={() => handleDeleteRelation(record.id)}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  const sourceColumns = [
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (type: string) => {
        const label = sourceTypeOptions.find(opt => opt.value === type)?.label || type;
        const color = {
          official: 'green',
          high_quality: 'blue',
          manual: 'gold',
          web_extract: 'purple',
          plain_text: 'gray',
          ai_extract: 'cyan'
        }[type] || 'default';
        
        return <Tag color={color}>{label}</Tag>;
      }
    },
    {
      title: '来源详情',
      dataIndex: 'source_detail',
      key: 'source_detail',
      render: (detail: string) => detail || '-'
    },
    {
      title: '权威性评分',
      dataIndex: 'credibility_score',
      key: 'credibility_score',
      render: (score: number) => {
        const colors = ['red', 'orange', 'yellow', 'lightgreen', 'green'];
        const color = colors[score - 1] || 'gray';
        return <Tag color={color}>{score} 星</Tag>;
      }
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: TermSource) => (
        <Popconfirm
          title="确认删除此来源？"
          onConfirm={() => handleDeleteSource(record.id)}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  if (!term) return null;

  return (
    <Modal
      title={`术语详情 - ${term.term_text}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      style={{ top: 20 }}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="基本信息" key="info">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleUpdateTerm}
            style={{ marginTop: 16 }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="source_lang" label="源语言" rules={[{ required: true }]}>
                <Select
                  showSearch
                  options={getLanguageSelectOptions()}
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
              
              <Form.Item name="abbreviation" label="简称">
                <Input />
              </Form.Item>
            </div>

            <Form.Item name="term_text" label="术语原文" rules={[{ required: true }]}>
              <Input />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item
                noStyle
                shouldUpdate={(prev, cur) => prev.source_lang !== cur.source_lang}
              >
                {({ getFieldValue }) => {
                  const currentSourceLang = getFieldValue('source_lang') || term.source_lang;
                  return (
                    <Form.Item name="target_lang" label="目标语言">
                      <Select
                        allowClear
                        showSearch
                        options={getTargetLanguageSelectOptions(currentSourceLang)}
                        filterOption={(input, option) =>
                          (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                        }
                        onChange={(value) => syncTargetText(value)}
                      />
                    </Form.Item>
                  );
                }}
              </Form.Item>
              
              <Form.Item name="target_text" label="术语译文">
                <Input />
              </Form.Item>
            </div>

            <Form.Item name="domain_id" label="领域">
              <Select allowClear options={domains.map(d => ({ label: d.name, value: d.id }))} />
            </Form.Item>

            <Form.Item name="description" label="注释">
              <Input.TextArea rows={3} />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit">
                更新术语信息
              </Button>
            </Form.Item>
          </Form>
        </TabPane>

        <TabPane tab="术语关系" key="relations">
          <div style={{ marginTop: 16 }}>
            <Divider orientation="left">添加关系</Divider>
            <Form
              form={relationForm}
              layout="inline"
              onFinish={handleAddRelation}
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name="relation_type"
                rules={[{ required: true, message: '请选择关系类型' }]}
              >
                <Select placeholder="关系类型" style={{ width: 120 }} options={relationTypeOptions} />
              </Form.Item>
              
              <Form.Item
                name="related_term_id"
                rules={[{ required: true, message: '请选择相关术语' }]}
              >
              <Select
                placeholder="选择相关术语"
                style={{ width: 260 }}
                showSearch
                optionFilterProp="label"
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
                options={terms
                  .filter(t => t.id !== term.id)
                  .map(t => ({
                    label: `${t.term_text} (${t.source_lang})${t.target_text ? ` → ${t.target_text}` : ''}`,
                    value: t.id
                  }))
                }
              />
              </Form.Item>
              
              <Form.Item name="note">
                <Input placeholder="备注" style={{ width: 200 }} />
              </Form.Item>
              
              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
                  添加
                </Button>
              </Form.Item>
            </Form>

            <Divider orientation="left">已有关系 ({relations.length})</Divider>
            <Table
              rowKey="id"
              columns={relationColumns}
              dataSource={relations}
              pagination={false}
              size="small"
              scroll={{ y: 300 }}
            />
          </div>
        </TabPane>

        <TabPane tab="多语翻译" key="translations">
          <div style={{ marginTop: 16 }}>
            <TranslationEditor
              sourceLang={term.source_lang}
              translations={translations.map(t => ({
                key: `trans_${t.id || t.language_code}`,
                language_code: t.language_code,
                text: t.text,
                confidence: t.confidence,
                source: t.source,
              }))}
              onChange={async (entries) => {
                if (!term) return;
                
                // 逐个保存翻译变更
                for (const entry of entries) {
                  const existing = translations.find(t => t.language_code === entry.language_code);
                  if (existing?.id) {
                    await ipcApi.updateTranslation(existing.id, {
                      text: entry.text,
                      confidence: entry.confidence || 1.0,
                    });
                  } else if (entry.text.trim()) {
                    await ipcApi.addTranslation({
                      term_id: term.id,
                      language_code: entry.language_code,
                      text: entry.text.trim(),
                      confidence: entry.confidence || 1.0,
                      source: (entry.source || 'manual') as 'manual' | 'ai' | 'import' | 'alignment',
                    });
                  }
                }
                message.success('翻译已保存');
                loadTermData();
                onUpdate();
              }}
              showConfidence
            />
          </div>
        </TabPane>

        <TabPane tab="来源标注" key="sources">
          <div style={{ marginTop: 16 }}>
            <Divider orientation="left">添加来源</Divider>
            <Form
              form={sourceForm}
              layout="inline"
              onFinish={handleAddSource}
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name="source_type"
                rules={[{ required: true, message: '请选择来源类型' }]}
              >
                <Select placeholder="来源类型" style={{ width: 140 }} options={sourceTypeOptions} />
              </Form.Item>
              
              <Form.Item name="source_detail">
                <Input placeholder="来源详情" style={{ width: 200 }} />
              </Form.Item>
              
              <Form.Item
                name="credibility_score"
                initialValue={3}
                rules={[{ required: true, message: '请选择权威性评分' }]}
              >
                <Select
                  placeholder="权威性"
                  style={{ width: 120 }}
                  options={[
                    { label: '1 星 (低)', value: 1 },
                    { label: '2 星', value: 2 },
                    { label: '3 星 (中)', value: 3 },
                    { label: '4 星', value: 4 },
                    { label: '5 星 (高)', value: 5 }
                  ]}
                />
              </Form.Item>
              
              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
                  添加
                </Button>
              </Form.Item>
            </Form>

            <Divider orientation="left">已有来源 ({sources.length})</Divider>
            <Table
              rowKey="id"
              columns={sourceColumns}
              dataSource={sources}
              pagination={false}
              size="small"
              scroll={{ y: 300 }}
            />
          </div>
        </TabPane>
      </Tabs>
    </Modal>
  );
}