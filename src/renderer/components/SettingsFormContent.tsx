import React, { useState, useEffect } from 'react';
import { Form, Input, Select, AutoComplete, Button, Space } from 'antd';
import { ApiOutlined, RobotOutlined, GlobalOutlined } from '@ant-design/icons';
import { ipcApi } from '../ipc-api';

/** 生成 API Key 的掩码显示（仅保留首末4位明文，中间用 * 替代） */
function maskApiKey(key: string): string {
  if (!key || key.length <= 8) {
    // 密钥太短，全掩码
    return '•'.repeat(key?.length || 0);
  }
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

/** API Key 强制掩码显示组件：始终仅显示首末4位明文，不提供任何完整秘钥暴露途径 */
const MaskedApiKeyDisplay: React.FC = () => {
  const form = Form.useFormInstance();
  const apiKey = Form.useWatch('apiKey', form) as string || '';
  const [focused, setFocused] = useState(false);
  const [inputText, setInputText] = useState('');

  // 计算显示值：聚焦时展示用户正在输入的内容，失焦时展示首末4位掩码
  const displayedValue = (() => {
    if (focused) return inputText;    // 聚焦时展示用户实时输入
    if (!apiKey) return '';
    return maskApiKey(apiKey);        // 失焦时显示首末4位掩码
  })();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    form.setFieldsValue({ apiKey: e.target.value });
  };

  const handleFocus = () => {
    setFocused(true);
    setInputText('');                 // 聚焦时清空，用户直接输入新秘钥
  };

  const handleBlur = () => {
    setFocused(false);
    setInputText('');
  };

  return (
    <Input
      value={displayedValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder="请输入 AI API Key"
      style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
    />
  );
};

interface ProviderInfo {
  name: string;
  endpoint: string;
  defaultModel: string;
  models: string[];
}

interface Props {
  form: any;
  aiConfig: {
    apiKey: string;
    endpoint: string;
    promptTemplate: string;
    dataPath: string;
    provider: string;
    model: string;
  };
  selectDataPath: () => void;
}

const SettingsFormContent: React.FC<Props> = ({ form, aiConfig, selectDataPath }) => {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [selectedProvider, setSelectedProvider] = useState<string>(aiConfig.provider || '');
  const [selectedModel, setSelectedModel] = useState<string>(aiConfig.model || '');
  const [isCustomEndpoint, setIsCustomEndpoint] = useState<boolean>(
    !aiConfig.provider || aiConfig.provider === 'custom'
  );

  // 从主进程加载平台列表
  useEffect(() => {
    const load = async () => {
      try {
        const res = await ipcApi.getAIProviders();
        if (res.success && res.data) {
          setProviders(res.data);
        }
      } catch {
        // ignore
      }
    };
    load();
  }, []);

  // 当 provider 在外部改变时同步
  useEffect(() => {
    if (aiConfig.provider) {
      setSelectedProvider(aiConfig.provider);
      setIsCustomEndpoint(aiConfig.provider === 'custom');
    }
    if (aiConfig.model) {
      setSelectedModel(aiConfig.model);
    }
  }, [aiConfig.provider, aiConfig.model]);

  // 处理平台切换
  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);

    if (value === 'custom') {
      // 自定义模式：启用 endpoint 手动输入
      setIsCustomEndpoint(true);
      form.setFieldsValue({ provider: 'custom', model: '' });
      setSelectedModel('');
    } else if (providers[value]) {
      // 选择预设平台：自动填充 endpoint 和默认 model
      const info = providers[value];
      setIsCustomEndpoint(false);
      form.setFieldsValue({
        provider: value,
        endpoint: info.endpoint,
        model: info.defaultModel,
      });
      setSelectedModel(info.defaultModel);
    }
  };

  // 处理模型切换
  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    form.setFieldsValue({ model: value });
  };

  // 获取当前平台的模型列表
  const getCurrentModels = (): string[] => {
    if (!selectedProvider || selectedProvider === 'custom') return [];
    return providers[selectedProvider]?.models || [];
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={aiConfig}
    >
      {/* API Key - 首末4位掩码 */}
      <Form.Item
        name="apiKey"
        label="AI API Key"
        rules={[{ required: true, message: '请填写 API Key' }]}
        tooltip="从 AI 平台获取的 API 密钥。仅显示首末4位明文，修改请前往系统设置页的 API Key 输入框"
      >
        <MaskedApiKeyDisplay />
      </Form.Item>

      {/* AI 平台选择 */}
      <Form.Item
        name="provider"
        label={
          <span>
            <RobotOutlined style={{ marginRight: 6 }} />
            AI 平台
          </span>
        }
        rules={[{ required: true, message: '请选择 AI 平台' }]}
        tooltip="选择预设平台将自动填充接口地址和可用模型"
      >
        <Select
          placeholder="请选择 AI 平台"
          value={selectedProvider || undefined}
          onChange={handleProviderChange}
          showSearch
          optionFilterProp="label"
        >
          {Object.entries(providers).map(([key, info]) => (
            <Select.Option key={key} value={key} label={info.name}>
              <Space>
                <span>{info.name}</span>
                <span style={{ color: '#999', fontSize: 12 }}>
                  ({info.defaultModel})
                </span>
              </Space>
            </Select.Option>
          ))}
          <Select.Option value="custom" label="自定义接口">
            <span style={{ fontStyle: 'italic', color: '#1890ff' }}>
              自定义接口...
            </span>
          </Select.Option>
        </Select>
      </Form.Item>

      {/* 模型版本号 - 支持从平台列表选择或自定义输入 */}
      <Form.Item
        name="model"
        label={
          <span>
            <ApiOutlined style={{ marginRight: 6 }} />
            模型版本号
          </span>
        }
        rules={[
          { required: true, message: '请选择或输入模型版本号' },
        ]}
        tooltip={
          isCustomEndpoint
            ? '使用自定义接口时请手动输入模型名称'
            : selectedProvider && getCurrentModels().length > 0
              ? '可从下拉列表选择平台支持的模型，也可直接输入自定义模型名称'
              : '请输入该平台支持的模型名称'
        }
      >
        <AutoComplete
          placeholder={
            isCustomEndpoint
              ? '例如：gpt-4o, claude-3-5-sonnet'
              : selectedProvider
                ? `选择或输入 ${providers[selectedProvider]?.name || '模型'} 的版本`
                : '请先选择 AI 平台'
          }
          value={selectedModel || undefined}
          onChange={(value) => handleModelChange(value)}
          options={getCurrentModels().map((model) => ({
            value: model,
            label: model,
          }))}
          style={{ width: '100%' }}
          allowClear
          filterOption={(inputValue, option) =>
            (option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
          }
          notFoundContent={
            selectedProvider && selectedProvider !== 'custom'
              ? '无匹配模型，可直接输入自定义模型名'
              : undefined
          }
        />
      </Form.Item>

      {/* 接口地址 */}
      <Form.Item
        name="endpoint"
        label={
          <span>
            <GlobalOutlined style={{ marginRight: 6 }} />
            API 接口地址
          </span>
        }
        rules={[
          {
            required: true,
            message: '请填写 API 接口地址',
          },
          {
            type: 'url',
            message: '请输入有效的 URL 地址',
          },
        ]}
        tooltip="选择平台后自动填充，也可手动修改。支持任意兼容 OpenAI API 格式的接口地址"
      >
        <Input
          placeholder="https://api.deepseek.com/v1/chat/completions"
          allowClear
        />
      </Form.Item>

      {/* 提示词模板 */}
      <Form.Item name="promptTemplate" label="提示词模板">
        <Input.TextArea
          rows={4}
          placeholder="系统将使用默认提示词，您可在此自定义"
        />
      </Form.Item>

      {/* 数据保存地址 */}
      <Form.Item name="dataPath" label="术语数据保存地址">
        <Input
          placeholder="留空使用默认地址，确保数据安全"
          readOnly
          addonAfter={
            <Button type="link" onClick={selectDataPath} style={{ padding: '4px 8px' }}>
              选择
            </Button>
          }
        />
      </Form.Item>

      {/* 隐藏字段：provider 同时通过 Form.Item 绑定以支持验证 */}
      <Form.Item name="provider" hidden>
        <Input />
      </Form.Item>
    </Form>
  );
};

export default SettingsFormContent;