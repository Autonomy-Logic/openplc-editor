# Shared UI Migration Tracker

Base branches: `refactor/shared-ui-migration` on both repos
- Editor: `4a9f4001` (from `origin/development`)
- Web: `5130d60` (from `origin/development`)

Legend:
- **S** = Shared (identical or <5% diff, pure UI)
- **D** = Divergent (>5% diff, needs reconciliation)
- **E** = Editor only
- **W** = Web only
- **P** = Platform-specific (needs port interface)
- Status: `[ ]` pending, `[~]` in progress, `[x]` migrated

---

## 1. ATOMS (`_atoms/`)

### Identical (copy as-is)
| # | Component | Status |
|---|-----------|--------|
| 1 | `accordion/index.tsx` | [x] S |
| 2 | `buttons/index.ts` | [x] S |
| 3 | `buttons/default/index.tsx` | [x] S |
| 4 | `buttons/window-control/index.tsx` | [x] S |
| 5 | `card/index.tsx` | [x] S |
| 6 | `dimensions-modal/array-dimensions-input/index.tsx` | [x] S |
| 7 | `graphical-editor/fbd/svg/connector-svg.tsx` | [x] S |
| 8 | `graphical-editor/fbd/svg/continuation-svg.tsx` | [x] S |
| 9 | `graphical-editor/fbd/svg/index.ts` | [x] S |
| 10 | `input/index.tsx` | [x] S |
| 11 | `label/index.tsx` | [x] S |
| 12 | `tab-list/index.tsx` | [x] S |
| 13 | `tooltip/index.tsx` | [x] S |
| 14 | `workspace-activity-bar/divider.tsx` | [x] S |

### Near-identical (<5% diff, import paths and cosmetic only)
| # | Component | Status |
|---|-----------|--------|
| 15 | `buttons/activity-bar/index.tsx` | [x] S |
| 16 | `buttons/console/clear-console.tsx` | [x] S |
| 17 | `buttons/tables-actions/index.tsx` | [x] S |
| 18 | `file/index.tsx` | [x] S |
| 19 | `generic-table/index.tsx` | [x] S |
| 20 | `graphical-editor/fbd/handle.tsx` | [x] S |
| 21 | `react-flow/index.tsx` | [x] S |
| 22 | `table/index.tsx` | [x] S |
| 23 | `type-dropdown-selector/index.tsx` | [x] S |

