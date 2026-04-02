# Unified Frontend Parsing & Serialization: Load + Save

## Context

The frontend/backend separation should follow a clean principle: **the backend is a file I/O layer** (read/write raw files), and the **frontend owns all parsing and serialization**. This makes the frontend code identical for Electron and web, and eliminates double-parsing.

Currently:
- **Load**: Backend reads files, parses POUs, converts to IPC format → adapter converts to flat format → frontend re-parses variables for type reclassification (double-parsing)
- **Save**: Frontend sends structured objects → adapter converts to IPC format → backend re-serializes POUs to text (double-serialization)
- **3 duplicate `executeSave` functions** exist across components

### Shared Utilities (already exist, will be reused)
- `src/frontend/utils/PLC/pou-text-parser.ts` — parsers for all POU languages (already used by backend via `@root/`)
- `src/frontend/utils/PLC/pou-text-serializer.ts` — serializers for all POU languages (already used by backend via `@root/`)
- `src/frontend/utils/PLC/pou-file-extensions.ts` — extension/folder/keyword mappings
- `src/frontend/utils/save-project.ts` — `sanitizePou`, `prepareSavePayload`, `collectDebugVariables`
- `src/frontend/utils/generate-iec-variables-to-string.ts` — variable serialization
- `src/frontend/utils/generate-iec-string-to-variables.ts` — variable parsing with project context

---

## Phase 0: Eliminate executeSave Duplication

### Step 0.1: Create `src/frontend/utils/save-actions.ts`
Shared `executeSaveProject(projectPort)` function that reads state, prepares payload, calls port, updates state. Replaces 3 inline copies.

### Step 0.2: Export `sanitizePou` from `save-project.ts`
Change from private to exported. Needed by single-file save.

### Step 0.3: Replace 3 executeSave duplicates
- `accelerator-handler.tsx`, `file.tsx` (menu), `default.tsx` (activity bar)

### Step 0.4: Replace save logic in 2 modals
- `save-changes-modal.tsx`, `save-changes-file-modal.tsx`

---

## Phase 1: Single-File Save with Frontend Serialization

### Step 1.1: Fix backend saveFile for raw strings
**File:** `src/backend/editor/services/project-service/index.ts`

Add `typeof content === 'string'` branch — write string directly without `JSON.stringify`.

### Step 1.2: Add `executeSaveActiveFile` to `save-actions.ts`
For POUs: `sanitizePou()` → `serializePouToText()` → compute path → `projectPort.saveFile(path, text)`.
For device/data-type/resource/server: appropriate JSON serialization → `projectPort.saveFile()`.
Also updates `project.json` for debug variables.

### Step 1.3: Wire Ctrl+S to `executeSaveActiveFile`
- Ctrl+S → `executeSaveActiveFile(projectPort)` (single file)
- Ctrl+Shift+S → `executeSaveProject(projectPort)` (full project)
- File menu: separate "Save" and "Save Project" items

---

## Phase 2: Load with Frontend Parsing

### Current load flow (to be simplified):
```
Backend: read disk → parse POUs → IPC format → Adapter: convert to flat → Frontend: re-parse variables
```

### Target load flow:
```
Backend: read disk → raw file contents → Adapter: pass through → Frontend: parse everything once
```

### Step 2.1: Add `readProjectFiles` to ProjectPort interface
**File:** `src/middleware/shared/ports/project-port.ts`

New port method that returns raw file contents as strings.

### Step 2.2: Implement Electron adapter for `readProjectFiles`
New IPC call that reads all project files and returns raw strings without parsing.

### Step 2.3: Create frontend project parser utility
**File:** `src/frontend/utils/parse-project-files.ts`

Pure function that takes raw file contents and produces `OpenProjectResponseData`:
1. Parse `projectJson` string
2. For each POU file: detect language/type from path, call appropriate parser
3. Parse variables with full project context (single pass)
4. Parse device config and pin mapping
5. Return data ready for `handleOpenProjectResponse`

### Step 2.4: Update `openProject`/`openProjectByPath` flow
Adapter calls `readProjectFiles` + `parseProjectFiles` internally. Port contract stays the same.

### Step 2.5: Backend simplification
Add raw file read IPC handler. Existing `openProject` remains for backward compatibility.

---

## Phase 3: Full Project Save with Frontend Serialization (future PR)

Migrate `executeSaveProject` to serialize all files on the frontend before sending to the backend.

---

## Architecture After All Phases

```
LOAD:
  Backend: fs.readFile → raw strings → IPC → Adapter: parseProjectFiles() → ProjectResponse → Store

SAVE (single file):
  Frontend: serializePouToText() → text string → projectPort.saveFile(path, text) → Backend: fs.writeFile

SAVE (full project):
  Frontend: serialize all files → projectPort.saveFiles([{path, content}]) → Backend: fs.writeFile each
```

Frontend owns: parsing, serialization, type classification, variable reclassification
Backend owns: file I/O, directory management, file watching, IPC transport
