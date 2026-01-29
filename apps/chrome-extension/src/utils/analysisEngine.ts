/**
 * Analysis Engine for Dark Pattern Detection
 * 
 * This module provides utilities to analyze stored dataset entries using AI models
 * to detect dark patterns in web interfaces.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/index';
import { AIActionType } from '@darkpatternhunter/core/ai-model';
import { callAIWithObjectResponse } from '@darkpatternhunter/core/ai-model';
import { globalModelConfigManager } from '@darkpatternhunter/shared/env';
import { getDebug } from '@darkpatternhunter/shared/logger';

import type { DatasetEntry, DarkPattern } from './datasetDB';
import { getDatasetEntries, storeDatasetEntry } from './datasetDB';

const debug = getDebug('analysis:engine');

// Dark Pattern Categories (14 categories based on COCO/YOLO format)
const DARK_PATTERN_CATEGORIES = [
  'Nagging',
  'Dead End/Roach Motel',
  'Price Comparison Prevention',
  'Disguised Ad / Bait & Switch',
  'Reference Pricing',
  'False Hierarchy',
  'Bundling / Auto-add / Bad Defaults',
  'Pressured Selling / FOMO / Urgency',
  'Scarcity & Popularity',
  'Hard To Close',
  'Trick Questions / Confirmshaming',
  'Hidden Information',
  'Infinite Scrolling',
  'Forced Ads / Autoplay',
] as const;

// Analysis status types
export type AnalysisStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// Analysis result interface
export interface AnalysisResult {
  darkPatterns: DarkPattern[];
  analysisStatus: AnalysisStatus;
  confidenceScore: number;
  error?: string;
}

// AI Response Schema for Dark Pattern Detection
interface DarkPatternDetectionResponse {
  patterns: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    location: string;
    evidence: string;
    confidence: number;
    bbox?: [number, number, number, number];
  }>;
  summary: {
    total_patterns: number;
    prevalence_score: number;
    primary_categories: string[];
  };
}

// Dark Pattern Prompt with English and Urdu support
const DARK_PATTERN_PROMPT = {
  english: `You are an expert dark pattern analyst specializing in detecting deceptive design patterns in web interfaces.

Your task is to analyze the provided webpage screenshot and DOM structure to identify dark patterns.

## Dark Pattern Categories to Detect:
1. **Nagging** - Repeated requests or interruptions
2. **Dead End/Roach Motel** - Easy to get in, hard to get out
3. **Price Comparison Prevention** - Making it difficult to compare prices
4. **Disguised Ad / Bait & Switch** - Ads disguised as content or misleading offers
5. **Reference Pricing** - Fake or misleading price comparisons
6. **False Hierarchy** - Manipulating visual hierarchy to influence choices
7. **Bundling / Auto-add / Bad Defaults** - Unwanted additions or default settings
8. **Pressured Selling / FOMO / Urgency** - Creating artificial urgency or scarcity
9. **Scarcity & Popularity** - Fake scarcity indicators or popularity claims
10. **Hard To Close** - Difficult to close modals or popups
11. **Trick Questions / Confirmshaming** - Confusing questions or guilt-tripping
12. **Hidden Information** - Important information hidden or obscured
13. **Infinite Scrolling** - Endless scrolling to keep users engaged
14. **Forced Ads / Autoplay** - Unwanted advertisements or auto-playing content

## Analysis Instructions:
1. Examine the screenshot for visual dark patterns
2. Review the DOM structure for hidden or subtle patterns
3. For each detected pattern, provide:
   - **type**: One of the 14 categories above
   - **description**: Brief explanation of the pattern
   - **severity**: low, medium, high, or critical
   - **location**: Where on the page (e.g., "top banner", "checkout button", "modal")
   - **evidence**: Specific text or visual elements that indicate the pattern
   - **confidence**: Your confidence level (0.0 to 1.0)
   - **bbox**: Bounding box coordinates [x, y, width, height] if applicable

4. Provide a summary with:
   - **total_patterns**: Total number of patterns detected
   - **prevalence_score**: Overall prevalence (0.0 to 1.0)
   - **primary_categories**: Top 3 most common pattern types

Return your analysis as a JSON object following this structure:
{
  "patterns": [...],
  "summary": {...}
}`,

  urdu: `آپ ایک ماہر ڈارک پیٹرن تجزیہ کار ہیں جو ویب انٹرفیس میں دھوکے دہ ڈیزائن پیٹرنز کا پتہ لگانے میں مہارت رکھتے ہیں۔

آپ کا کام فراہم کردہ ویب پیج اسکرین شاٹ اور DOM ڈھانچے کا تجزیہ کرکے ڈارک پیٹرنز کا پتہ لگانا ہے۔

## ڈارک پیٹرن کیٹیگریز جو کا پتہ لگانا ہے:
1. **Nagging** - بار بار درخواستیں یا مداخلت
2. **Dead End/Roach Motel** - اندر آنا آسان، باہر جانا مشکل
3. **Price Comparison Prevention** - قیمتوں کا موازنہ کرنا مشکل
4. **Disguised Ad / Bait & Switch** - اشتہارات کو مواد کے طور پر چھپانا یا گمراہ کن پیشکش
5. **Reference Pricing** - جعلی یا گمراہ کن قیمتوں کا موازنہ
6. **False Hierarchy** - انتخابات کو متاثر کرنے کے لیے بصری درجہ بندی کو ہیرا پھیر کرنا
7. **Bundling / Auto-add / Bad Defaults** - ناپسندیدہ اضافات یا ڈیفالٹ ترتیبات
8. **Pressured Selling / FOMO / Urgency** - مصنوعی ہراسانی یا کمی پیدا کرنا
9. **Scarcity & Popularity** - جعلی کمی کے اشارے یا مقبولیت کے دعوے
10. **Hard To Close** - موڈلز یا پاپ اپس کو بند کرنا مشکل
11. **Trick Questions / Confirmshaming** - الجھن پیدا کرنے والے سوالات یا احساسِ جرم دلانا
12. **Hidden Information** - اہم معلومات چھپائی ہوئی یا مبہم
13. **Infinite Scrolling** - صارفین کو شامل رکھنے کے لیے بے انتہا اسکرولنگ
14. **Forced Ads / Autoplay** - ناپسندیدہ اشتہارات یا خودکار چلنے والا مواد

## تجزیے کی ہدایات:
1. بصری ڈارک پیٹرنز کے لیے اسکرین شاٹ کا جائزہ لیں
2. چھپے ہوئے یا نازک پیٹرنز کے لیے DOM ڈھانچے کا جائزہ لیں
3. ہر پتہ لگائے گئے پیٹرن کے لیے فراہم کریں:
   - **type**: اوپر دی گئی 14 کیٹیگریز میں سے ایک
   - **description**: پیٹرن کی مختصر وضاحت
   - **severity**: low, medium, high, یا critical
   - **location**: پیج پر کہاں (مثلاً "top banner", "checkout button", "modal")
   - **evidence**: پیٹرن کی نشاندہی کرنے والے مخصوص متن یا بصری عناصر
   - **confidence**: آپ کا اعتماد کا سطح (0.0 سے 1.0)
   - **bbox**: باؤنڈنگ باکس کوآرڈینیٹس [x, y, width, height] اگر لاگو ہو

4. ایک خلاصہ فراہم کریں جس میں شامل ہے:
   - **total_patterns**: پتہ لگائے گئے پیٹرنز کی کل تعداد
   - **prevalence_score**: مجموعی پھیلاؤ (0.0 سے 1.0)
   - **primary_categories**: سب سے زیادہ عام 3 پیٹرن کی اقسام

اپنا تجزیہ JSON آبجیکٹ کے طور پر واپس کریں جو اس ڈھانچے کی پیروی کرتا ہے:
{
  "patterns": [...],
  "summary": {...}
}`,
};

/**
 * Get the dark pattern prompt in the specified language
 */