### Divergent (needs reconciliation)
| # | Component | Diff | Status | Notes |
|---|-----------|------|--------|-------|
| 24 | `checkbox/index.tsx` | 456B | [x] D | Reconciled: web superset (label, disabled, checked border) |
| 25 | `debug-tree-node/index.tsx` | 14 | [x] D | Reconciled: unified imports |
| 26 | `dimensions-modal/index.tsx` | 28 | [x] D | Reconciled: unified imports, PLCBaseType |
| 27 | `generic-data-type-table/index.tsx` | 258B | [x] D | Reconciled: web scroll wrapper |
| 28 | `generic-table-inputs/*` | varies | [x] D | Reconciled: editor superset (5 files), search via extractSearchQuery |
| 29 | `graphical-editor/autocomplete/index.tsx` | 63 | [ ] D | Reclassified: editor has triggerSubmit imperative handle |
| 30 | `graphical-editor/fbd/autocomplete/index.tsx` | 43 | [ ] D | Reclassified: different ID gen, error handling |
| 31 | `graphical-editor/fbd/block.tsx` | 7.4KB | [ ] D | Editor much larger |
| 32 | `graphical-editor/fbd/comment.tsx` | 1.4KB | [ ] D | |
| 33 | `graphical-editor/fbd/connection.tsx` | 2KB | [ ] D | |
| 34 | `graphical-editor/fbd/index.ts` | 14 | [ ] D | Reclassified: web uses buildNodes module |
| 35 | `graphical-editor/fbd/utils/index.ts` | - | [ ] D | Barrel for types.ts + utils.ts |
| 36 | `graphical-editor/fbd/utils/types.ts` | 1.2KB | [ ] D | Web much larger |
| 37 | `graphical-editor/fbd/utils/utils.ts` | 3.6KB | [ ] D | Web much larger |
| 38 | `graphical-editor/fbd/variable.tsx` | 2.9KB | [ ] D | |
| 39 | `graphical-editor/ladder/autocomplete/index.tsx` | 44 | [ ] D | Reclassified: different ID gen, error handling |
| 40 | `graphical-editor/ladder/block.tsx` | 10.6KB | [ ] D | Editor much larger |
| 41 | `graphical-editor/ladder/coil.tsx` | 5KB | [ ] D | |
| 42 | `graphical-editor/ladder/contact.tsx` | 4.3KB | [ ] D | |
| 43 | `graphical-editor/ladder/handle.tsx` | 16 | [ ] D | Reclassified: editor has extra props |
| 44 | `graphical-editor/ladder/index.ts` | 152 | [ ] D | Reclassified: web uses constants/buildNodes modules |
| 45 | `graphical-editor/ladder/mock-node.tsx` | 2.9KB | [ ] D | Editor much larger |
| 46 | `graphical-editor/ladder/parallel.tsx` | 3.8KB | [ ] D | Editor much larger |
| 47 | `graphical-editor/ladder/placeholder.tsx` | 2.4KB | [ ] D | Editor much larger |
| 48 | `graphical-editor/ladder/power-rail.tsx` | 2.6KB | [ ] D | Editor much larger |
| 49 | `graphical-editor/ladder/utils/index.ts` | - | [ ] D | Barrel for types.ts + utils.ts |
| 50 | `graphical-editor/ladder/utils/types.ts` | 3.4KB | [ ] D | Web much larger |
| 51 | `graphical-editor/ladder/utils/utils.ts` | 8KB | [ ] D | Web much larger |
| 52 | `graphical-editor/ladder/variable.tsx` | 2.6KB | [ ] D | |
| 53 | `graphical-editor/types/block.ts` | 9 | [ ] D | Reclassified: depends on divergent Zod schemas |
| 54 | `graphical-editor/utils/index.ts` | 14 | [ ] D | Reclassified: different type/import sources |
| 55 | `highlighted-textarea/index.tsx` | 19 | [x] D | Reconciled: web approach (extractSearchQuery, no HighlightedText dep) |
| 56 | `react-flow/style.css` | 24 | [x] D | Reconciled: web class-based dark mode |
| 57 | `select/index.tsx` | 405B | [x] D | Reconciled: editor superset (forwardRef, viewportRef) |
| 58 | `tab/index.tsx` | 74 | [x] D | Reconciled: merged web icons + editor safe rendering |
| 59 | `table-actions/index.tsx` | 14 | [x] D | Reconciled: editor superset (className prop) |

### Platform-specific
| # | Component | Repo | Status | Notes |
|---|-----------|------|--------|-------|
| 60 | `highlighted-text/index.tsx` | E | [ ] E | Editor only |
| 61 | `graphical-editor/debug-value-badge.tsx` | E | [ ] E | Editor only |
| 62 | `graphical-editor/block-output-debug-badges.tsx` | E | [ ] E | Editor only |
| 63 | `resolution-warning-message/index.tsx` | W | [ ] W | Web only |
| 64 | `react-flow/custom-nodes/coil.tsx` | W | [ ] W | Web only |
| 65 | `react-flow/custom-nodes/contact.tsx` | W | [ ] W | Web only |
| 66 | `graphical-editor/fbd/buildNodes.tsx` | W | [ ] W | Web only |
| 67 | `graphical-editor/ladder/buildNodes.tsx` | W | [ ] W | Web only |
| 68 | `graphical-editor/fbd/utils/constants.tsx` | W | [ ] W | Web only |
| 69 | `graphical-editor/ladder/utils/constants.tsx` | W | [ ] W | Web only |

