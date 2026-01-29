/**
 * Live Guard Module
 * Real-time dark pattern detection and consumer protection for active tab
 */

import { SafetyOutlined, ClearOutlined } from '@ant-design/icons';
import './index.less';
import { Button, Card, message, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { getDarkPatternPrompt } from '../../utils/analysisEngine';
import { globalModelConfigManager } from '@darkpatternhunter/shared/env';
import { getDebug } from '@darkpatternhunter/shared/logger';
import type { ChatCompletionMessageParam } from 'openai/resources/index';
import { AIActionType, callAIWithObjectResponse } from '@darkpatternhunter/core/ai-model';

const { Title, Text, Paragraph } = Typography;
const debug = getDebug('live-guard');

// Message types for Live Guard
const LIVE_GUARD_MESSAGES = {
  SCAN_PAGE: 'live-guard-scan-page',
  CLEAR_HIGHLIGHTS: 'live-guard-clear-highlights',
  SHOW_HIGHLIGHTS: 'live-guard-show-highlights',
} as const;

// Dark pattern detection result interface
interface DetectedPattern {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  evidence: string;
  confidence: number;
  bbox?: [number, number, number, number];
  counterMeasure: string;
}

// AI Response Schema for Live Guard
interface LiveGuardDetectionResponse {
  patterns: DetectedPattern[];
  summary: {
    total_patterns: number;
    prevalence_score: number;
    primary_categories: string[];
  };
}

export function LiveGuard() {
  const [isScanning, setIsScanning] = useState(false);
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Capture current tab screenshot and DOM
   */
  const capturePageData = async (): Promise<{
    screenshot: string;
    dom: string;
    url: string;
    title: string;
  } | null> => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      // Capture screenshot
      const screenshot = await new Promise<string>((resolve, reject) => {
        chrome.tabs.captureVisibleTab(
          tab.windowId,
          { format: 'png' },
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(dataUrl);
            }
          },
        );
      });

      // Get DOM and page info
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            url: window.location.href,
            title: document.title,
            dom: document.documentElement.outerHTML.substring(0, 5000), // Limit DOM size
          };
        },
      });

      if (result?.[0]?.result) {
        return {
          screenshot,
          ...result[0].result,
        };
      }

      return null;
    } catch (err) {
      debug('Failed to capture page data:', err);
      return null;
    }
  };

  /**
   * Analyze current page using AI
   */
  const analyzeCurrentPage = async () => {
    setIsScanning(true);
    setError(null);
    setDetectedPatterns([]);

    try {
      const pageData = await capturePageData();
      if (!pageData) {
        throw new Error('Failed to capture page data');
      }

      debug('Analyzing page:', pageData.url);

      // Prepare AI messages
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: getDarkPatternPrompt('english'),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this webpage for dark patterns in real-time.

URL: ${pageData.url}
Page Title: ${pageData.title}

This is a live scan for consumer protection. Focus on patterns that:
1. Create urgency or scarcity (fake timers, countdowns)
2. Hide important information (small print, hidden costs)
3. Make it difficult to opt-out or cancel
4. Use deceptive design to manipulate user choices

For each detected pattern, provide a counterMeasure field with actionable advice for the user.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: pageData.screenshot,
              },
            },
          ],
        },
      ];

      // Call AI
      const modelConfig = globalModelConfigManager.getModelConfig('default');
      const response = await callAIWithObjectResponse<LiveGuardDetectionResponse>(
        messages,
        AIActionType.EXTRACT_DATA,
        modelConfig,
      );

      // Add counter-measures to patterns if not provided
      const patternsWithCounterMeasures = response.content.patterns.map((pattern) => ({
        ...pattern,
        counterMeasure: pattern.counterMeasure || generateCounterMeasure(pattern),
      }));

      setDetectedPatterns(patternsWithCounterMeasures);

      // Send highlights to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: LIVE_GUARD_MESSAGES.SHOW_HIGHLIGHTS,
          patterns: patternsWithCounterMeasures,
        });
      }

      message.success(
        `Detected ${patternsWithCounterMeasures.length} dark pattern(s)`,
      );
      debug('Analysis completed:', patternsWithCounterMeasures);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      message.error(`Analysis failed: ${errorMessage}`);
      debug('Analysis error:', errorMessage);
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Generate counter-measure for a pattern
   */
  const generateCounterMeasure = (pattern: DetectedPattern): string => {
    const counterMeasures: Record<string, string> = {
      'Pressured Selling / FOMO / Urgency':
        '✅ Action: Ignore the countdown. You have plenty of time to shop.',
      'Scarcity & Popularity':
        '✅ Action: This scarcity indicator may be fake. Check if the item is actually in stock elsewhere.',
      'Trick Questions / Confirmshaming':
        '✅ Action: You can decline without guilt. This is a manipulative design.',
      'Hidden Information':
        '✅ Action: Look for the full terms and conditions before proceeding.',
      'Hard To Close':
        '✅ Action: The real close button is often hidden. Look for a small X in the corner.',
      'Disguised Ad / Bait & Switch':
        '✅ Action: This is likely an advertisement, not actual content.',
      'False Hierarchy':
        '✅ Action: The highlighted option may not be the best choice. Compare all options.',
      'Bundling / Auto-add / Bad Defaults':
        '✅ Action: Check your cart carefully. Items may have been added automatically.',
      'Price Comparison Prevention':
        '✅ Action: This design makes it hard to compare prices. Consider opening multiple tabs.',
      'Dead End/Roach Motel':
        '✅ Action: You may be trapped. Look for a way to exit or cancel.',
      'Nagging':
        '✅ Action: You can dismiss this. It will appear again if you ignore it.',
      'Infinite Scrolling':
        '✅ Action: Take breaks. Infinite scrolling is designed to keep you engaged.',
      'Forced Ads / Autoplay':
        '✅ Action: You can usually disable autoplay in settings or close the ad.',
    };

    return (
      counterMeasures[pattern.type] ||
      '✅ Action: Be cautious. This pattern may manipulate your decisions.'
    );
  };

  /**
   * Clear all highlights from the page
   */
  const clearHighlights = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: LIVE_GUARD_MESSAGES.CLEAR_HIGHLIGHTS,
        });
      }
      setDetectedPatterns([]);
      message.success('Highlights cleared');
      debug('Highlights cleared');
    } catch (err) {
      debug('Failed to clear highlights:', err);
    }
  };

  return (
    <div className="live-guard-container">
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Title level={4}>
              <SafetyOutlined /> Live Guard
            </Title>
            <Paragraph type="secondary">
              Real-time dark pattern detection and consumer protection
            </Paragraph>
          </div>

          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Button
              type="primary"
              size="large"
              icon={<SafetyOutlined />}
              onClick={analyzeCurrentPage}
              loading={isScanning}
              disabled={isScanning}
              block
            >
              {isScanning ? 'Scanning...' : 'Scan Current Page'}
            </Button>

            {detectedPatterns.length > 0 && (
              <Button
                icon={<ClearOutlined />}
                onClick={clearHighlights}
                disabled={isScanning}
                block
              >
                Clear Highlights
              </Button>
            )}
          </Space>

          {error && (
            <div style={{ marginTop: 16 }}>
              <Text type="danger">{error}</Text>
            </div>
          )}

          {detectedPatterns.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Title level={5}>Detected Patterns ({detectedPatterns.length})</Title>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {detectedPatterns.map((pattern, index) => (
                  <Card
                    key={index}
                    size="small"
                    style={{
                      borderLeft: `4px solid ${
                        pattern.severity === 'critical'
                          ? '#ff4d4f'
                          : pattern.severity === 'high'
                            ? '#ff7a45'
                            : pattern.severity === 'medium'
                              ? '#ffa940'
                              : '#52c41a'
                      }`,
                    }}
                  >
                    <Text strong>{pattern.type}</Text>
                    <br />
                    <Text type="secondary">{pattern.description}</Text>
                    <br />
                    <Text type="warning">{pattern.counterMeasure}</Text>
                  </Card>
                ))}
              </Space>
            </div>
          )}

          {isScanning && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Spin tip="Analyzing page for dark patterns..." />
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}

export default LiveGuard;
