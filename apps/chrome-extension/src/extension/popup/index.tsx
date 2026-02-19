/// <reference types="chrome" />
import {
  ApiOutlined,
  DatabaseOutlined,
  MenuOutlined,
  SafetyOutlined,
  SendOutlined,
  SettingOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  EnvConfig,
  globalThemeConfig,
  safeOverrideAIConfig,
  useEnvConfig,
} from '@darkpatternhunter/visualizer';
import { ConfigProvider, Dropdown, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { BrowserExtensionPlayground } from '../../components/playground';
import Bridge from '../bridge';
import DatasetCollection from '../dataset-collection';
import LiveGuard from '../live-guard';
import Recorder from '../recorder';
import { Settings } from '../settings';
import './index.less';
import {
  MIDSCENE_MODEL_NAME,
  MIDSCENE_OPENAI_API_KEY,
  MIDSCENE_OPENAI_BASE_URL,
  MIDSCENE_VL_MODE,
  OPENAI_API_KEY,
} from '@darkpatternhunter/shared/env';
import {
  ChromeExtensionProxyPage,
  ChromeExtensionProxyPageAgent,
} from '@darkpatternhunter/web/chrome-extension';
import { getAIConfig, AI_STORAGE_KEYS } from '../../utils/aiConfig';

// remember to destroy the agent when the tab is destroyed: agent.page.destroy()
const extensionAgentForTab = (forceSameTabNavigation = true) => {
  const page = new ChromeExtensionProxyPage(forceSameTabNavigation);
  return new ChromeExtensionProxyPageAgent(page);
};

const STORAGE_KEY = 'dark-pattern-hunter-mode';

export function PlaygroundPopup() {
  const { setPopupTab, config } = useEnvConfig();
  const [currentMode, setCurrentMode] = useState<
    'playground' | 'bridge' | 'recorder' | 'dataset' | 'live-guard' | 'settings'
  >(() => {
    const savedMode = localStorage.getItem(STORAGE_KEY);
    return (
      (savedMode as
        | 'playground'
        | 'bridge'
        | 'recorder'
        | 'dataset'
        | 'live-guard'
        | 'settings') || 'live-guard'
    );
  });

  // Sync popupTab with saved mode on mount
  useEffect(() => {
    if (currentMode !== 'dataset' && currentMode !== 'settings') {
      setPopupTab(currentMode);
    }
  }, [currentMode]);

  // Override AI configuration - UNIFIED LOCAL AI DEFAULT
  useEffect(() => {
    const loadAndOverrideConfig = async () => {
      // Get AI configuration from centralized storage
      const aiConfig = await getAIConfig();

      console.log('Dark Pattern Hunter - Loading AI config');
      console.log('Provider:', aiConfig.provider);
      console.log('Local AI Host:', aiConfig.localAiHost);
      console.log('Selected Model:', aiConfig.selectedModel);

      let configToOverride: Record<string, string>;

      if (aiConfig.provider === 'local' || aiConfig.localAiEnabled) {
        // Use local LM Studio server (DEFAULT)
        configToOverride = {
          [MIDSCENE_OPENAI_BASE_URL]: `${aiConfig.localAiHost}/v1`,
          [MIDSCENE_OPENAI_API_KEY]: 'lm-studio',
          [OPENAI_API_KEY]: 'lm-studio',
          [MIDSCENE_MODEL_NAME]: aiConfig.selectedModel || 'local-model',
          [MIDSCENE_VL_MODE]: '', // Unset VL mode for local models
        };
      } else if (aiConfig.openaiApiKey) {
        // Use OpenAI (only if explicitly configured)
        configToOverride = {
          [MIDSCENE_OPENAI_BASE_URL]: 'https://api.openai.com/v1',
          [MIDSCENE_OPENAI_API_KEY]: aiConfig.openaiApiKey,
          [OPENAI_API_KEY]: aiConfig.openaiApiKey,
          [MIDSCENE_MODEL_NAME]: 'gpt-4o',
          [MIDSCENE_VL_MODE]: '',
        };
      } else {
        // Fallback to local LM Studio
        configToOverride = {
          [MIDSCENE_OPENAI_BASE_URL]: 'http://localhost:1234/v1',
          [MIDSCENE_OPENAI_API_KEY]: 'lm-studio',
          [OPENAI_API_KEY]: 'lm-studio',
          [MIDSCENE_MODEL_NAME]: 'local-model',
          [MIDSCENE_VL_MODE]: '',
        };
      }

      console.log('Applying AI config:', { 
        provider: aiConfig.provider, 
        baseUrl: configToOverride[MIDSCENE_OPENAI_BASE_URL] 
      });
      safeOverrideAIConfig(configToOverride);
    };

    loadAndOverrideConfig();
  }, [config]);

  const menuItems = [
    {
      key: 'live-guard',
      icon: <SafetyOutlined />,
      label: 'Live Guard',
      onClick: () => {
        setCurrentMode('live-guard');
        localStorage.setItem(STORAGE_KEY, 'live-guard');
      },
    },
    {
      key: 'dataset',
      icon: <DatabaseOutlined />,
      label: 'Dataset Collection',
      onClick: () => {
        setCurrentMode('dataset');
        setPopupTab('dataset');
        localStorage.setItem(STORAGE_KEY, 'dataset');
      },
    },
    {
      key: 'playground',
      icon: <SendOutlined />,
      label: 'Playground',
      onClick: () => {
        setCurrentMode('playground');
        setPopupTab('playground');
        localStorage.setItem(STORAGE_KEY, 'playground');
      },
    },
    {
      key: 'recorder',
      label: 'Recorder (Preview)',
      icon: <VideoCameraOutlined />,
      onClick: () => {
        setCurrentMode('recorder');
        setPopupTab('recorder');
        localStorage.setItem(STORAGE_KEY, 'recorder');
      },
    },
    {
      key: 'bridge',
      icon: <ApiOutlined />,
      label: 'Bridge Mode',
      onClick: () => {
        setCurrentMode('bridge');
        setPopupTab('bridge');
        localStorage.setItem(STORAGE_KEY, 'bridge');
      },
    },
    {
      type: 'divider',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => {
        setCurrentMode('settings');
        localStorage.setItem(STORAGE_KEY, 'settings');
      },
    },
  ];

  const renderContent = () => {
    if (currentMode === 'bridge') {
      return (
        <div className="popup-content bridge-mode">
          <div className="module-container">
            <Bridge />
          </div>
        </div>
      );
    }
    if (currentMode === 'recorder') {
      return (
        <div className="popup-content recorder-mode">
          <div className="module-container">
            <Recorder />
          </div>
        </div>
      );
    }
    if (currentMode === 'dataset') {
      return (
        <div className="popup-content dataset-mode">
          <div className="module-container">
            <DatasetCollection />
          </div>
        </div>
      );
    }
    if (currentMode === 'live-guard') {
      return (
        <div className="popup-content live-guard-mode">
          <div className="module-container">
            <LiveGuard />
          </div>
        </div>
      );
    }
    if (currentMode === 'settings') {
      return (
        <div className="popup-content settings-mode">
          <div className="module-container">
            <Settings />
          </div>
        </div>
      );
    }

    return (
      <div className="popup-content">
        {/* Playground Component */}
        <div className="module-container playground-component">
          <BrowserExtensionPlayground
            getAgent={(forceSameTabNavigation?: boolean) => {
              console.log(
                'getAgent called with forceSameTabNavigation:',
                forceSameTabNavigation,
              );
              return extensionAgentForTab(forceSameTabNavigation);
            }}
            showContextPreview={false}
          />
        </div>
      </div>
    );
  };

  return (
    <ConfigProvider theme={globalThemeConfig()}>
      <div className="popup-wrapper">
        {/* top navigation bar */}
        <div className="popup-nav">
          <div className="nav-left">
            <Dropdown
              menu={{ items: menuItems as any }}
              trigger={['click']}
              placement="bottomLeft"
              overlayClassName="mode-selector-dropdown"
            >
              <MenuOutlined className="nav-icon menu-trigger" />
            </Dropdown>
            <span className="nav-title">
              {currentMode === 'playground'
                ? 'Playground'
                : currentMode === 'recorder'
                  ? 'Recorder'
                  : currentMode === 'bridge'
                    ? 'Bridge Mode'
                    : currentMode === 'dataset'
                      ? 'Dataset Collection'
                      : currentMode === 'live-guard'
                        ? 'Live Guard'
                        : 'Settings'}
            </span>
          </div>
          <div className="nav-right">
            <EnvConfig showTooltipWhenEmpty={false} showModelName={false} />
          </div>
        </div>

        {/* main content area */}
        {renderContent()}
      </div>
    </ConfigProvider>
  );
}