---

## 2. MOLECULES (`_molecules/`)

### Identical / near-identical
| # | Component | Status |
|---|-----------|--------|
| 70 | `file/*` (4 files) | [x] S |
| 71 | `pin-mapping-table/*` (4 files) | [x] S |
| 72 | `select-field/index.tsx` | [x] S |
| 73 | `input-field/index.tsx` | [x] S |
| 74 | `toast/index.tsx` | [x] S |
| 75 | `window-controls/index.tsx` | [ ] E | Reclassified: editor-only (uses window.bridge) |
| 76 | `menu-bar/index.tsx` | [x] D | Reconciled step 24: shell + stub menus |
| 77 | `modal/index.tsx` | [x] S |
| 78 | `rename-impact-modal/index.tsx` | [x] S |
| 79 | `type-change-modal/index.tsx` | [x] D | Reconciled step 24: validation extracted to backend/shared |
| 80 | `breadcrumbs/index.tsx` | [x] S |
| 81 | `search/index.tsx` | [x] S |
| 82 | `variables-panel/index.tsx` | [x] D | Reconciled step 24 |
| 83 | `data-types/array/* (header + table)` | [x] D | Reconciled step 24 |
| 84 | `data-types/enumerated/*` | [x] D | Reconciled step 24 |
| 85 | `data-types/structure/* (table + elements)` | [x] D | Reconciled step 24 |
| 86 | `graphical-editor/fbd/fbd-utils/*` | [ ] D | Reclassified: useCopyPaste.ts divergent |
| 87 | `graphical-editor/fbd/index.tsx` | [ ] D | Reclassified: heavily divergent (ID gen, node sync, delete logic) |
| 88 | `graphical-editor/ladder/rung/index.tsx` | [ ] D | Reclassified: rung children divergent |
| 89 | `graphical-editor/ladder/index.tsx` | [ ] D | Reclassified: depends on divergent children |
| 90 | `graphical-editor/ladder/* utils` | [ ] D | Reclassified: ID generation differs (newGraphicalEditorNodeID vs uuidv4) |
| 91 | `instances-table/*` | [x] D | Reconciled step 24 |
| 92 | `library-tree/index.tsx` | [x] S |
| 93 | `task-table/*` | [x] D | Reconciled step 24 |
| 94 | `global-variables-table/elements/*` | [x] D | Reconciled step 24 |
| 95 | `variables-table/elements/*` | [x] D | Reconciled step 24 |

### Divergent
| # | Component | Diff | Status | Notes |
|---|-----------|------|--------|-------|
| 96 | `charts/line-chart.tsx` | 50% | [x] D | Reconciled step 24 |
| 97 | `global-variables-table/editable-cell.tsx` | 21% | [x] D | Reconciled step 24 |
| 98 | `global-variables-table/selectable-cell.tsx` | 30% | [x] D | Reconciled step 24 |
| 99 | `variables-table/editable-cell.tsx` | 48% | [x] D | Reconciled step 24 |
| 100 | `tabs/index.tsx` | 23% | [x] D | Reconciled step 24 |
| 101 | `graphical-editor/ladder/rung/body.tsx` | 13% | [ ] D | Deferred to step 24b |
| 102 | `workspace-activity-bar/download.tsx` | 47% | [x] D | Reconciled step 24 |

### Platform-specific (menus)
| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 103 | `menu-bar/menus/display.tsx` | [ ] P | 25% diff, platform behavior |
| 104 | `menu-bar/menus/file.tsx` | [ ] P | 23% diff, Electron file ops vs web |
| 105 | `menu-bar/menus/recent.tsx` | [ ] P | 78% diff, Electron recent files |
| 106 | `project-tree/utils/index.ts` | [ ] W | Web only (extracted util) |
| 107 | `workspace-activity-bar/default/chat.tsx` | [ ] W | Web only (AI chat button) |

---

