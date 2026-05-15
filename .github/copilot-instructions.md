# Copilot Instructions for Term Manager

## Project Overview

**Term Manager** is a lightweight Electron-based terminology management system for English-Chinese/Chinese-English bilingual term extraction, organization, and consistency checking. The application runs entirely on the desktop with local SQLite storage, no server dependency.

**Key Tech Stack:**
- **Frontend:** React 18 + TypeScript + Ant Design
- **Backend:** Electron main process + Node.js services
- **Database:** SQLite (better-sqlite3)
- **NLP:** nodejieba (Chinese), natural (English)
- **AI Integration:** DeepSeek API for intelligent term analysis (optional module)

---

## Architecture Pattern

### Main Process ↔ Renderer IPC Architecture

The application follows classic Electron pattern:

```
Main Process (Node.js) ← IPC → Renderer Process (React Web)
     ↓
  SQLite DB
  File System
  DeepSeek API
```

**IPC Communication Examples:**
- `get-terms` / `add-term` / `update-term` / `delete-term` → CRUD operations
- `extract-terms-from-file` → Triggers term extraction engine
- `check-consistency` → Runs consistency checker
- `ai-review-term` / `ai-extract-terms` → AI service calls

All IPC handlers are registered in `ipc-handlers.ts` (main process). Renderer communicates through `contextBridge` exposed API in preload script.

### Data Model (SQLite Schema)

Core tables:
- `terms`: source_lang, term_text, target_lang, target_text, domain_id, description
- `term_relations`: term_id, relation_type (synonym/near_synonym/polysemy), related_term_id
- `term_sources`: term_id, source_type (web_extract/plain_text/high_quality/official/manual), credibility_score
- `domains`: hierarchical category structure (name, parent_id)
- `extraction_jobs`: Track extraction history with JSON rules

**Key Pattern:** Use parameterized queries with `better-sqlite3` to prevent SQL injection. Example: `db.prepare('SELECT * FROM terms WHERE domain_id = ?').all(domainId)`

---

## Critical Workflows

### 1. Term Extraction Flow

**File:** `src/main/term-engine/`

Pipeline:
1. **Document Parsing** (`parser.ts`): Convert .txt/.docx/.pdf/.html → plain text
   - Uses: `mammoth` (docx), `pdf-parse` (pdf), `cheerio` (HTML)
2. **Segmentation** (`segmenter.ts`): Chinese → nodejieba, English → natural
3. **Candidate Generation** (`rules.ts`): 
   - Frequency filtering (min length, min occurrence)
   - POS-based patterns (e.g., "adjective+noun")
   - User-defined regex rules (JSON config)
4. **Filtering & Deduplication**: Apply scoring, remove stopwords
5. **Auto-pairing**: If bilingual content detected, extract term pairs

**Config Format (JSON):** Allows custom regex, min_length, min_freq, pos_templates, custom_dict

### 2. Consistency Check Algorithm

**File:** `src/main/consistency-checker.ts`

Detects:
- One English term → multiple Chinese translations (ambiguity)
- Spelling inconsistencies (case, hyphens) → Levenshtein distance
- Conflicts with official sources

Optional: Use `transformers.js` for semantic similarity in polysemy detection.

### 3. AI Service Integration (Optional)

**File:** `src/main/ai-client.ts`

Functions:
- `aiExtractTerms(text, language)` → DeepSeek analyzes text, returns structured term definitions
- `aiReviewTerm(sourceTerm, targetTerm, sourceLang, targetLang)` → Multi-dimensional evaluation (accuracy, consistency, semantic nuance, context suitability)

**Security:** API key stored encrypted via `electron-store` or system Keychain. User must opt-in before cloud data upload.

**Prompt Template Pattern:**
```typescript
const TERM_REVIEW_PROMPT = `请评价术语对翻译质量：
源语言术语：{source_term}（{source_lang}）
目标语言翻译：{target_term}（{target_lang}）
请从准确性、一致性、语义差异、语境适用性评分（1-5）...`;
```

---

## Project-Specific Conventions

1. **Async IPC Handlers:** Always use `ipcMain.handle()` (not `on`) for request-response patterns. Use async/await to handle Promise-based operations.