export function getDarkPatternPrompt(language: 'english' | 'urdu' = 'english'): string {
  return DARK_PATTERN_PROMPT[language];
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry logic with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      debug(`Attempt ${attempt}/${maxAttempts}`);
      return await fn();
    } catch (error) {
      lastError = error as Error;
      debug(`Attempt ${attempt} failed:`, error);

      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Max retry attempts reached');
}

/**
 * Validate dark pattern type against known categories
 */
function validatePatternType(type: string): string {
  const normalizedType = type.trim();
  const validType = DARK_PATTERN_CATEGORIES.find(
    (cat) => cat.toLowerCase() === normalizedType.toLowerCase(),
  );

  if (validType) {
    return validType;
  }

  // Try partial match
  const partialMatch = DARK_PATTERN_CATEGORIES.find((cat) =>
    normalizedType.toLowerCase().includes(cat.toLowerCase().split('/')[0].trim()),
  );

  return partialMatch || normalizedType;
}

/**
 * Validate severity level
 */
function validateSeverity(severity: string): DarkPattern['severity'] {
  const validSeverities: DarkPattern['severity'][] = ['low', 'medium', 'high', 'critical'];
  if (validSeverities.includes(severity as DarkPattern['severity'])) {
    return severity as DarkPattern['severity'];
  }
  return 'medium'; // Default to medium
}

/**
 * Validate confidence score
 */
function validateConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Convert AI response to DarkPattern array
 */
function convertToDarkPatterns(
  aiPatterns: DarkPatternDetectionResponse['patterns'],
): DarkPattern[] {
  return aiPatterns.map((pattern) => ({
    type: validatePatternType(pattern.type),
    description: pattern.description,
    severity: validateSeverity(pattern.severity),
    location: pattern.location,
    evidence: pattern.evidence,
    confidence: validateConfidence(pattern.confidence),
    bbox: pattern.bbox,
  }));
}

/**
 * Calculate overall confidence score from patterns
 */