## 3. ORGANISMS (`_organisms/`)

### Identical / near-identical
| # | Component | Status |
|---|-----------|--------|
| 107 | `console/* (3 files)` | [x] S |
| 108 | `explorer/index.tsx` | [x] S |
| 109 | `explorer/info.tsx` | [x] S |
| 110 | `global-variables-editor/index.tsx` | [x] S |
| 111 | `graphical-editor/ladder/index.ts` | [x] S |
| 112 | `graphical-editor/ladder/rung/index.tsx` | [x] S |
| 113 | `navigation/index.tsx` | [x] S |
| 114 | `panel/index.tsx` | [x] S |
| 115 | `plc-logs/* (2 files)` | [x] S |
| 116 | `variables-code-editor/index.tsx` | [x] S |
| 117 | `workspace-activity-bar/fbd-toolbox.tsx` | [x] S |
| 118 | `workspace-activity-bar/index.tsx` | [x] S |

### Divergent
| # | Component | Diff | Status | Notes |
|---|-----------|------|--------|-------|
| 119 | `debugger/index.tsx` | 400B | [ ] D | Web slightly larger |
| 120 | `explorer/library.tsx` | 400B | [ ] D | Web slightly larger |
| 121 | `explorer/project.tsx` | 1.3KB | [ ] D | Editor larger |
| 122 | `instances-editor/index.tsx` | 1KB | [ ] D | Editor larger |
| 123 | `task-editor/index.tsx` | 1KB | [ ] D | Editor larger |
| 124 | `variables-editor/index.tsx` | 11KB | [ ] D | Editor 27% larger |
| 125 | `workspace-activity-bar/default.tsx` | 3KB | [ ] P | Business logic mixed in |
| 126 | `workspace-activity-bar/ladder-toolbox.tsx` | 2.4KB | [ ] D | Web 68% larger |
| 127 | `title-bar/index.tsx` | 112B | [ ] D | |
| 128 | `title-bar/slots/*` | N/A | [ ] P | Completely different structure |

### Platform-specific modals
| # | Component | Repo | Status | Notes |
|---|-----------|------|--------|-------|
| 129 | `modals/debugger-message-modal.tsx` | Both | [ ] S | |
| 130 | `modals/delete-confirmation-modal.tsx` | Both | [ ] D | Editor 1.3KB larger |
| 131 | `modals/runtime-connection-lost-modal.tsx` | Both | [ ] S | |
| 132 | `modals/runtime-create-user-modal.tsx` | Both | [ ] D | Web 1.3KB larger |
| 133 | `modals/runtime-login-modal.tsx` | Both | [ ] P | Direct IPC/API calls |
| 134 | `modals/save-changes-file-modal.tsx` | Both | [ ] S | |
| 135 | `modals/save-changes-modal.tsx` | Both | [ ] D | Editor 1.4KB larger |
| 136 | `modals/confirm-device-switch-modal.tsx` | E | [ ] E | |
| 137 | `modals/debugger-ip-input-modal.tsx` | E | [ ] E | |
| 138 | `modals/quit-application-modal.tsx` | E | [ ] E | Electron only |
| 139 | `modals/server-ip-mismatch-modal.tsx` | W | [ ] W | |
| 140 | `about-modal/index.tsx` | E | [ ] E | |
| 141 | `display-recent-projects/index.tsx` | E | [ ] E | |
| 142 | `project-filter-bar/index.tsx` | E | [ ] E | |
| 143 | `pin-mapping-editor/index.tsx` | W | [ ] W | |

---

## 4. FEATURES (`_features/`)

### [app]
| # | Component | Repo | Status | Notes |
|---|-----------|------|--------|-------|
| 144 | `toast/*` (3 files) | Both | [ ] S | Near-identical |
| 145 | `debug-manager/index.tsx` | W | [ ] W | 16KB, simulator/debugger UI |
| 146 | `loading-overlay/index.tsx` | W | [ ] W | |

