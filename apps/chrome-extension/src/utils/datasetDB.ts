import { IndexedDBManager, withErrorHandling } from '@darkpatternhunter/shared/baseDB';
import JSZip from 'jszip';

// Database configuration
const DB_NAME = 'midscene_dataset';
const DB_VERSION = 1;
const DATASET_ENTRIES_STORE = 'dataset_entries';

// Dataset entry interface
export interface DatasetEntry {
  id: string;
  url: string;
  timestamp: number;
  screenshot?: string;
  dom?: string;
  patterns: DarkPattern[];
  metadata?: {
    pageTitle?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    researchContext?: {
      isPakistaniEcommerce?: boolean;
      siteName?: string;
      modelUsed?: string;
      analysisVersion?: string;
    };
  };
  summary?: {
    total_patterns: number;
    prevalence_score: number;
    primary_categories: string[];
  };
}

export interface DarkPattern {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  evidence: string;
  confidence?: number;
  bbox?: [number, number, number, number]; // [x, y, width, height]
  croppedImage?: string; // Individual cropped image showing ONLY this pattern (base64 data URL)
}

// IndexedDB entry interface (for storage)
interface IndexedDBDatasetEntry {
  id: string;
  url: string;
  timestamp: number;
  screenshot?: string;
  dom?: string;
  patterns: DarkPattern[];
  metadata?: {
    pageTitle?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    researchContext?: {
      isPakistaniEcommerce?: boolean;
      siteName?: string;
      modelUsed?: string;
      analysisVersion?: string;
    };
  };
  summary?: {
    total_patterns: number;
    prevalence_score: number;
    primary_categories: string[];
  };
}

// Database manager instance
const datasetDbManager = new IndexedDBManager(DB_NAME, DB_VERSION, [
  { name: DATASET_ENTRIES_STORE, keyPath: 'id' },
]);

// Get all dataset entries from IndexedDB
export const getDatasetEntries = async (): Promise<DatasetEntry[]> => {
  return (
    (await withErrorHandling(
      async () => {
        const entries = await datasetDbManager.getAll<IndexedDBDatasetEntry>(
          DATASET_ENTRIES_STORE,
          true,
        );

        return entries.map((entry) => ({
          id: entry.id,
          url: entry.url,
          timestamp: entry.timestamp,
          screenshot: entry.screenshot,
          dom: entry.dom,
          patterns: entry.patterns,
          metadata: entry.metadata,
          summary: entry.summary,
        }));
      },
      'Failed to get dataset entries from IndexedDB',
      [],
    )) ?? []
  );
};

// Store dataset entry to IndexedDB
export const storeDatasetEntry = async (entry: DatasetEntry): Promise<void> => {
  await withErrorHandling(async () => {
    const data: IndexedDBDatasetEntry = {
      id: entry.id,
      url: entry.url,
      timestamp: entry.timestamp,
      screenshot: entry.screenshot,
      dom: entry.dom,
      patterns: entry.patterns,
      metadata: entry.metadata,
      summary: entry.summary,
    };

    await datasetDbManager.put(DATASET_ENTRIES_STORE, data);
  }, 'Failed to store dataset entry');
};

// Delete dataset entry from IndexedDB
export const deleteDatasetEntry = async (id: string): Promise<void> => {
  await withErrorHandling(
    () => datasetDbManager.delete(DATASET_ENTRIES_STORE, id),
    'Failed to delete dataset entry',
  );
};

// Clear all dataset entries
export const clearDatasetEntries = async (): Promise<void> => {
  await withErrorHandling(
    () => datasetDbManager.clear(DATASET_ENTRIES_STORE),
    'Failed to clear dataset entries',
  );
};

// Get dataset entry count
export const getDatasetEntryCount = async (): Promise<number> => {
  return (
    (await withErrorHandling(
      () => datasetDbManager.count(DATASET_ENTRIES_STORE),
      'Failed to get dataset entry count',
      0,
    )) ?? 0
  );
};

// Export dataset as JSONL
export const exportDatasetAsJSONL = async (): Promise<string> => {
  const entries = await getDatasetEntries();
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
};

// Export dataset as formatted JSON array
export const exportDatasetAsJSON = async (
  pretty: boolean | number = 2,
): Promise<string> => {
  const entries = await getDatasetEntries();
  const spacing =
    typeof pretty === 'number' && pretty >= 0 ? pretty : pretty ? 2 : undefined;
  return JSON.stringify(entries, null, spacing);
};

// Text-only JSONL export, flattened per detected pattern
export interface TextPatternExample {
  id: string;
  url: string;
  page_title?: string;
  site_name?: string;
  pattern_type: string;
  severity: DarkPattern['severity'];
  label: string;
  evidence: string;
  description: string;
  dom_excerpt?: string;
  research_tags?: {
    isPakistaniEcommerce?: boolean;
    modelUsed?: string;
    analysisVersion?: string;
  };
}

export const exportTextDatasetAsJSONL = async (): Promise<string> => {
  const entries = await getDatasetEntries();
  const lines: string[] = [];

  entries.forEach((entry) => {
    if (!entry.patterns || entry.patterns.length === 0) {
      return;
    }

    entry.patterns.forEach((pattern, idx) => {
      const example: TextPatternExample = {
        id: `${entry.id}#${idx}`,
        url: entry.url,
        page_title: entry.metadata?.pageTitle,
        site_name: entry.metadata?.researchContext?.siteName,
        pattern_type: pattern.type,
        severity: pattern.severity,
        label: pattern.type,
        evidence: pattern.evidence,
        description: pattern.description,
        dom_excerpt: entry.dom,
        research_tags: {
          isPakistaniEcommerce: entry.metadata?.researchContext?.isPakistaniEcommerce,
          modelUsed: entry.metadata?.researchContext?.modelUsed,
          analysisVersion: entry.metadata?.researchContext?.analysisVersion,
        },
      };

      lines.push(JSON.stringify(example));
    });
  });

  return lines.join('\n');
};

