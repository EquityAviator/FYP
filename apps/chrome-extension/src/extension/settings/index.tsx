import { Button, Card, Input, message } from 'antd';
import { useEffect, useState } from 'react';

export function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const saveApiKey = async () => {
    try {
      await chrome.storage.local.set({ openaiApiKey: apiKey });
      message.success('API key saved');
    } catch (e) {
      console.error('Failed to save API key:', e);
      message.error('Failed to save API key');
    }
  };

  // Load existing key on mount
  useEffect(() => {
    chrome.storage.local.get(['openaiApiKey'], (result) => {
      if (result.openaiApiKey) {
        setApiKey(result.openaiApiKey);
      }
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <div>Loading settings...</div>;
  }

  return (
    <Card title="OpenAI Configuration" bordered={false}>
      <div style={{ marginBottom: 16 }}>
        <p style={{ marginBottom: 8 }}>OpenAI API Key:</p>
        <Input.Password
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Button type="primary" onClick={saveApiKey} block>
          Save Configuration
        </Button>
      </div>
      <div style={{ fontSize: '12px', color: '#666' }}>
        <p>
          The API key is stored locally in your browser and used to communicate
          directly with OpenAI API for dark pattern analysis.
        </p>
      </div>
    </Card>
  );
}