### [start]
| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 147 | `menu/index.tsx` | [ ] S | Identical |
| 148 | `new-project/interval-model.tsx` | [ ] S | |
| 149 | `new-project/project-modal.tsx` | [ ] S | |
| 150 | `new-project/steps/first-step.tsx` | [ ] S | |
| 151 | `new-project/steps/second-step.tsx` | [ ] D | Different implementations |
| 152 | `new-project/steps/third-step.tsx` | [ ] D | Different implementations |
| 153 | `new-project/store/index.ts` | [ ] S | |

### [workspace]/editor
| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 154 | `editor/device/index.tsx` | [ ] S | |
| 155 | `editor/device/configuration/index.tsx` | [ ] S | |
| 156 | `editor/device/configuration/communication.tsx` | [ ] S | |
| 157 | `editor/device/configuration/board.tsx` | [ ] D | Editor 702 lines vs Web 294 lines |
| 158 | `editor/device/configuration/components/*` | [ ] S | modbus-rtu, modbus-tcp, pin-mapping, static-host |
| 159 | `editor/device/remote-device/index.tsx` | [ ] S | ~45KB both |
| 160 | `editor/device/orchestrators/*` | W | [ ] W | Web only (32KB orchestrator list) |
| 161 | `editor/device/components/*` | W | [ ] W | Web only (extracted components) |
| 162 | `editor/device/elements/*` | W | [ ] W | Web only (board-config, tcp-settings, rtu-settings) |
| 163 | `editor/graphical/index.tsx` | [ ] S | |
| 164 | `editor/graphical/FBD/index.tsx` | [ ] S | |
| 165 | `editor/graphical/SFC/index.tsx` | [ ] S | |
| 166 | `editor/graphical/elements/*` | [ ] S | Block, coil, contact, arrow-button-group |
| 167 | `editor/graphical/ladder/index.tsx` | E | [ ] E | 12KB monolithic (web refactored out) |
| 168 | `editor/monaco/index.tsx` | [ ] D | Editor 1167 lines vs Web 823 lines |
| 169 | `editor/monaco/completion/*` | [ ] S | All completion files identical |
| 170 | `editor/monaco/configs/*` | [ ] S | All language/theme configs identical |
| 171 | `editor/monaco/drag-and-drop/*` | [ ] S | |
| 172 | `editor/monaco/python-lsp/*` | [ ] S | |
| 173 | `editor/monaco/theme-utils.ts` | W | [ ] W | Web only |
| 174 | `editor/resource-editor/index.tsx` | [ ] S | |
| 175 | `editor/search-in-project/index.tsx` | [ ] S | |
| 176 | `editor/server/index.ts` | [ ] S | |
| 177 | `editor/server/modbus-server/index.tsx` | [ ] S | |
| 178 | `editor/server/opcua-server/*` | [ ] S | All identical |
| 179 | `editor/server/s7comm-server/index.tsx` | [ ] S | |
| 180 | `editor/server/modbus-server/address-mapping-reference.tsx` | W | [ ] W | Web only |
| 181 | `editor/data-type/index.tsx` | [ ] D | Web 180% larger |
| 182 | `create-element/*` | [ ] S | |
| 183 | `create-element/hooks/use-name-validation.ts` | W | [ ] W | Web only |
| 184 | `search/*` | [ ] S | |
| 185 | `ai-chat/*` (5 files) | W | [ ] W | AI chat panel, input, messages, code block (web only) |
| 186 | `editor/monaco/ai-completion/*` (3 files) | W | [ ] W | AI inline completion provider, context builder |
| 187 | `editor/monaco/ai-consent-modal.tsx` | W | [ ] W | AI consent dialog |
| 188 | `editor/monaco/ai-status-indicator.tsx` | W | [ ] W | AI status indicator |

---

## 5. TEMPLATES (`_templates/`)

| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 185 | `[start]/index.ts` | [ ] S | |
| 186 | `[start]/main-content.tsx` | [ ] S | |
| 187 | `[start]/side-content.tsx` | [ ] S | |
| 188 | `[workspace]/index.ts` | [ ] S | |
| 189 | `[workspace]/side-content.tsx` | [ ] S | |
| 190 | `[workspace]/main-content.tsx` | [ ] D | Web 29% smaller |
| 191 | `[editors]/index.ts` | [ ] S | |
| 192 | `[editors]/device-editor-slot.tsx` | [ ] S | |
| 193 | `[editors]/device-editor-template.tsx` | [ ] S | |
| 194 | `app-layout.tsx` | [ ] D | Minor styling diff |
| 195 | `accelerator-handler.tsx` | E | [ ] E | Electron keyboard shortcuts |

---

## 6. SCREENS / PAGES

| # | Component | Repo | Status | Notes |
|---|-----------|------|--------|-------|
| 196 | `workspace-screen.tsx` | Both | [ ] P | Editor 2072 lines vs Web 604 lines. Heaviest business logic. |
| 197 | `start-screen.tsx` | E | [ ] E | |
| 198 | `welcome-page.tsx` | W | [ ] W | |
| 199 | `unauthorized-page.tsx` | W | [ ] W | Web auth page |

---

## 7. HOOKS

### Shared
| # | Hook | Status | Notes |
|---|------|--------|-------|
| 200 | `use-debug-composite-key.ts` | [ ] S | Identical |
| 201 | `use-remove-tab.tsx` | [ ] S | Near-identical |
| 202 | `use-store-selectors.ts` | [ ] D | Editor 258 lines vs Web 119 lines |

### Platform-specific
| # | Hook | Repo | Status | Notes |
|---|------|------|--------|-------|
| 203 | `use-compiler.ts` | E | [ ] P | Calls `window.bridge.exportProjectXml()` |
| 204 | `use-quit-app.tsx` | E | [ ] E | Electron only |
| 205 | `use-runtime-polling.ts` | E | [ ] P | Calls `window.bridge.*` |
| 206 | `useDebugPolling.ts` | W | [ ] P | Calls web debug bridge |
| 207 | `useDebugSession.ts` | W | [ ] P | Debug session lifecycle |
| 208 | `useDebuggerLauncher.ts` | W | [ ] P | 790 lines, compiler pipeline |
| 209 | `useRuntimePolling.ts` | W | [ ] P | Calls web APIs |
| 210 | `useSaveShortcut.ts` | W | [ ] W | |
| 211 | `useUndoRedoShortcut.ts` | W | [ ] W | |
| 212 | `useWebRTCConnection.ts` | W | [ ] W | WebRTC specific |
| 213 | `useAI.ts` | W | [ ] W | AI chat and completion hook |

---

## 8. STORE SLICES

### Shared slices (in both repos)
| # | Slice | Status | Notes |
|---|-------|--------|-------|
| 213 | `console/` | [ ] S | |
| 214 | `editor/` | [ ] S | |
| 215 | `fbd/` | [ ] S | |
| 216 | `files/` | [ ] S | |
| 217 | `ladder/` | [ ] D | Editor 4 files vs Web 3 |
| 218 | `library/` | [ ] S | |
| 219 | `modal/` | [ ] S | |
| 220 | `project/` | [ ] D | Both 8 files, but complex business logic inside |
| 221 | `react-flow/` | [ ] S | |
| 222 | `search/` | [ ] S | |
| 223 | `shared/` | [ ] S | |
| 224 | `tabs/` | [ ] S | |
| 225 | `workspace/` | [ ] D | Both 6 files, may mix platform state |
| 226 | `device/` | [ ] P | Editor 7 files vs Web 5, runtime connection state differs |

### Platform-specific slices
| # | Slice | Repo | Status | Notes |
|---|-------|------|--------|-------|
| 227 | `history/` | E | [ ] E | Undo/redo |
| 228 | `webrtc/` | W | [ ] W | WebRTC state |
| 229 | `ai/` (3 files) | W | [ ] W | AI state (chat messages, completions, consent, telemetry) |

