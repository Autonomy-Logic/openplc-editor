# Migration State

Tracks progress of the shared UI migration. Updated by the `/migrate` skill after each step.

## Current Phase

integration

## Current Step

31

## Step Log

| Step | Phase | Description | Status | Date |
|------|-------|-------------|--------|------|
| 0 | planning | Migration tracker, port interfaces, PlatformProvider scaffolding | done | 2026-03-10 |
| 1 | architecture | Define clean architecture layers and create validation tests | done | 2026-03-10 |
| 2 | domain | Migrate shared domain types and pure utilities | done | 2026-03-10 |
| 3 | adapters | ThemePort adapter implementation | done | 2026-03-10 |
| 4 | adapters | SystemPort adapter implementation | done | 2026-03-10 |
| 5 | adapters | WindowPort adapter implementation | done | 2026-03-10 |
| 6 | adapters | AcceleratorPort adapter implementation | done | 2026-03-10 |
| 7 | adapters | DevicePort adapter implementation | done | 2026-03-10 |
| 8 | adapters | ProjectPort adapter implementation | done | 2026-03-10 |
| 9 | adapters | CompilerPort adapter implementation | done | 2026-03-10 |
| 10 | adapters | RuntimePort adapter implementation | done | 2026-03-10 |
| 11 | adapters | DebuggerPort adapter implementation | done | 2026-03-10 |
| 12 | adapters | SimulatorPort adapter implementation | done | 2026-03-10 |
| 13 | store | UI state slices (Workspace, Editor, Tabs, Modal, Search) | done | 2026-03-10 |
| 14 | store | Data state slices (Project, File, Library, Console, Shared) | done | 2026-03-10 |
| 15 | store | Visual editor slices (FBDFlow, LadderFlow) | done | 2026-03-11 |
| 16 | store | Platform state slices (Device, History, web-only) | done | 2026-03-11 |
| 17 | resources | Copy shared resources (styles, assets, locales, declarations) to src2/ | done | 2026-03-11 |
| 18 | components | Atoms batch 1 — shared identical components (revised: 23 kept, 17 divergent moved to step 22) | done | 2026-03-11 |
| 19 | architecture-rework | Restructure src2/ into frontend/middleware/backend three-layer architecture | done | 2026-03-11 |
| 20 | architecture-rework | Extract application logic from Zustand stores into backend/shared/ | done | 2026-03-11 |
| 21 | architecture-rework | Update comparison script to validate all byte-identical surfaces | done | 2026-03-11 |
| 22 | components | Atoms batch 2a — simple divergent atoms, generic-table-inputs, UI scroll-area | done | 2026-03-11 |
| 22b | components | Atoms batch 2b — graphical editor divergent atoms + platform-specific atoms | done | 2026-03-11 |
| 23 | components | Molecules batch 1 — shared identical (10 modules migrated, divergent deferred to step 24) | done | 2026-03-11 |
| 24 | components | Molecules batch 2a — divergent non-graphical-editor molecules | done | 2026-03-12 |
| 24b | components | Molecules batch 2b — graphical-editor divergent molecules (fbd/ladder utils, fbd-utils, rung, index) | done | 2026-03-12 |
| 25 | components | Organisms — shared (15 files: console, explorer, global-variables-editor, graphical-editor/ladder, navigation, panel, plc-logs, variables-code-editor, workspace-activity-bar) | done | 2026-03-12 |
| 26 | components | Organisms — platform-specific (port-dependent) | done | 2026-03-12 |
| 27 | components | Features — shared (45 files: toast, menu, new-project store/interval-model/first-step, graphical editor routing/SFC, device configuration + pin-mapping-table, monaco completion/configs/languages/themes/drag-and-drop, server barrel + opcua-server, create-element data-type-element, arrow-button-group, fbd/ladder block library, ladder coil/contact) | done | 2026-03-12 |
| 28 | components | Features — platform-specific (97 files: divergent reconciliation of search, create-element, device/board, monaco editor, data-type editor; web-only AI chat, debug-manager, loading-overlay, orchestrators, device elements; editor-only device-aware gating; new utils device.ts, formatters/POU.ts, data sources data-type.tsx) | done | 2026-03-13 |
| 29 | components | Templates, screens, and shared hooks | done | 2026-03-13 |
| 30 | components | Hooks migration — debug/AI/WebRTC hooks, services, utilities, simulator facade, architecture validator updates (637 byte-identical files) | done | 2026-03-13 |
| 31 | integration | App shell and routing — editor store-based routing, web TanStack Router with project loading | done | 2026-03-13 |
| 32 | integration | Production build configs | pending | |
| 33 | integration | Switchover and cleanup — remove src/ | pending | |