function calculateConfidenceScore(patterns: DarkPattern[]): number {
  if (patterns.length === 0) {
    return 0;
  }

  const totalConfidence = patterns.reduce((sum, pattern) => {
    return sum + (pattern.confidence || 0);
  }, 0);

  return totalConfidence / patterns.length;
}

/**
 * Analyze a single dataset entry using AI
 */
export async function analyzeStoredEntry(
  entryId: string,
  options?: {
    language?: 'english' | 'urdu';
    maxRetries?: number;
  },
): Promise<AnalysisResult> {
  const { language = 'english', maxRetries = 3 } = options || {};

  debug(`Analyzing entry: ${entryId}`);

  try {
    // Get all entries and find the target one
    const entries = await getDatasetEntries();
    const entry = entries.find((e) => e.id === entryId);

    if (!entry) {
      throw new Error(`Entry with ID ${entryId} not found`);
    }

    // Validate entry has required data
    if (!entry.screenshot) {
      throw new Error('Entry does not have a screenshot');
    }

    // Prepare AI messages
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: getDarkPatternPrompt(language),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this webpage for dark patterns.

URL: ${entry.url}
Page Title: ${entry.metadata?.pageTitle || 'N/A'}
Timestamp: ${new Date(entry.timestamp).toISOString()}

${entry.dom ? `\nDOM Structure (excerpt):\n${entry.dom.substring(0, 2000)}...` : ''}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: entry.screenshot,
            },
          },
        ],
      },
    ];

    // Call AI with retry logic
    const response = await retryWithBackoff(async () => {
      const modelConfig = globalModelConfigManager.getModelConfig();
      return callAIWithObjectResponse<DarkPatternDetectionResponse>(
        messages,
        AIActionType.EXTRACT_DATA,
        modelConfig,
      );
    }, maxRetries);

    // Convert AI response to DarkPattern array
    const darkPatterns = convertToDarkPatterns(response.content.patterns);

    // Calculate confidence score
    const confidenceScore = calculateConfidenceScore(darkPatterns);

    // Update entry with analysis results
    const updatedEntry: DatasetEntry = {
      ...entry,
      patterns: darkPatterns,
      summary: {
        total_patterns: response.content.summary.total_patterns,
        prevalence_score: response.content.summary.prevalence_score,
        primary_categories: response.content.summary.primary_categories,
      },
      metadata: {
        ...entry.metadata,
        researchContext: {
          ...entry.metadata?.researchContext,
          modelUsed: globalModelConfigManager.getModelConfig().modelName,
          analysisVersion: '1.0',
        },
      },
    };

    // Store updated entry
    await storeDatasetEntry(updatedEntry);

    debug(`Analysis completed for entry: ${entryId}`);
    debug(`Detected ${darkPatterns.length} dark patterns`);

    return {
      darkPatterns,
      analysisStatus: 'completed',
      confidenceScore,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug(`Analysis failed for entry ${entryId}:`, errorMessage);

    return {
      darkPatterns: [],
      analysisStatus: 'failed',
      confidenceScore: 0,
      error: errorMessage,
    };
  }
}

/**
 * React Hook for batch analysis of dataset entries
 */
export function useBatchAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [results, setResults] = React.useState<Map<string, AnalysisResult>>(new Map());
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Analyze multiple entries in batch
   */
  const analyzeBatch = React.useCallback(
    async (entryIds: string[], options?: { language?: 'english' | 'urdu'; maxRetries?: number }) => {
      setIsAnalyzing(true);
      setProgress(0);
      setTotal(entryIds.length);
      setResults(new Map());
      setError(null);

      const newResults = new Map<string, AnalysisResult>();

      for (let i = 0; i < entryIds.length; i++) {
        const entryId = entryIds[i];
        try {
          const result = await analyzeStoredEntry(entryId, options);
          newResults.set(entryId, result);
          setResults(new Map(newResults));
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          newResults.set(entryId, {
            darkPatterns: [],
            analysisStatus: 'failed',
            confidenceScore: 0,
            error: errorMessage,
          });
          setResults(new Map(newResults));
        }

        setProgress(i + 1);
      }

      setIsAnalyzing(false);
      return newResults;
    },
    [],
  );

  /**
   * Analyze all pending entries
   */
  const analyzePendingEntries = React.useCallback(
    async (options?: { language?: 'english' | 'urdu'; maxRetries?: number }) => {
      const entries = await getDatasetEntries();
      const pendingEntries = entries.filter((entry) => entry.patterns.length === 0);
      const pendingIds = pendingEntries.map((entry) => entry.id);

      return analyzeBatch(pendingIds, options);
    },
    [analyzeBatch],
  );

  /**
   * Reset the analysis state
   */
  const reset = React.useCallback(() => {
    setIsAnalyzing(false);
    setProgress(0);
    setTotal(0);
    setResults(new Map());
    setError(null);
  }, []);

  return {
    isAnalyzing,
    progress,
    total,
    results,
    error,
    analyzeBatch,
    analyzePendingEntries,
    reset,
  };
}

// Import React for the hook
import React from 'react';