---

## 9. UTILS

### Shared utils
| # | Utility | Status | Notes |
|---|---------|--------|-------|
| 229 | `debug-tree-builder.ts` | [ ] S | |
| 230 | `parse-debug-file.ts` | [ ] S | |
| 231 | `sync-nodes-with-variables.ts` | [ ] S | |
| 232 | `validate-variable-reference.ts` | [ ] S | |
| 233 | `variable-references.ts` | [ ] D | Editor 532 vs Web 562 lines |
| 234 | `variable-sizes.ts` | [ ] D | Editor 217 vs Web 278 lines |
| 235 | `debug-tree-traversal.ts` | [ ] D | Editor 394 vs Web 366 lines |
| 236 | `debug-variable-finder.ts` | [ ] S | |
| 237 | `keywords.ts` | [ ] S | |
| 238 | `pou-helpers.ts` | [ ] S | |
| 239 | `generate-iec-string-to-variables.ts` | [ ] D | Editor 190 vs Web 88 lines |
| 240 | `remote-device-options.ts` | [ ] S | |

### Utils subdirectories
| # | Directory | Status | Notes |
|---|-----------|--------|-------|
| 241 | `PLC/` | [ ] D | Editor 29 files (codesys + old-editor), Web 14 files (consolidated) |
| 242 | `cpp/` (5 files) | [ ] S | Same structure |
| 243 | `python/` (5 files) | [ ] S | Same structure |
| 244 | `modbus/` | [ ] D | Editor 2 files, Web 4 files |
| 245 | `opcua/` | [ ] D | Editor 5 files, Web 4 files |
| 246 | `s7comm/` (2 files) | [ ] S | Same structure |
| 247 | `formatters/` | [ ] D | Editor 3 files, Web 2 files |

### Editor-only utils
| # | Utility | Status | Notes |
|---|---------|--------|-------|
| 248 | `debugger-session.ts` | [ ] P | 294 lines, IPC-coupled |
| 249 | `PLC/pou-text-parser.ts` | [ ] E | 517 lines |
| 250 | `PLC/pou-text-serializer.ts` | [ ] E | 148 lines |
| 251 | `PLC/pou-file-extensions.ts` | [ ] E | 110 lines |
| 252 | `PLC/preprocess-pous.ts` | [ ] E | 182 lines |
| 253 | `PLC/array-codegen-helpers.ts` | [ ] E | 110 lines |
| 254 | `PLC/codesys/*` | [ ] E | Separate XML format |
| 255 | `PLC/old-editor/*` | [ ] E | Separate XML format |

### Web-only utils
| # | Utility | Status | Notes |
|---|---------|--------|-------|
| 256 | `cookies.ts` | [ ] W | |
| 257 | `download-file.ts` | [ ] W | |
| 258 | `hex.ts` | [ ] W | |
| 259 | `library.ts` | [ ] W | |
| 260 | `project-parser.ts` | [ ] W | 601 lines |
| 261 | `project-serializer.ts` | [ ] W | 187 lines |
| 262 | `project-summary.ts` | [ ] W | |
| 263 | `server-ip-validation.ts` | [ ] W | |
| 264 | `theme.ts` | [ ] W | |
| 265 | `graphical/drag-detection.ts` | [ ] W | |
| 266 | `graphical/relink-variables.ts` | [ ] W | |

---

## 10. SHARED MODULES

| # | Module | Repo | Status | Notes |
|---|--------|------|--------|-------|
| 267 | `data/index.ts` | Both | [ ] S | |
| 268 | `data/constants.ts` | Both | [ ] S | |
| 269 | `data/common.ts` | Both | [ ] S | |
| 270 | `contracts/types/*` | E | [ ] E | pou.ts, xml-project.ts |
| 271 | `contracts/validations/*` | E | [ ] E | pou-validation.ts, project-validation.ts |
| 272 | `data/mock/*` | E | [ ] E | Test data |