const sanitizeFilename = (value: string, fallback: string) => {
  const sanitized = value.replace(/[^a-z0-9-_]/gi, '_');
  return sanitized.length > 0 ? sanitized : fallback;
};

export interface ExportedDatasetRecord {
  id: string;
  url: string;
  timestamp: number;
  image_path: string | null;
  dom_excerpt?: string;
  patterns: DarkPattern[];
  summary?: DatasetEntry['summary'];
  metadata?: DatasetEntry['metadata'];
}

export const exportDatasetAsBundleZip = async (): Promise<Blob> => {
  const entries = await getDatasetEntries();
  const zip = new JSZip();
  const imagesFolder = zip.folder('images');
  const manifest: ExportedDatasetRecord[] = [];
  const jsonlLines: string[] = [];

  entries.forEach((entry, index) => {
    const safeId = sanitizeFilename(entry.id, `entry_${index + 1}`);
    const imageFileName = `${safeId}.png`;
    let imagePath: string | null = null;

    if (entry.screenshot && imagesFolder) {
      const match = entry.screenshot.match(/^data:(.*?);base64,(.*)$/);
      const base64Payload = match ? match[2] : null;
      if (base64Payload) {
        imagesFolder.file(imageFileName, base64Payload, { base64: true });
        imagePath = `images/${imageFileName}`;
      }
    }

    const exportedRecord: ExportedDatasetRecord = {
      id: entry.id,
      url: entry.url,
      timestamp: entry.timestamp,
      image_path: imagePath,
      dom_excerpt: entry.dom,
      patterns: entry.patterns,
      summary: entry.summary,
      metadata: entry.metadata,
    };

    manifest.push(exportedRecord);
    jsonlLines.push(JSON.stringify(exportedRecord));
  });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('processed.jsonl', jsonlLines.join('\n'));

  return zip.generateAsync({ type: 'blob' });
};

// UI-TARS fine-tuning format: Individual cropped image per pattern
export interface UITarsTrainingExample {
  image_path: string; // Path to individual cropped image showing ONLY this pattern
  pattern_type: string;
  bbox: [number, number, number, number]; // [x, y, width, height] - original coordinates in full screenshot
  label: string;
  severity: string;
  evidence: string;
  metadata: {
    url: string;
    page_title?: string;
    site_name?: string;
    original_entry_id?: string;
  };
}

export const exportForUITarsFineTuning = async (): Promise<Blob> => {
  const entries = await getDatasetEntries();
  const zip = new JSZip();
  const imagesFolder = zip.folder('images');
  const annotationsFolder = zip.folder('annotations');
  const trainingExamples: UITarsTrainingExample[] = [];

  let imageCounter = 0;

  entries.forEach((entry, entryIndex) => {
    // Process each pattern individually - each gets its own image
    entry.patterns.forEach((pattern, patternIndex) => {
      // Only include patterns with cropped images and bounding boxes
      if (!pattern.croppedImage || !pattern.bbox || pattern.bbox.length !== 4) {
        return; // Skip patterns without cropped images
      }

      imageCounter++;
      const safeId = sanitizeFilename(entry.id, `entry_${entryIndex + 1}`);
      const imageFileName = `${safeId}_pattern_${patternIndex + 1}_${sanitizeFilename(pattern.type, 'pattern')}.png`;
      let imagePath: string | null = null;

      // Extract and save INDIVIDUAL cropped image for THIS pattern only
      if (pattern.croppedImage && imagesFolder) {
        const match = pattern.croppedImage.match(/^data:(.*?);base64,(.*)$/);
        const base64Payload = match ? match[2] : null;
        if (base64Payload) {
          imagesFolder.file(imageFileName, base64Payload, { base64: true });
          imagePath = `images/${imageFileName}`;
        }
      }

      // Create training example - ONE example per pattern with its own image
      const example: UITarsTrainingExample = {
        image_path: imagePath || '',
        pattern_type: pattern.type,
        bbox: pattern.bbox, // Original bbox coordinates from full screenshot
        label: pattern.type,
        severity: pattern.severity,
        evidence: pattern.evidence,
        metadata: {
          url: entry.url,
          page_title: entry.metadata?.pageTitle,
          site_name: entry.metadata?.researchContext?.siteName,
          original_entry_id: entry.id,
        },
      };

      trainingExamples.push(example);

      // Save individual annotation file for this pattern
      if (annotationsFolder) {
        annotationsFolder.file(
          `${safeId}_pattern_${patternIndex + 1}.json`,
          JSON.stringify(example, null, 2)
        );
      }
    });
  });

  // Create training dataset JSONL (one example per line - each line = one pattern with its own image)
  const trainingJsonl = trainingExamples
    .map(ex => JSON.stringify(ex))
    .join('\n');

  zip.file('train.jsonl', trainingJsonl);
  zip.file('dataset_info.json', JSON.stringify({
    total_images: imageCounter, // Number of individual cropped images
    total_patterns: trainingExamples.length, // Same as total_images (one image per pattern)
    pattern_types: [...new Set(trainingExamples.map(ex => ex.pattern_type))],
    created_at: new Date().toISOString(),
    format: 'individual_cropped_images', // Each pattern has its own cropped image
  }, null, 2));

  return zip.generateAsync({ type: 'blob' });
};


