# Migration State

Tracks progress of the shared UI migration. Updated by the `/migrate` skill after each step.

## Current Phase

domain

## Current Step

2

## Step Log

| Step | Phase | Description | Status | Date |
|------|-------|-------------|--------|------|
| 0 | planning | Migration tracker, port interfaces, PlatformProvider scaffolding | done | 2026-03-10 |
| 1 | architecture | Define clean architecture layers and create validation tests | done | 2026-03-10 |
| 2 | domain | Migrate shared domain types and pure utilities | pending | |
| 3 | adapters | ThemePort adapter implementation | pending | |
| 4 | adapters | SystemPort adapter implementation | pending | |
| 5 | adapters | WindowPort adapter implementation | pending | |
| 6 | adapters | AcceleratorPort adapter implementation | pending | |
| 7 | adapters | DevicePort adapter implementation | pending | |
| 8 | adapters | ProjectPort adapter implementation | pending | |
| 9 | adapters | CompilerPort adapter implementation | pending | |
| 10 | adapters | RuntimePort adapter implementation | pending | |
| 11 | adapters | DebuggerPort adapter implementation | pending | |
| 12 | adapters | SimulatorPort adapter implementation | pending | |
| 13 | store | UI state slices (Workspace, Editor, Tabs, Modal, Search) | pending | |
| 14 | store | Data state slices (Project, File, Library, Console, Shared) | pending | |
| 15 | store | Visual editor slices (FBDFlow, LadderFlow) | pending | |
| 16 | store | Platform state slices (Device, History, web-only) | pending | |
| 17 | components | Atoms batch 1 — shared identical components | pending | |
| 18 | components | Atoms batch 2 — divergent components (reconcile) | pending | |
| 19 | components | Molecules batch 1 — shared identical | pending | |
| 20 | components | Molecules batch 2 — divergent (reconcile) | pending | |
| 21 | components | Organisms — shared | pending | |
| 22 | components | Organisms — platform-specific (port-dependent) | pending | |
| 23 | components | Features — shared | pending | |
| 24 | components | Features — platform-specific | pending | |
| 25 | components | Templates and screens | pending | |
| 26 | components | Hooks migration | pending | |
| 27 | integration | Wire App root, update build config, smoke test | pending | |