---

## 11. SERVICES (Web only)

| # | Service | Status | Notes |
|---|---------|--------|-------|
| 273 | `api/axios.ts` | [ ] W | HTTP client config |
| 274 | `api/compiler-api.ts` | [ ] W | Compiler endpoints |
| 275 | `api/debug-transport.ts` | [ ] W | Debug protocol |
| 276 | `api/project-api.ts` | [ ] W | Project CRUD |
| 277 | `api/runtime-api.ts` | [ ] W | Runtime communication |
| 278 | `api/webrtc/*` (5 files) | [ ] W | WebRTC signaling/connection |
| 279 | `debug/debug-bridge.ts` | [ ] W | Debug protocol adapter |
| 280 | `debug/types.ts` | [ ] W | |
| 281 | `debug/transports/*` (2 files) | [ ] W | Modbus RTU + WebRTC transports |
| 282 | `simulator/*` (6 files) | [ ] W | In-browser AVR simulator |
| 283 | `debug-session-controls.ts` | [ ] W | Session lifecycle |
| 284 | `ai/*` (6 files) | W | [ ] W | AI api-client, completion-cache, context-collector, telemetry, types |

---

## 12. IPC BRIDGE (Editor only — to be replaced by port interfaces)

The editor's `window.bridge.*` with 350+ methods is the main coupling point.
These will be replaced by port interfaces that both repos implement differently.

### Port interfaces needed (derived from IPC categories)
| # | Port | Methods | Status |
|---|------|---------|--------|
| P1 | `CompilerPort` | compileProject, exportXml, getCompilationStatus | [ ] |
| P2 | `RuntimePort` | login, getStatus, startPlc, stopPlc, getLogs, getSerialPorts, createUser | [ ] |
| P3 | `DebuggerPort` | connect, disconnect, getVariablesList, setVariable, verifyMd5 | [ ] |
| P4 | `SimulatorPort` | loadFirmware, stop, isRunning, onStopped | [ ] |
| P5 | `ProjectPort` | openProject, saveProject, createPou, deletePou, renamePou, pickPath | [ ] |
| P6 | `DevicePort` | getAvailableBoards, getCommunicationPorts, getPreviewImage | [ ] |
| P7 | `SystemPort` | getSystemInfo, setStoreValue, getStoreValue, retrieveRecent | [ ] |
| P8 | `WindowPort` | minimize, maximize, close, hide, reload, quit | [ ] |
| P9 | `AcceleratorPort` | onSaveProject, onOpenProject, onUndo, onRedo, ... | [ ] |
| P10 | `ThemePort` | getCurrentTheme, setTheme, onThemeChanged | [ ] |

---

## STATISTICS SUMMARY

| Category | Total Items | Shared (S) | Divergent (D) | Editor Only (E) | Web Only (W) | Platform (P) |
|----------|-------------|------------|---------------|------------------|--------------|--------------|
| Atoms | 69 | 37 | 22 | 3 | 7 | 0 |
| Molecules | 38 | 26 | 7 | 0 | 2 | 3 |
| Organisms | 37 | 12 | 10 | 5 | 1 | 9 |
| Features | 45 | 22 | 5 | 1 | 13 | 4 |
| Templates | 11 | 8 | 2 | 1 | 0 | 0 |
| Screens | 4 | 0 | 0 | 1 | 2 | 1 |
| Hooks | 14 | 2 | 1 | 2 | 4 | 5 |
| Store | 17 | 10 | 3 | 1 | 2 | 1 |
| Utils | 38 | 10 | 8 | 8 | 11 | 1 |
| Shared | 6 | 3 | 0 | 3 | 0 | 0 |
| Services | 12 | 0 | 0 | 0 | 12 | 0 |
| **TOTAL** | **291** | **130** | **58** | **25** | **54** | **24** |
