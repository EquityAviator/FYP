# Dark Pattern Hunter - Architectural Audit Report

**Role:** Senior Systems Architect & Lead Security Researcher  
**Objective:** Deep-dive architectural audit providing structural, functional, and data-flow mapping of the Dark Pattern Hunter system.

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Detailed Module Breakdown](#2-detailed-module-breakdown)
3. [Critical Data Flow & Logic Gates](#3-critical-data-flow--logic-gates)
4. [Security & Persistence Analysis](#4-security--persistence-analysis)
5. [Technology Stack](#5-technology-stack)
6. [Dependency Graph](#6-dependency-graph)

---

## 1. High-Level System Architecture

### 1.1 Monorepo Mapping

The Dark Pattern Hunter project is organized as a **pnpm workspace monorepo** with the following structure:

```
dark-pattern-hunter/
├── apps/
│   └── chrome-extension/          # Consumer - Main Chrome Extension (Manifest V3)
├── packages/
│   ├── core/                      # Foundation - AI Model Integration & Service Callers
│   ├── shared/                    # Foundation - Utilities, Types, Base Database
│   ├── web-integration/           # Foundation - Browser Automation & CDP
│   ├── visualizer/                # Foundation - UI Components & State Management
│   ├── playground/                # Consumer - AI Playground Interface
│   └── recorder/                  # Foundation - Event Recording & Code Generation
```

### 1.2 Package Relationships

| Package | Role | Description |
|---------|------|-------------|
| `@darkpatternhunter/shared` | **Foundation** | Base utilities, types, environment configuration, IndexedDB base class |
| `@darkpatternhunter/core` | **Foundation** | AI model service callers, prompt templates, inference logic |
| `@darkpatternhunter/web-integration` | **Foundation** | Chrome DevTools Protocol, browser automation, element location |
| `@darkpatternhunter/visualizer` | **Foundation** | React components, Zustand stores, UI utilities |
| `@darkpatternhunter/recorder` | **Foundation** | Event recording, code generation (Playwright/YAML) |
| `@darkpatternhunter/playground` | **Consumer** | Playground UI components |
| `chrome-extension` | **Consumer** | Main application consuming all packages |

### 1.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION (apps/chrome-extension)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Live Guard  │  │   Dataset    │  │  Playground  │  │   Recorder   │    │
│  │    Module    │  │  Collection  │  │    Module    │  │    Module    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │            │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐    │
│  │ Bridge Mode  │  │   Settings   │  │    Popup     │  │   Content    │    │
│  │    Module    │  │    Module    │  │    Shell     │  │   Scripts    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FOUNDATION PACKAGES                                │
├────────────────┬────────────────┬────────────────┬─────────────────────────┤
│  @dph/core     │  @dph/shared   │ @dph/web       │  @dph/visualizer        │
│                │                │                │                         │
│ - AI Service   │ - BaseDB       │ - CDP Input    │ - Zustand Stores        │
│ - Prompts      │ - Env Config   │ - Web Page     │ - React Components      │
│ - Inference    │ - Types        │ - Web Element  │ - Theme Config          │
└────────────────┴────────────────┴────────────────┴─────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                  │
├────────────────────────────┬────────────────────────────────────────────────┤
│   LM Studio (Local AI)     │         OpenAI API (Cloud)                     │
│   http://localhost:1234    │         https://api.openai.com                 │
└────────────────────────────┴────────────────────────────────────────────────┘
```

---

## 2. Detailed Module Breakdown

### 2.1 Live Guard Module

**Location:** [`apps/chrome-extension/src/extension/live-guard/`](apps/chrome-extension/src/extension/live-guard/)

#### Core Task
Real-time dark pattern detection and visual highlighting on web pages. Provides immediate user protection through AI-powered analysis and overlay warnings.

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `tabId` | Chrome Tabs API | Active browser tab identifier |
| `screenshot` | `captureFullPage()` | Full-page screenshot (scroll-and-stitch) |
| `domTree` | `chrome.scripting.executeScript` | Serialized DOM structure |
| `modelConfig` | `getAIConfig()` | AI provider settings (local/cloud) |
| `userPrompt` | UI Input | Custom analysis instructions |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `DetectedPattern[]` | JSON Array | Dark patterns with coordinates, types, descriptions |
| `selector` | CSS Selector | DOM anchor for precise highlighting |
| `boundingBox` | `[x, y, width, height]` | Normalized coordinates (0-1000) |
| `counterMeasure` | String | Suggested protective action |

#### Automation Logic

```typescript
// 1. Full-Page Capture (scroll-and-stitch)
const screenshot = await captureFullPage(tabId, {
  maxSegments: 20,
  overlap: 100,
  scrollDelay: 300
});

// 2. DOM Extraction
const domTree = await chrome.scripting.executeScript({
  target: { tabId },
  files: ['scripts/htmlElement.js']
});

// 3. AI Analysis
const patterns = await analyzeWithAI(screenshot, domTree, modelConfig);

// 4. Highlight Injection
chrome.tabs.sendMessage(tabId, {
  action: 'SHOW_HIGHLIGHTS',
  patterns,
  screenshotSize: { width, height }
});
```

#### Differentiation
- **Live Guard vs Dataset Collection:** Live Guard provides real-time protection with visual overlays; Dataset Collection is for batch processing and research storage without real-time UI.
- **Live Guard vs Playground:** Live Guard is automated page analysis; Playground is interactive AI-driven browser automation.

---

### 2.2 Dataset Collection Module

**Location:** [`apps/chrome-extension/src/extension/dataset-collection/`](apps/chrome-extension/src/extension/dataset-collection/)

#### Core Task
Batch collection and storage of dark pattern data for research purposes. Supports crawling, annotation, and export in multiple formats (JSONL, COCO, YOLO).

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `urls` | UI Input | List of URLs to crawl |
| `crawlConfig` | UI Settings | BFS depth, max pages, delay |
| `screenshot` | `captureFullPage()` | Full-page or viewport capture |
| `patterns` | AI Analysis | Detected dark patterns |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `DatasetEntry` | IndexedDB Record | Stored analysis result |
| `JSONL Export` | File | Training data format |
| `COCO/YOLO Export` | ZIP | Computer vision dataset |

#### Automation Logic

```typescript
// BFS Crawler Implementation
async function crawlWebsite(startUrl: string, config: CrawlConfig) {
  const queue: string[] = [startUrl];
  const visited: Set<string> = new Set();
  
  while (queue.length > 0 && visited.size < config.maxPages) {
    const url = queue.shift()!;
    const normalizedUrl = normalizeUrl(url);
    
    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);
    
    // Analyze page
    const patterns = await analyzePage(url);
    await storeDatasetEntry({ url, patterns, screenshot });
    
    // Extract and queue links
    const links = await extractLinks(url);
    queue.push(...links.filter(l => !visited.has(normalizeUrl(l))));
  }
}
```

#### Differentiation
- **Dataset Collection vs Live Guard:** Dataset Collection is for offline research and training data generation; Live Guard is for real-time user protection.

---

### 2.3 Playground Module

**Location:** [`apps/chrome-extension/src/components/playground/`](apps/chrome-extension/src/components/playground/)

#### Core Task
Interactive AI-driven browser automation interface. Users can issue natural language commands to control browser actions.

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `userPrompt` | UI Input | Natural language command |
| `screenshot` | CDP | Current viewport screenshot |
| `elementTree` | Web Element | Parsed DOM structure |
| `modelConfig` | Zustand Store | AI configuration |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `ActionResult` | JSON | AI-planned action result |
| `aiClick` | Action | Click at coordinates |
| `aiType` | Action | Type text into element |
| `aiScroll` | Action | Scroll page |

#### Automation Logic

```typescript
// AI Agent Planning Flow
const agent = new ChromeExtensionProxyPageAgent(page);

// User prompt: "Click the submit button"
const result = await agent.ai('Click the submit button');

// Internal flow:
// 1. Capture screenshot
// 2. Parse element tree
// 3. Send to AI model with prompt
// 4. Parse AI response for action
// 5. Execute action via CDP
```

#### Differentiation
- **Playground vs Recorder:** Playground is for live AI-driven automation; Recorder captures and replays user actions for test generation.

---

### 2.4 Recorder Module

**Location:** [`apps/chrome-extension/src/extension/recorder/`](apps/chrome-extension/src/extension/recorder/)

#### Core Task
Record user browser interactions and generate automated test code (Playwright/YAML). Supports session management and code streaming.

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `userActions` | Event Listeners | Click, type, scroll events |
| `tabId` | Chrome Tabs API | Monitored tab |
| `sessionConfig` | UI Settings | Recording preferences |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `RecordingSession` | IndexedDB | Stored session with events |
| `Playwright Code` | .spec.ts | Generated test file |
| `YAML Script` | .yaml | Declarative test script |

#### Automation Logic

```typescript
// Event Recording
chrome.debugger.attach({ tabId }, '1.3');
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Input.mousePressed') {
    recordEvent({
      type: 'click',
      coordinates: params.x, params.y,
      timestamp: Date.now()
    });
  }
});

// Code Generation
const playwrightCode = await generatePlaywrightTest(session, {
  stream: true,
  onChunk: (chunk) => updateUI(chunk)
});
```

#### Differentiation
- **Recorder vs Bridge Mode:** Recorder captures and generates code; Bridge Mode connects to external IDE for real-time control.

---

### 2.5 Bridge Mode Module

**Location:** [`apps/chrome-extension/src/extension/bridge/`](apps/chrome-extension/src/extension/bridge/)

#### Core Task
WebSocket-based communication bridge between the Chrome extension and external development environments (IDE, CLI tools).

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `WebSocket Messages` | Socket.IO | External commands |
| `bridgeEndpoint` | Config | Server URL (default: localhost:9322) |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `BridgeResponse` | JSON | Action results |
| `Status Updates` | Event | Connection state changes |

#### Automation Logic

```typescript
// Bridge Connection
const socket = io(bridgeEndpoint);

socket.on('call', async (data) => {
  const result = await executeAction(data.action, data.params);
  socket.emit('callResponse', { id: data.id, response: result });
});

// Actions: aiAction, aiQuery, aiAssert, screenshot, navigate
```

#### Differentiation
- **Bridge Mode vs Playground:** Bridge Mode is for external tool integration; Playground is for direct user interaction.

---

### 2.6 Core Package

**Location:** [`packages/core/`](packages/core/)

#### Core Task
Central AI model integration layer. Provides unified service callers for OpenAI-compatible APIs (cloud and local).

#### Input Data
| Input | Source | Description |
|-------|--------|-------------|
| `messages` | API Call | Chat completion messages |
| `modelConfig` | Config | Model name, API key, base URL |
| `imageBase64` | Screenshot | Page screenshot for vision models |

#### Output Data
| Output | Format | Description |
|--------|--------|-------------|
| `AI Response` | JSON/Text | Model completion |
| `Parsed Actions` | Structured | Extracted actions from response |

#### Service Caller Architecture

```typescript
// packages/core/src/ai-model/service-caller.ts
export async function callAI(
  messages: ChatMessage[],
  config: ModelConfig,
  mode: 'text' | 'json' | 'vision'
) {
  const client = new OpenAI({
    baseURL: config.openaiBaseURL, // LM Studio: http://localhost:1234/v1
    apiKey: config.openaiApiKey    // LM Studio: 'lm-studio'
  });
  
  return await client.chat.completions.create({
    model: config.modelName,
    messages,
    response_format: mode === 'json' ? { type: 'json_object' } : undefined
  });
}
```

---

## 3. Critical Data Flow & Logic Gates

### 3.1 AI Inference Path

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI INFERENCE FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

User Action (UI)
       │
       ▼
┌──────────────────┐
│  Zustand Store   │  useEnvConfig() / getAIConfig()
│  (aiConfig.ts)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌─────────────────────────────────────┐
│ Provider Check   │────▶│ provider === 'local' ?              │
│                  │     │   LM Studio (localhost:1234/v1)     │
│                  │     │   : OpenAI (api.openai.com/v1)      │
└────────┬─────────┘     └─────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│ Service Caller   │  packages/core/src/ai-model/service-caller.ts
│ (OpenAI SDK)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  AI Model API    │  GPT-4o / Local LLM via OpenAI-compatible API
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Response Parser  │  Extract patterns, actions, coordinates
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  UI Update /     │  Display results, highlight elements
│  Action Execute  │
└──────────────────┘
```

### 3.2 Highlighter Logic Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HIGHLIGHTER LOGIC FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

AI Response (Normalized 0-1000 coordinates)
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ guardHighlighter.ts - showHighlights(patterns, screenshotSize, totalHeight)│
└───────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────┐
│ For Each Pattern │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ findDomElement(pattern)                                                    │
│                                                                            │
│ Priority 1: CSS Selector (pattern.selector)                               │
│   → document.querySelector(selector)                                       │
│                                                                            │
│ Priority 2: Text Content Match                                             │
│   → findElementByText(pattern.elementText)                                 │
│                                                                            │
│ Priority 3: Bounding Box Center Point                                      │
│   → elementFromPoint(centerX, centerY)                                     │
└───────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ createHighlightOverlay(element, pattern)                                   │
│                                                                            │
│ 1. Get precise position: element.getBoundingClientRect()                   │
│ 2. Create Shadow DOM host for style isolation                             │
│ 3. Inject overlay div with:                                                │
│    - position: absolute                                                    │
│    - top/left/width/height from getBoundingClientRect()                   │
│    - z-index: 2147483647                                                   │
│    - pointer-events: none                                                  │
│    - Animated pulse effect                                                 │
└───────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│ Overlay Visible  │  User sees highlighted dark pattern
│ on Web Page      │
└──────────────────┘
```

### 3.3 Crawl & Analyze Flow (BFS)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CRAWLER BFS LOGIC                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Start URL
     │
     ▼
┌──────────────────┐
│ Initialize Queue │  queue = [startUrl], visited = Set()
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ BFS Loop                                                                  │
│                                                                           │
│ while (queue.length > 0 && visited.size < maxPages) {                    │
│   url = queue.shift()                                                     │
│   normalizedUrl = normalizeUrl(url)  // Remove fragments, trailing slash │
│                                                                           │
│   if (visited.has(normalizedUrl)) continue                               │
│   visited.add(normalizedUrl)                                              │
│                                                                           │
│   // Page Analysis                                                        │
│   screenshot = await captureFullPage(tabId)                              │
│   patterns = await analyzeWithAI(screenshot)                             │
│   await storeDatasetEntry({ url, patterns, screenshot })                 │
│                                                                           │
│   // Link Extraction                                                      │
│   links = await extractLinks(tabId)                                       │
│   filteredLinks = links.filter(isSameDomain(startUrl))                   │
│   queue.push(...filteredLinks)                                            │
│ }                                                                         │
└───────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│ Export Dataset   │  JSONL / COCO / YOLO formats
└──────────────────┘
```

---

## 4. Security & Persistence Analysis

### 4.1 Storage Architecture

#### chrome.storage.local (Configuration)

```typescript
// Used for user preferences and API keys
// Location: apps/chrome-extension/src/utils/aiConfig.ts

const AI_STORAGE_KEYS = {
  PROVIDER: 'ai-provider',           // 'local' | 'openai'
  OPENAI_API_KEY: 'openai-api-key',
  LOCAL_AI_HOST: 'local-ai-host',    // Default: 'http://localhost:1234'
  LOCAL_AI_ENABLED: 'local-ai-enabled',
  SELECTED_MODEL: 'selected-model'
};

// Read/Write via Chrome Storage API
await chrome.storage.local.set({ [AI_STORAGE_KEYS.PROVIDER]: 'local' });
const result = await chrome.storage.local.get([AI_STORAGE_KEYS.PROVIDER]);
```

#### IndexedDB (Large-Scale Data)

| Database Name | Store | Purpose |
|---------------|-------|---------|
| `dph-recorder` | `recording-sessions` | Recorded browser sessions |
| `dph-recorder` | `config` | Recorder configuration |
| `dph_dataset` | `dataset_entries` | Dark pattern analysis results |
| `dph_bridge` | `bridge_messages` | Bridge mode message history |

```typescript
// Database Manager Pattern
// Location: apps/chrome-extension/src/utils/indexedDB.ts

class IndexedDBManager {
  private db: IDBDatabase | null = null;
  
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        }
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
    });
  }
}
```

### 4.2 State Management (Zustand)

```typescript
// Location: apps/chrome-extension/src/store.tsx

// Environment Configuration Store
export const useEnvConfig = create<EnvConfigState>((set, get) => ({
  config: {},
  setConfig: (config) => set({ config }),
  
  // Persists to chrome.storage.local
  persistConfig: async () => {
    const { config } = get();
    await chrome.storage.local.set({ 'dph-env-config': config });
  }
}));

// Recording Session Store
export const useRecordingSessionStore = create<RecordingSessionState>((set) => ({
  sessions: [],
  currentSessionId: null,
  isRecording: false,
  
  // Operations persist to IndexedDB via dbManager
  addSession: async (session) => {
    await dbManager.addSession(session);
    set((state) => ({ sessions: [...state.sessions, session] }));
  }
}));
```

### 4.3 Security Considerations

| Aspect | Implementation | Risk Level |
|--------|---------------|------------|
| API Key Storage | `chrome.storage.local` (not encrypted) | Medium - Local machine only |
| Content Script Isolation | Shadow DOM for overlays | Low - Style isolation |
| Debugger Protocol | Requires user permission per tab | Low - Explicit consent |
| Screenshot Data | Base64 in memory, IndexedDB for persistence | Medium - Sensitive page data |
| Cross-Origin Requests | Handled by Chrome extension permissions | Low - Declared in manifest |

---

## 5. Technology Stack

### 5.1 Core Technologies

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Framework** | React 18 | UI components |
| **Build Tool** | RSBuild | Fast bundling, HMR |
| **Language** | TypeScript | Type safety |
| **UI Library** | Ant Design 5 | Component library |
| **State Management** | Zustand | Lightweight state |
| **Persistence** | IndexedDB | Large-scale storage |
| **Extension API** | Chrome Manifest V3 | Browser extension |
| **AI SDK** | OpenAI SDK | Model integration |

### 5.2 Development Tools

| Tool | Purpose |
|------|---------|
| pnpm | Package manager (workspace support) |
| Nx | Build orchestration |
| Biome | Linting & formatting |
| Husky | Git hooks |
| Commitizen | Conventional commits |

---

## 6. Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEPENDENCY HIERARCHY                               │
└─────────────────────────────────────────────────────────────────────────────┘

Level 0 (No dependencies on other packages):
├── @darkpatternhunter/shared
│   └── Base utilities, types, IndexedDB base class
│
Level 1 (Depends on Level 0):
├── @darkpatternhunter/core
│   └── Depends on: @darkpatternhunter/shared
│   └── AI service callers, prompts
│
├── @darkpatternhunter/recorder
│   └── Depends on: @darkpatternhunter/shared
│   └── Event types, recording logic
│
Level 2 (Depends on Level 0-1):
├── @darkpatternhunter/web-integration
│   └── Depends on: @darkpatternhunter/core, @darkpatternhunter/shared
│   └── Browser automation, CDP
│
├── @darkpatternhunter/visualizer
│   └── Depends on: @darkpatternhunter/core, @darkpatternhunter/shared
│   └── UI components, Zustand stores
│
Level 3 (Depends on Level 0-2):
├── @darkpatternhunter/playground
│   └── Depends on: @darkpatternhunter/web-integration, @darkpatternhunter/visualizer
│   └── Playground UI
│
Level 4 (Consumer - all packages):
└── chrome-extension
    └── Depends on: ALL packages
    └── Main application
```

---

## Appendix A: Key File Locations

| Component | Path |
|-----------|------|
| Live Guard UI | `apps/chrome-extension/src/extension/live-guard/index.tsx` |
| Highlighter Script | `apps/chrome-extension/src/extension/live-guard/guardHighlighter.ts` |
| Dataset Collection | `apps/chrome-extension/src/extension/dataset-collection/index.tsx` |
| Playground | `apps/chrome-extension/src/components/playground/index.tsx` |
| Recorder | `apps/chrome-extension/src/extension/recorder/index.tsx` |
| Bridge Mode | `apps/chrome-extension/src/extension/bridge/index.tsx` |
| Settings | `apps/chrome-extension/src/extension/settings/index.tsx` |
| AI Config | `apps/chrome-extension/src/utils/aiConfig.ts` |
| IndexedDB Manager | `apps/chrome-extension/src/utils/indexedDB.ts` |
| Dataset DB | `apps/chrome-extension/src/utils/datasetDB.ts` |
| Full Page Capture | `apps/chrome-extension/src/utils/fullPageCapture.ts` |
| Core AI Service | `packages/core/src/ai-model/service-caller.ts` |
| Zustand Store | `apps/chrome-extension/src/store.tsx` |

---

## Appendix B: Message Types

### Content Script Communication

```typescript
// Live Guard Messages
const MESSAGE_TYPES = {
  CLEAR_HIGHLIGHTS: 'live-guard-clear-highlights',
  SHOW_HIGHLIGHTS: 'live-guard-show-highlights',
  FOCUS_PATTERN: 'live-guard-focus-pattern'
};

// Message Structure
interface ShowHighlightsMessage {
  action: typeof MESSAGE_TYPES.SHOW_HIGHLIGHTS;
  patterns: DetectedPattern[];
  screenshotSize: { width: number; height: number };
  isNormalized: boolean;
  totalHeight?: number;
  isFullPage?: boolean;
}
```

---

**Document Version:** 1.0  
**Last Updated:** February 2026  
**Author:** Dark Pattern Hunter Architecture Team
