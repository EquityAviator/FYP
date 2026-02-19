/**
 * Live Guard Module
 * Real-time dark pattern detection and consumer protection for active tab
 * 
 * Features:
 * - Full-page capture with scroll-and-stitch strategy
 * - Complete DOM extraction with element selectors
 * - DOM-anchored highlighting for precise pattern location
 * - Automatic image resizing for local AI models
 */

import { ClearOutlined, SafetyOutlined } from '@ant-design/icons';
import './index.less';
import {
  AIActionType,
  callAIWithObjectResponse,
} from '@darkpatternhunter/core/ai-model';
import { getDebug } from '@darkpatternhunter/shared/logger';
import { Button, Card, Space, Spin, Tag, Typography, message } from 'antd';
import type { ChatCompletionMessageParam } from 'openai/resources/index';
import { useEffect, useState } from 'react';
import { useGlobalAIConfig } from '../../hooks/useGlobalAIConfig';
import {
  type AIConfig,
  getAIConfig,
  getActiveModelConfig,
  isLocalServerReachable,
} from '../../utils/aiConfig';
import { getDarkPatternPrompt } from '../../utils/analysisEngine';
import {
  captureFullPage,
  type FullPageCaptureResult,
} from '../../utils/fullPageCapture';
import {
  resizeImageForLocalModel,
  needsResizeForModel,
} from '../../utils/imageResize';

const { Title, Text, Paragraph } = Typography;
const debug = getDebug('live-guard');

// Message types for Live Guard
const LIVE_GUARD_MESSAGES = {
  SCAN_PAGE: 'live-guard-scan-page',
  CLEAR_HIGHLIGHTS: 'live-guard-clear-highlights',
  SHOW_HIGHLIGHTS: 'live-guard-show-highlights',
  FOCUS_PATTERN: 'live-guard-focus-pattern',
} as const;

// Dark pattern detection result interface with DOM anchoring
interface DetectedPattern {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  evidence: string;
  confidence: number;
  bbox?: [number, number, number, number];
  // DOM anchoring fields for precise highlighting
  selector?: string; // CSS selector or XPath
  backendNodeId?: number; // Chrome DevTools Protocol node ID
  elementText?: string; // Text content for fallback matching
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
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  // Use global AI configuration hook
  const {
    config,
    readyState,
    isLoading: isConfigLoading,
  } = useGlobalAIConfig();

  /**
   * Capture full page screenshot and complete DOM with element selectors
   * Uses scroll-and-stitch strategy for full-page capture
   */
  const capturePageData = async (): Promise<{
    screenshot: string;
    dom: string;
    url: string;
    title: string;
    screenshotSize: { width: number; height: number };
    totalHeight: number;
    isFullPage: boolean;
  } | null> => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      debug('Starting full-page capture for tab:', tab.id);

      // Use full-page capture with scroll-and-stitch
      const captureResult = await captureFullPage(tab.id, tab.windowId!, {
        maxSegments: 30,
        segmentHeight: 1200,
        overlap: 100,
        waitTime: 400,
      });

