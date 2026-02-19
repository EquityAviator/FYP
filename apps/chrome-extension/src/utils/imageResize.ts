/**
 * Image Resizing Utility for Local AI Models
 * 
 * Small local models like Gemma 3 4B have limited context windows.
 * This utility resizes images to fit within the model's capacity.
 */

import { getDebug } from '@darkpatternhunter/shared/logger';

const debug = getDebug('image-resize');

/**
 * Image size limits for different model types
 */
export const MODEL_IMAGE_LIMITS = {
  // Small models (4B parameters or less)
  small: {
    maxPixels: 1024 * 1024, // ~1MP
    maxWidth: 1024,
    maxHeight: 1024,
  },
  // Medium models (7B-13B parameters)
  medium: {
    maxPixels: 1792 * 1792, // ~3.2MP
    maxWidth: 1792,
    maxHeight: 1792,
  },
  // Large models (GPT-4o class)
  large: {
    maxPixels: 2048 * 768,
    maxWidth: 2048,
    maxHeight: 768,
  },
} as const;

/**
 * Model size categories based on name patterns
 */
const SMALL_MODEL_PATTERNS = [
  'gemma-3-4b',
  'gemma-3-2b',
  'gemma-3-1b',
  'gemma-2-2b',
  'gemma-2-9b',
  'phi-3',
  'phi-2',
  'tinyllama',
  'minicpm',
  'qwen2.5-1.5b',
  'qwen2.5-3b',
  'qwen2.5-7b',
  'llama-3.2-1b',
  'llama-3.2-3b',
];

const MEDIUM_MODEL_PATTERNS = [
  'llama-3.1-8b',
  'llama-3.2-11b',
  'mistral-7b',
  'qwen2.5-14b',
  'gemma-2-27b',
];

/**
 * Detect model size category from model name
 */
export function detectModelSize(modelName: string): 'small' | 'medium' | 'large' {
  const normalizedName = modelName.toLowerCase();
  
  // Check for small models
  for (const pattern of SMALL_MODEL_PATTERNS) {
    if (normalizedName.includes(pattern)) {
      debug(`Detected small model: ${modelName} (matched: ${pattern})`);
      return 'small';
    }
  }
  
  // Check for medium models
  for (const pattern of MEDIUM_MODEL_PATTERNS) {
    if (normalizedName.includes(pattern)) {
      debug(`Detected medium model: ${modelName} (matched: ${pattern})`);
      return 'medium';
    }
  }
  
  // Default to small for safety (better to resize too much than too little)
  debug(`Unknown model size for ${modelName}, defaulting to small`);
  return 'small';
}

/**
 * Calculate new dimensions maintaining aspect ratio
 */
export function calculateResizeDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number,
  maxPixels: number,
): { width: number; height: number } {
  const currentPixels = originalWidth * originalHeight;
  
  // If already within limits, return original
  if (originalWidth <= maxWidth && originalHeight <= maxHeight && currentPixels <= maxPixels) {
    return { width: originalWidth, height: originalHeight };
  }
  
  // Calculate scale factor based on all constraints
  const widthScale = maxWidth / originalWidth;
  const heightScale = maxHeight / originalHeight;
  const pixelScale = Math.sqrt(maxPixels / currentPixels);
  
  // Use the smallest scale factor to ensure all constraints are met
  const scale = Math.min(widthScale, heightScale, pixelScale, 1);
  
  const newWidth = Math.floor(originalWidth * scale);
  const newHeight = Math.floor(originalHeight * scale);
  
  debug(`Resize calculated: ${originalWidth}x${originalHeight} -> ${newWidth}x${newHeight} (scale: ${scale.toFixed(3)})`);
  
  return { width: newWidth, height: newHeight };
}

/**
 * Resize a base64 image using canvas
 * This runs in the browser context
 */
export async function resizeBase64Image(
  base64Image: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      // Create canvas with target dimensions
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Use high-quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw resized image
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      
      // Convert to base64 (JPEG for smaller size)
      const resizedBase64 = canvas.toDataURL('image/jpeg', 0.85);
      
      debug(`Image resized successfully: ${img.width}x${img.height} -> ${targetWidth}x${targetHeight}`);
      resolve(resizedBase64);
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image for resizing'));
    };
    
    img.src = base64Image;
  });
}

/**
 * Get image dimensions from base64
 */
export async function getImageDimensions(
  base64Image: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    
    img.src = base64Image;
  });
}

/**
 * Resize image for local AI model if needed
 * 
 * @param base64Image - The base64 encoded image
 * @param modelName - The model name to determine size limits
 * @returns Resized image (or original if no resize needed)
 */
export async function resizeImageForLocalModel(
  base64Image: string,
  modelName: string,
): Promise<{
  image: string;
  originalSize: { width: number; height: number };
  resizedSize: { width: number; height: number };
  wasResized: boolean;
}> {
  // Get original dimensions
  const originalSize = await getImageDimensions(base64Image);
  debug(`Original image size: ${originalSize.width}x${originalSize.height}`);
  
  // Detect model size category
  const modelSize = detectModelSize(modelName);
  const limits = MODEL_IMAGE_LIMITS[modelSize];
  
  // Calculate if resize is needed
  const newSize = calculateResizeDimensions(
    originalSize.width,
    originalSize.height,
    limits.maxWidth,
    limits.maxHeight,
    limits.maxPixels,
  );
  
  // If no resize needed, return original
  if (newSize.width === originalSize.width && newSize.height === originalSize.height) {
    debug('No resize needed, returning original image');
    return {
      image: base64Image,
      originalSize,
      resizedSize: originalSize,
      wasResized: false,
    };
  }
  
  // Resize the image
  debug(`Resizing image for ${modelSize} model (${modelName})`);
  const resizedImage = await resizeBase64Image(
    base64Image,
    newSize.width,
    newSize.height,
  );
  
  return {
    image: resizedImage,
    originalSize,
    resizedSize: newSize,
    wasResized: true,
  };
}

/**
 * Check if an image needs resizing for a given model
 */
export function needsResizeForModel(
  width: number,
  height: number,
  modelName: string,
): boolean {
  const modelSize = detectModelSize(modelName);
  const limits = MODEL_IMAGE_LIMITS[modelSize];
  
  const currentPixels = width * height;
  
  return (
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    currentPixels > limits.maxPixels
  );
}
