/**
 * Guard Highlighter Content Script
 * Draws semi-transparent red overlays over detected dark patterns
 * Ensures overlays are scroll-aware and don't modify website's original CSS
 */

// Message types
const LIVE_GUARD_MESSAGES = {
  SHOW_HIGHLIGHTS: 'live-guard-show-highlights',
  CLEAR_HIGHLIGHTS: 'live-guard-clear-highlights',
} as const;

// Pattern data interface
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

// Overlay element interface
interface PatternOverlay {
  id: string;
  element: HTMLDivElement;
  pattern: DetectedPattern;
  tooltip: HTMLDivElement;
}

// Store active overlays
const activeOverlays = new Map<string, PatternOverlay>();

// Container for all overlays
let overlayContainer: HTMLDivElement | null = null;

/**
 * Create overlay container with Shadow DOM for isolation
 */
function createOverlayContainer(): HTMLDivElement {
  if (overlayContainer) {
    return overlayContainer;
  }

  const container = document.createElement('div');
  container.id = 'live-guard-overlay-container';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    overflow: hidden;
  `;

  document.body.appendChild(container);
  overlayContainer = container;

  return container;
}

/**
 * Create a semi-transparent red overlay for a pattern
 */
function createPatternOverlay(
  pattern: DetectedPattern,
  index: number,
): PatternOverlay {
  const container = createOverlayContainer();

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.id = `live-guard-overlay-${index}`;
  overlay.className = 'live-guard-pattern-overlay';

  // Set position based on bbox
  if (pattern.bbox && pattern.bbox.length === 4) {
    const [x, y, width, height] = pattern.bbox;
    overlay.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background-color: rgba(255, 77, 79, 0.3);
      border: 2px solid rgba(255, 77, 79, 0.8);
      border-radius: 4px;
      pointer-events: auto;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(255, 77, 79, 0.3);
    `;
  } else {
    // Fallback: center overlay if no bbox
    overlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      padding: 16px;
      background-color: rgba(255, 77, 79, 0.3);
      border: 2px solid rgba(255, 77, 79, 0.8);
      border-radius: 8px;
      pointer-events: auto;
      cursor: pointer;
      z-index: 2147483647;
    `;
  }

  // Create tooltip
  const tooltip = createTooltip(pattern);
  overlay.appendChild(tooltip);

  // Add hover events
  overlay.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
    tooltip.style.visibility = 'visible';
  });

  overlay.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
    tooltip.style.visibility = 'hidden';
  });

  // Add click event to show tooltip permanently
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    tooltip.style.opacity = '1';
    tooltip.style.visibility = 'visible';
    
    // Hide after 5 seconds
    setTimeout(() => {
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
    }, 5000);
  });

  container.appendChild(overlay);

  return {
    id: `overlay-${index}`,
    element: overlay,
    pattern,
    tooltip,
  };
}

/**
 * Create tooltip for pattern
 */
function createTooltip(pattern: DetectedPattern): HTMLDivElement {
  const tooltip = document.createElement('div');
  tooltip.className = 'live-guard-tooltip';
  tooltip.style.cssText = `
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 8px;
    min-width: 280px;
    max-width: 400px;
    padding: 12px 16px;
    background: linear-gradient(135deg, #fff7e6 0%, #ffc53d 100%);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    color: #262626;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
    z-index: 2147483648;
    pointer-events: none;
  `;

  // Pattern type
  const typeElement = document.createElement('div');
  typeElement.style.cssText = `
    font-weight: 700;
    font-size: 16px;
    margin-bottom: 4px;
    color: #d46b08;
  `;
  typeElement.textContent = `⚠️ ${pattern.type}`;
  tooltip.appendChild(typeElement);

  // Description
  const descElement = document.createElement('div');
  descElement.style.cssText = `
    margin-bottom: 8px;
    color: #595959;
  `;
  descElement.textContent = pattern.description;
  tooltip.appendChild(descElement);

  // Counter-measure
  const counterElement = document.createElement('div');
  counterElement.style.cssText = `
    padding-top: 8px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    font-weight: 600;
    color: #262626;
    white-space: pre-wrap;
  `;
  counterElement.textContent = pattern.counterMeasure;
  tooltip.appendChild(counterElement);

  return tooltip;
}

/**
 * Show highlights for detected patterns
 */
function showHighlights(patterns: DetectedPattern[]): void {
  // Clear existing overlays
  clearHighlights();

  // Create new overlays
  patterns.forEach((pattern, index) => {
    const overlay = createPatternOverlay(pattern, index);
    activeOverlays.set(overlay.id, overlay);
  });

  console.log(`[Live Guard] Created ${patterns.length} pattern overlays`);
}

/**
 * Clear all highlights
 */
function clearHighlights(): void {
  activeOverlays.forEach((overlay) => {
    overlay.element.remove();
  });
  activeOverlays.clear();

  if (overlayContainer) {
    overlayContainer.remove();
    overlayContainer = null;
  }

  console.log('[Live Guard] Cleared all highlights');
}

/**
 * Update overlay positions on scroll (scroll-aware)
 */
function updateOverlayPositions(): void {
  activeOverlays.forEach((overlay) => {
    const pattern = overlay.pattern;
    if (pattern.bbox && pattern.bbox.length === 4) {
      const [x, y, width, height] = pattern.bbox;
      overlay.element.style.left = `${x}px`;
      overlay.element.style.top = `${y}px`;
    }
  });
}

/**
 * Listen for messages from extension
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === LIVE_GUARD_MESSAGES.SHOW_HIGHLIGHTS) {
    const { patterns } = request;
    showHighlights(patterns);
    sendResponse({ success: true });
  } else if (request.action === LIVE_GUARD_MESSAGES.CLEAR_HIGHLIGHTS) {
    clearHighlights();
    sendResponse({ success: true });
  }

  return true;
});

/**
 * Listen for scroll events to update overlay positions
 */
let scrollTimeout: number | null = null;
window.addEventListener('scroll', () => {
  if (scrollTimeout) {
    window.clearTimeout(scrollTimeout);
  }
  scrollTimeout = window.setTimeout(() => {
    updateOverlayPositions();
  }, 100);
});

/**
 * Listen for resize events to update overlay positions
 */
window.addEventListener('resize', () => {
  if (scrollTimeout) {
    window.clearTimeout(scrollTimeout);
  }
  scrollTimeout = window.setTimeout(() => {
    updateOverlayPositions();
  }, 100);
});

/**
 * Clean up on page unload
 */
window.addEventListener('beforeunload', () => {
  clearHighlights();
});

console.log('[Live Guard] Guard highlighter content script loaded');