      // Get page info
      const pageInfoResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            url: window.location.href,
            title: document.title,
          };
        },
      });

      const pageInfo = pageInfoResult?.[0]?.result;

      debug('Full-page capture complete:', {
        segments: captureResult.segments,
        totalHeight: captureResult.totalHeight,
        domLength: captureResult.dom.length,
      });

      return {
        screenshot: captureResult.screenshot,
        dom: captureResult.dom,
        url: pageInfo?.url || tab.url || '',
        title: pageInfo?.title || tab.title || '',
        screenshotSize: captureResult.viewport,
        totalHeight: captureResult.totalHeight,
        isFullPage: captureResult.segments > 1,
      };
    } catch (err) {
      debug('Failed to capture page data:', err);
      return null;
    }
  };

  /**
   * Analyze current page using AI with full-page capture and DOM anchoring
   */
  const analyzeCurrentPage = async () => {
    setIsScanning(true);
    setError(null);
    setDetectedPatterns([]);

    try {
      // Check if AI is ready using global config
      if (!readyState.isReady) {
        throw new Error(readyState.errorMessage || 'AI not configured');
      }

      // Get current AI configuration
      const currentConfig = await getAIConfig();

      const pageData = await capturePageData();
      if (!pageData) {
        throw new Error('Failed to capture page data');
      }

      debug('Analyzing page:', pageData.url);
      debug('Using provider:', currentConfig.provider);
      debug('Using model:', currentConfig.selectedModel);
      debug('Full-page capture:', pageData.isFullPage ? 'Yes' : 'No', 'Height:', pageData.totalHeight);

      // Get active model config
      const modelConfig = await getActiveModelConfig();

      // Resize image for local models if needed
      let screenshotToSend = pageData.screenshot;
      let actualScreenshotSize = { ...pageData.screenshotSize };
      
      if (currentConfig.provider === 'local' && currentConfig.selectedModel) {
        const modelName = currentConfig.selectedModel;
        
        // Check if resize is needed
        if (needsResizeForModel(
          pageData.screenshotSize.width,
          pageData.screenshotSize.height,
          modelName
        )) {
          debug('Resizing image for local model:', modelName);
          
          const resizeResult = await resizeImageForLocalModel(
            pageData.screenshot,
            modelName
          );
          
          screenshotToSend = resizeResult.image;
          actualScreenshotSize = resizeResult.resizedSize;
          
          debug(`Image resized: ${resizeResult.originalSize.width}x${resizeResult.originalSize.height} -> ${resizeResult.resizedSize.width}x${resizeResult.resizedSize.height}`);
        } else {
          debug('Image size OK for model, no resize needed');
        }
      }

      // Calculate scale factor for coordinate mapping
      const scaleX = actualScreenshotSize.width / pageData.screenshotSize.width;
      const scaleY = actualScreenshotSize.height / pageData.screenshotSize.height;

      // Prepare AI messages with full DOM and request for DOM selectors
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
              text: `Analyze this webpage for dark patterns. This is a FULL-PAGE capture.

URL: ${pageData.url}
Page Title: ${pageData.title}
Page Height: ${pageData.totalHeight}px
Viewport: ${pageData.screenshotSize.width}x${pageData.screenshotSize.height}
Image Size: ${actualScreenshotSize.width}x${actualScreenshotSize.height}

FOCUS ON:
1. Create urgency or scarcity (fake timers, countdowns)
2. Hide important information (small print, hidden costs)
3. Make it difficult to opt-out or cancel
4. Use deceptive design to manipulate user choices

CRITICAL: For each detected pattern, you MUST provide:
1. "bbox": [x, y, width, height] in PIXELS relative to the IMAGE provided
2. "selector": A CSS selector that uniquely identifies the element (e.g., "#timer", ".countdown", "button.urgent")
3. "elementText": The exact text content of the element for fallback matching

Return JSON:
{
  "patterns": [
    {
      "type": "Pattern Type",
      "description": "Brief description",
      "severity": "low|medium|high|critical",
      "location": "Where on page",
      "evidence": "What makes this a dark pattern",
      "confidence": 0.0-1.0,
      "bbox": [x, y, width, height],
      "selector": "#unique-selector",
      "elementText": "Exact text content",
      "counterMeasure": "Actionable advice"
    }
  ],
  "summary": {
    "total_patterns": number,
    "prevalence_score": 0.0-1.0,
    "primary_categories": ["category1"]
  }
}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: screenshotToSend,
              },
            },
          ],
        },
      ];

      // Call AI with active model config
      const response =
        await callAIWithObjectResponse<LiveGuardDetectionResponse>(
          messages,
          AIActionType.EXTRACT_DATA,
          modelConfig,
        );

      // Scale bbox coordinates back to original page size if image was resized
      const patternsWithScaledCoords = response.content.patterns.map(
        (pattern) => {
          if (pattern.bbox && (scaleX !== 1 || scaleY !== 1)) {
            return {
              ...pattern,
              bbox: [
                Math.round(pattern.bbox[0] / scaleX),
                Math.round(pattern.bbox[1] / scaleY),
                Math.round(pattern.bbox[2] / scaleX),
                Math.round(pattern.bbox[3] / scaleY),
              ] as [number, number, number, number],
            };
          }
          return pattern;
        },
      );

      // Add counter-measures to patterns if not provided
      const patternsWithCounterMeasures = patternsWithScaledCoords.map(
        (pattern) => ({
          ...pattern,
          counterMeasure:
            pattern.counterMeasure || generateCounterMeasure(pattern),
        }),
      );

      setDetectedPatterns(patternsWithCounterMeasures);

      // Send highlights to content script with full-page metadata
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: LIVE_GUARD_MESSAGES.SHOW_HIGHLIGHTS,
          patterns: patternsWithCounterMeasures,
          screenshotSize: pageData.screenshotSize,
          totalHeight: pageData.totalHeight,
          isFullPage: pageData.isFullPage,
          isNormalized: false, // AI returns pixel coordinates for full-page
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
      Nagging:
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
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
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

  /**
   * Focus on a specific pattern highlight
   * Sends message to content script to change highlight color and scroll element into view
   */
  const focusPattern = async (patternIndex: number) => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: LIVE_GUARD_MESSAGES.FOCUS_PATTERN,
          patternIndex,
        });
      }
    } catch (err) {
      debug('Failed to focus pattern:', err);
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
            {config && config.provider === 'local' && config.selectedModel && (
              <Tag color="blue">Using Local AI: {config.selectedModel}</Tag>
            )}
            {!readyState.isReady && !isConfigLoading && (
              <Tag color="error">{readyState.errorMessage}</Tag>
            )}
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
              <Title level={5}>
                Detected Patterns ({detectedPatterns.length})
              </Title>
              <Space
                direction="vertical"
                size="small"
                style={{ width: '100%' }}
              >
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
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={() => focusPattern(index)}
                    onMouseLeave={() => {
                      // Optional: Reset highlights when mouse leaves
                      // Currently keeping the focus for better UX
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