2. **DAO Pattern:** Database operations encapsulated in functions like `getTerms()`, `addTerm()`, `updateTerm()`. Always return structured data objects.

3. **Pagination:** Term queries support `{ page, pageSize, domain, keyword }` parameters. Implement virtual scrolling for large datasets (>10k terms).

4. **Component Structure:**
   - Pages (full-page views) in `src/renderer/pages/`
   - Reusable components (modals, forms) in `src/renderer/components/`
   - Ant Design Table for term lists with columns: term_text, target_text, domain, source_type, actions

5. **Error Handling:** Wrap IPC calls in try-catch. Return structured errors: `{ success: false, error: string, errorCode: string }`

6. **Build Configuration:** Uses `electron-vite` (ESM-first). TypeScript strict mode enabled. React Fast Refresh for HMR.

---

## Key Files to Reference

- **Entry:** `src/main/index.ts` (main process), `src/renderer/index.tsx` (React)
- **Database:** `src/main/database.ts` (schema + CRUD)
- **Term Engine:** `src/main/term-engine/` (extraction pipeline)
- **UI:** `src/renderer/pages/TermManager.tsx` (main UI)
- **IPC:** `src/main/ipc-handlers.ts` (all IPC definitions)
- **AI:** `src/main/ai-client.ts` (DeepSeek integration)

---

## Build & Deployment

### Development Workflow

```bash
# Install dependencies
npm install

# Start dev server (HMR enabled via electron-vite)
npm run dev

# The app runs with React Fast Refresh and Electron reload
# Main process changes require restart; renderer changes auto-refresh
```

### Build for Distribution

```bash
# Build and package for current platform
npm run build        # Compiles main + renderer with electron-vite

# Package as installer (uses electron-builder)
npm run package      # Creates .exe (Windows), .dmg (macOS), .AppImage (Linux)

# Output location: ./out/ or ./dist/ (check electron-builder config in package.json)
```

### Key Build Considerations

1. **Native Module Compilation:**
   - `better-sqlite3` and `nodejieba` are native modules (C++ bindings)
   - After `npm install`, run `npm run rebuild` if native modules don't compile
   - Use `electron-rebuild` tool: `./node_modules/.bin/electron-rebuild -f -w better-sqlite3`

2. **electron-vite Configuration:**
   - Main process: CommonJS entry with `src/main/index.ts`
   - Renderer: ESM with React entry at `src/renderer/index.tsx`
   - Preload script: `src/main/preload.ts` (runs in isolated context)
   - Vite config automatically handles TypeScript compilation and hot reload

3. **Database File Location:**
   - Stored in `app.getPath('userData')` (platform-specific):
     - Windows: `%APPDATA%/TermManager/`
     - macOS: `~/Library/Application Support/TermManager/`
     - Linux: `~/.config/TermManager/`
   - Ensure write permissions; handle gracefully if directory doesn't exist

4. **Testing Before Release:**
   ```bash
   # Run unit tests (if configured)
   npm run test
   
   # Test extracted binary with sample files
   ./out/TermManager.exe   # Windows
   
   # Verify:
   # - Database initializes correctly
   # - IPC communication works (open DevTools: F12)
   # - Term extraction engine processes test files
   # - Consistency checker outputs valid results
   ```

5. **Code Signing & Notarization (Optional, macOS):**
   - For distribution via App Store or trusted channels
   - Configure in `electron-builder` with `"certificateFile"` and `"certificatePassword"`
   - Add notarization hook if targeting macOS Catalina+

---

## Development Quick Tips

- **Generate SQL:** Describe the query in a comment, Copilot will generate `better-sqlite3` code with proper parameterization.
- **React Components:** Use Ant Design Table/Form/Modal for consistency. Props should follow Ant Design patterns.
- **Term Extraction Prompt:** Ask Copilot to "implement candidate generation filtering by min_length > 2 and freq >= 2, using nodejieba output".
- **Performance:** For extraction jobs processing >10k candidates, delegate to Worker thread to avoid UI freeze.
- **Debug IPC:** Use DevTools (F12 in dev mode) to inspect IPC messages and check Network tab for API calls.

