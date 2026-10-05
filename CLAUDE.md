# OpenPLC Editor

OpenPLC Editor is an Electron + React desktop IDE for programming PLCs in the IEC 61131-3 languages (Structured Text, Ladder Diagram, Function Block Diagram, Instruction List) plus Python and C++ extensions.

## Autonomy development rules

These rules are identical in every Autonomy repository and are maintained in the MisterFlow plugin
(`Autonomy-Logic/skills`, `plugins/autonomy/harness/repository-rules.md`). Change them there, not here.

- Tracked work starts with `autonomy:misterflow`: load it yourself before changing product code, fixing a
  bug, implementing or preparing a PR, even when no Jira key was mentioned. Only answering questions and typo or wording fixes that
  change no behaviour are exempt. "There is no ticket" or "skip the process" does not make product
  work untracked: offer to create the task instead of changing code. This file describes only this
  repository's commands, architecture and code conventions; for process, MisterFlow and the Confluence
  process pages win over anything written here.
- Knowledge boundary: when data is missing or uncertain, say there is not enough information to answer
  reliably. Never fill a gap with a plausible assumption. Keep verified facts, inferences and missing
  data visibly separate, and say which is which.
- Language: answer in the developer's language. Jira, Confluence and GitHub text is always English.
- Branches: `feature/<KEY>-<slug>` for demands and `bugfix/<KEY>-<slug>` for bugs, created from the
  integration branch named below. A production hotfix is a `bugfix/<KEY>-<slug>` branch from `main` and
  a PR. Never commit or push directly to the integration branch or `main`. One Jira key per branch: work
  for another key starts on its own branch before any edit. The key goes in the branch name and the PR
  title, never in commit messages, code or comments.
- Commits: never commit on your own initiative. Propose the commit at a natural checkpoint, such as a
  finished and verified plan phase, and make it only after the developer confirms. Commit and push are
  separate commands, each confirmed on its own, never chained; opening a PR and merging each need their
  own confirmation too. When asked for a commit message or a commit, do not edit files you were not
  asked to change: report problems, such as a forbidden comment, and let the developer decide.
- Scope: a rewrite or refactor beyond the current task is a new demand, proposed as a separate task and
  never mixed into the current branch. Never stash, reset, `checkout -- .` or otherwise discard the
  developer's changes, and never install anything outside the repository, without asking.
- Tests: every demand ships with unit tests, an end-to-end test and a manual test by the developer, with
  evidence for each before any PR is opened, a draft PR included. Where this repository has no
  interface of its own, the end-to-end test runs through the interface or protocol that uses it. A
  repository with no code to unit test, such as documentation or local tooling scripts, uses its own
  validation checks in place of unit tests.
- Typing: `any` in TypeScript and `typing.Any` in Python are forbidden. Use concrete types, or `unknown`
  or `object` narrowed where the data enters.
- Comments: technical and minimal, at most 256 characters each; formal API documentation (JSDoc,
  docstrings, Doxygen) may be longer. Never write business rules, product strategy or rationale, Jira
  keys, names of people or customers, internal links or anything sensitive in a comment. Review the
  comments in the changed files before every commit.

Integration branch: `development`. Jira project: `DOPE`.

External contributors without Jira access follow CONTRIBUTING.md; GitHub Issues (`.github/ISSUE_TEMPLATE/`) is how they report bugs.

## Build & Development Commands

**Package manager:** `npm` (not pnpm)

```bash
npm install              # Install deps + download binaries + build DLL cache
npm run dev              # Full dev mode (main + renderer + Electron, port 1313)
npm run build            # Production build (main + renderer)
npm run build:main       # Electron main process only
npm run build:renderer   # React renderer only
npm run build:dll        # Webpack DLL cache for faster dev rebuilds
npm run package          # Build + create distributable (electron-builder)

npm run lint             # ESLint check
npm run lint:fix         # Auto-fix lint issues
npm run format           # Prettier formatting

npm run test             # Jest with coverage (enforced thresholds)
npm run test:watch       # Jest watch mode (no coverage)
npm run test:e2e         # Playwright E2E tests

npm run validate:arch    # Architecture layer dependency validation
```

## Verify before pushing (CI parity)

CI runs these commands directly, not `npm run format`, which rewrites files and
so passes locally while CI's `--check` still fails. Tests run under
**Jest** (not Vitest), and both `tsc` and `jest` import the `strucpp` package,
so it must be installed first or they fail with `TS2307: Cannot find module
'strucpp'`. Run each exact command (from `.github/workflows/`) green before you push:

```bash
npm ci --ignore-scripts && npm run setup:strucpp   # required first, or tsc/jest can't resolve 'strucpp'
npx tsc --noEmit                                   # ci-build:       Build Check
npx prettier --check "./src/**/*.{ts,tsx}"         # ci-format:      Format Check
npx eslint "./src/**/*.{ts,tsx}"                   # ci-lint:        Lint Check
npx jest --config jest.config.json --collectCoverage --ci   # ci-unit-tests
```

`prettier --check` only reports; fix with `npx prettier --write <files>`.

`npm run setup:strucpp` installs the **pinned** STruC++ from its GitHub release
and overwrites whatever is in `node_modules/strucpp`, so a locally patched build
(testing an unreleased parser change) is wiped by the very command CI runs. Jest
loads the parser through `dist/parser-bundle.cjs` — STruC++'s ESM chain does not
survive Jest's CJS transform — so the pinned release has to be one that ships
that bundle, or every suite fails to load. Run the suite again after
`setup:strucpp` rather than trusting a run made against a patched install.
The shared surface (`src/frontend`, `src/middleware/shared`, `src/backend/shared`)
is byte-identical with **openplc-web** — mirror any change and run the check suite
in BOTH repos (web uses **Vitest**, not Jest, so a test can pass here and fail there).

## Electron e2e (Playwright)

No CI workflow runs Playwright, so these are local checks. `e2e/` drives the real
Electron app through `_electron.launch`, and three things bite before any assertion:

```bash
npm run build                                          # main + renderer
mkdir -p release/app/configs/dll
cp release/app/dist/main/preload.js release/app/configs/dll/preload.js
npx playwright test e2e/<spec>.ts --workers=1
```

- **The preload copy is required.** `main.ts` picks the preload with `app.isPackaged`,
  and a suite launching `release/app/dist/main/main.js` directly is NOT packaged, so it
  looks under `release/app/configs/dll/` - a path `npm run build` never writes. Without
  it the window renders blank and the only clue is `Cannot read properties of undefined
  (reading 'onSimulatorStopped')` in the renderer console.
- **Do not set `NODE_ENV=development`.** `resolveHtmlPath` would point the window at the
  webpack dev server on `localhost:1212`, which is not running against a built app.
- **`firstWindow()` returns the splash**, which then closes. Poll `app.windows()` for the
  one whose URL contains `index.html`.

Every open tab keeps its Monaco editor mounted (hidden with `display: none`), so read
body text from `.view-lines:visible`, never `.view-lines` alone.

## Architecture

### Layer Overview

```
src/
├── main/                  # Electron main process (Node.js)
├── frontend/              # React UI layer (renderer process)
│   ├── components/        # Atomic Design: _atoms, _molecules, _organisms, _features, _templates
│   ├── store/             # Zustand store (slices under store/slices/)
│   ├── hooks/             # Custom React hooks
│   ├── services/          # Business logic and side effects
│   ├── utils/             # Domain utilities (PLC, graphical, debug, formatters)
│   ├── data/              # Static data (function libraries, block definitions)
│   ├── locales/           # i18next translations
│   └── assets/            # Images, icons
├── backend/
│   ├── editor/            # Main process modules (compiler, hardware, modbus, ethercat, library-manager, services)
│   └── shared/            # Platform-agnostic utilities (XML generation, project parsing, simulator)
├── middleware/             # Ports & Adapters layer
│   ├── shared/
│   │   ├── ports/         # Port interfaces (platform-agnostic contracts)
│   │   └── providers/     # PlatformContext (React Context for dependency injection)
│   └── adapters/
│       └── editor/        # Electron-specific port implementations (IPC bridge)
├── types/                 # Shared IPC type contracts
└── __architecture__/      # Layer dependency validation script
```

### Ports & Adapters Pattern

The codebase uses **dependency inversion** via port interfaces. Frontend code never imports backend or Electron APIs directly. All platform-specific behavior flows through ports.

**Main port interfaces** (full list in `src/middleware/shared/ports/`):

| Port | Responsibility |
|------|---------------|
| `CompilerPort` | PLC compilation pipeline |
| `RuntimePort` | Remote PLC runtime control (login, start/stop, status) |
| `DebuggerPort` | Debug protocol (read/write variables, MD5 verification) |
| `SimulatorPort` | Built-in AVR simulator |
| `ProjectPort` | Project CRUD operations |
| `DevicePort` | Board discovery, serial ports |
| `OrchestratorPort` | Device fleet management (web-only) |
| `SystemPort` | Platform services (store, logging, external links) |
| `WindowPort` | Native window management |
| `AcceleratorPort` | Keyboard shortcuts |
| `ThemePort` | Theme detection and switching |
| `VersionControlPort` | Git operations |
| `AIPort` | AI assistant (optional) |

**Consuming ports** in components:
```typescript
import { useCompiler, useRuntime, useCapabilities } from '@root/middleware/shared/providers'

function MyComponent() {
  const compiler = useCompiler()
  const capabilities = useCapabilities()

  if (capabilities.hasLocalSerialPorts) { /* ... */ }
  await compiler.compileProgram(args, onProgress)
}
```

**Wiring** happens at the app root (`src/App.tsx`):
```typescript
import { editorPorts } from './middleware/editor-platform'
<PlatformProvider ports={editorPorts}>...</PlatformProvider>
```

**Editor adapters** (`src/middleware/adapters/editor/`) implement ports by calling `window.bridge.*` (Electron IPC). The web repo has its own adapters using HTTP/WebRTC instead.

### Architecture Layer Rules

Enforced by `npm run validate:arch`. Source dependencies point inward only:

```
assets      -> utils, data
utils       -> utils, ports, data, assets
data        -> ports, utils, data, assets
types       -> store, utils
ports       -> utils, ports
provider    -> ports, utils
adapters    -> ports, provider, utils, backend-shared, backend-web, store, assets
backend-shared -> ports, utils, types
store       -> ports, provider, store, utils, assets
services    -> ports, provider, store, services, utils, assets
hooks       -> ports, provider, store, hooks, services, utils, assets
components  -> ports, provider, store, hooks, services, components, data, utils, assets
```

### IPC Communication

Main and renderer processes communicate through typed IPC bridges:

- **Main bridge:** `src/main/modules/ipc/main.ts` — `MainProcessBridge` registers 50+ `ipcMain.handle()` handlers
- **Renderer bridge:** `src/main/modules/ipc/renderer.ts` — async wrappers calling `ipcRenderer.invoke()`
- **Preload:** `src/main/modules/preload/preload.ts` — exposes `window.bridge` via `contextBridge`

### State Management (Zustand)

Single store composed of the slices in `RootState` (`src/frontend/store/index.ts`), accessed via auto-generated selector hooks:

```typescript
import { useOpenPLCStore } from '@root/frontend/store'

const pous = useOpenPLCStore((s) => s.project.data.pous)
const createPou = useOpenPLCStore((s) => s.projectActions.createPou)
```

**Slice pattern** — each slice has three files:

- `types.ts` — state shape + action signatures
- `slice.ts` — implementation using Immer's `produce()` for immutable updates
- `index.ts` — re-exports

**Key slices:**

| Slice | Purpose |
|-------|---------|
| `project` | PLC project structure (POUs, data types, servers, devices) |
| `device` | Board config, pin mappings, runtime connection |
| `editor` | Editor models (discriminated union: textual, graphical, device, etc.) |
| `tabs` | Open file tabs |
| `workspace` | UI viewport state, debug values |
| `ladder` | Ladder diagram rungs per POU |
| `fbd` | FBD flow graphs per POU |
| `console` | Log output |
| `library` | System + user function block libraries |
| `file` | File save states (dirty tracking) |
| `print` | Print/export-to-PDF selection, render mode, page policy, page setup |
| `ai`, `history`, `modal`, `readme`, `search`, `shared`, `version-control`, `webrtc` | Supporting features |

**Conventions:**
- Actions are grouped under a `*Actions` namespace (e.g., `projectActions`, `deviceActions`)
- Complex actions return `{ ok: boolean; message?: string }` response objects
- State is never mutated directly — always use `produce()` from Immer
- Direct state access outside React: `openPLCStoreBase.getState()`

### Component Organization (Atomic Design)

```
src/frontend/components/
├── _atoms/          # Primitive UI elements (buttons, inputs, select, checkbox, table)
├── _molecules/      # Composed patterns (menu-bar, modal, variables-table, tabs)
├── _organisms/      # Complex sections (explorer, panel, console, debugger, navigation)
├── _features/       # Context-specific feature bundles
│   ├── [app]/       # App-level (loading overlay, toast)
│   ├── [start]/     # Start screen (menu, new-project modal)
│   └── [workspace]/ # Workspace features
│       └── editor/  # Monaco, graphical (LD/FBD/SFC), device, server editors
├── _templates/      # Layout wrappers (app-layout, workspace-layout)
└── ui/              # Radix UI primitive wrappers
```

### Navigation

There is **no URL-based router**. Navigation is tab-driven via the Zustand `tabs` + `editor` slices:

1. `App.tsx` renders `StartScreen` (no project) or `WorkspaceScreen` (project loaded)
2. Opening a POU/resource creates a tab entry in the store
3. Clicking a tab sets the active `EditorModel` (discriminated union determines which editor renders)

### Graphical Editors

- **Ladder Diagram (LD):** DnD Kit-based, rung structure with contacts/coils/blocks
- **Function Block Diagram (FBD):** @xyflow/react flow graph with custom node types (block, variable, connector, comment)
- **SFC:** @xyflow/react graph (sequential function charts)

Flow state is stored per-POU in dedicated slices (`ladder`, `fbd`). Flows must be relinked to current variables after variable table changes.

### Compilation Pipeline

Orchestrated by `CompilerModule` (`src/backend/editor/compiler/compiler-module.ts`):

```
PLCProjectData -> Preprocess POUs -> ST transpiler (in-process) -> strucpp -> C++ code
                                                                           |
                                                    defines.h (pins, Modbus, MD5)
                                                                           |
                                                    Arduino CLI / openplc-compiler -> firmware
```

Structured Text is generated in-process by the TS transpiler
(`src/backend/shared/transpilers/st-transpiler/`) on both editor and web — the
legacy `xml2st` binary path has been retired. `XmlGenerator` is kept only for
the "Export Project as XML" feature.

**The Modbus block of `defines.h` has two sources**
(`src/backend/shared/compile/steps/modbus-defines.ts`): the project's Modbus
`PLCServer` (transports, slave id, TCP port, speed of its own UART) and the
board's VPP screens (`serial` and `network` sections: default UART speed, RS-485
pin, network). `resolveServerBaud`
(`src/middleware/shared/utils/modbus-server-profile/baud.ts`) owns the choice of
the default UART's speed, and the screen calls it too. A firmware build serves
exactly one slave, so `selectModbusServer` refuses a build with more than one
enabled server. `DEBUG_BAUD` comes from `screens.serial.baud_rate` and
`DEBUG_SLAVE` is the constant 1.

With one UART for both (no `MBSERIAL_ON_SECONDARY`), the firmware answers two ids on it, routed by
function code (`handle_serial_port` in `resources/sources/Baremetal/modbus_serial.cpp`): the editor's id
(`MB_EDITOR_SLAVE`, equal to `DEBUG_SLAVE`) carries only the editor function codes 0x41-0x4D
(`mb_pdu_is_editor_fc` in `modbus_pdu.cpp`) and silently drops anything else; the server's id
(`modbus.slaveid`, from `MBSERIAL_SLAVE`) carries the standard frames the framer recognizes and answers
an editor function code with an illegal-function exception. A function code the framer does not
recognize is dropped during serial framing, not answered. When the two ids are equal, that id serves
both, and a build without the debugger (`MB_EDITOR_SLAVE` undefined) uses the server's id for both.
With `MBSERIAL_ON_SECONDARY`, the default UART answers only `DEBUG_SLAVE` and the secondary UART only
`MBSERIAL_SLAVE`.

Platform-specific binaries in `/resources/bin/[platform]/[arch]/`. Board configs in `src/backend/shared/firmware/hals.json`.

**Pre-build gates.** `evaluateVppBackplaneGate`
(`src/middleware/shared/utils/build-gate/vpp-backplane-gate.ts`, shared with openplc-web) refuses when: the
project's board is not among the selected vPLC's boards; a vendor board is used with no vPLC selected on a
host whose vPLCs provide the vendor boards; the vPLC reports `backplaneAccess: false`; or the vPLC's package
is `null` or differs from the board's. In `src/frontend/components/_organisms/workspace-activity-bar/default.tsx`,
`handleBuild` runs it before `evaluatePreBuildPlcGate`, and `handleMd5Verification` runs it before offering an upload.
It is inert in the editor (no orchestrator devices) and kept so the shared surface stays byte-identical with openplc-web.

### Debugging

- **Protocol:** Custom Modbus PDU: function codes 0x41-0x45 for variable read/write, and 0x46-0x4D for status, version, licensing, run/stop state, bootloader reboot and lock state (`resources/sources/Baremetal/modbus_types.h`)
- **Transports:** Modbus TCP, Modbus RTU, WebSocket, or virtual serial (simulator)
- **Simulator:** AVR8JS emulator (`src/backend/shared/simulator/`) emulates ATmega2560
- **Flow:** Compile with debug symbols (.dbg file + MD5) -> connect debugger -> poll variables

## Testing

- **Unit:** Jest + jsdom, `npm run test` (CI: `npx jest --config jest.config.json --collectCoverage --ci`). Test files are `*.test.ts(x)`, `*.spec.ts(x)` or `__tests__/` directories. Mocks: `configs/mocks/` for file stubs, `identity-obj-proxy` for CSS modules.
- **Coverage:** per-directory floors are in `jest.config.json` (`coverageThreshold`).
- **End-to-end:** Playwright specs in `e2e/` drive the built Electron app through `_electron.launch`; run them as described in "Electron e2e (Playwright)" above. No CI workflow runs them.
- **Manual:** the developer's manual test is required for every demand.

## Code Style

- TypeScript `strict: true` (`tsconfig.json`); ESLint flat config (`eslint.config.mjs`) extends `tseslint.configs.recommendedTypeChecked`, which makes `@typescript-eslint/no-explicit-any` an error (test files are ignored by ESLint)
- Prettier: 120 char width, no semicolons, single quotes, trailing commas
- Import sorting enforced via `simple-import-sort` plugin
- `lint-staged` is configured in `package.json`, but no Husky hook is committed (no `.husky/` directory), so nothing runs on commit
- Path alias: `@root/*` -> `./src/*`

### TypeScript Best Practices

- No type assertions: `as` hides real type errors — fix the type at the source or narrow with type guards. `as const` is fine; `as unknown as T` is forbidden.
- No non-null assertions (`!`): handle the undefined case or narrow explicitly.
- No `@ts-ignore`/`@ts-expect-error` without a one-line justification.
- Validate external data at the boundary (IPC payloads, project files, downloaded binaries metadata) with schemas (zod) or type guards instead of casting.
- No floating promises: `await` or handle rejection explicitly — async errors must not disappear.
- Prefer `??` over `||` for defaults when `0`, `''`, or `false` are valid values.
- Model variant states as discriminated unions; make `switch` exhaustive with a `never` check.
- Named exports over default exports.
- Zustand state changes only through slice actions — never mutate store values from components.

## Key Technologies

- **Electron 35** / **React 18** / **TypeScript** (target ES2022)
- **Webpack** (not Vite) with separate main/renderer/preload configs
- **Zustand 5** + **Immer** for state management
- **Monaco Editor** for code editing (ST, IL, Python, C++)
- **@xyflow/react 12** for FBD/SFC graphical editors
- **@dnd-kit** for drag-and-drop (tabs, ladder rungs)
- **Tailwind CSS 3** + **Radix UI** for styling
- **Zod** for schema validation
- **i18next** for internationalization
- **avr8js** for Arduino simulation
- **Axios** for HTTP requests
- **Socket.io** for real-time communication
- **Winston** for structured logging (main process)
- **serialport** for serial communication
- **pdf-lib** + **@pdf-lib/fontkit** for PDF export (print/export-to-PDF)

## Important Patterns

### When bumping the app version:
`APP_VERSION` in `src/frontend/data/constants/app-version.ts` is the **single
source of truth** for the human-facing version, shared **byte-for-byte** between
openplc-editor and openplc-web (enforced by the mirror gate / `compare-surfaces.py`).
The About modal renders it directly; the web build writes it into `version.json`.

**Bump `APP_VERSION` — never `package.json` alone.** Make the identical one-line
edit in BOTH repos, and set `package.json.version` to the same value in both so
they can't drift. Roles: `APP_VERSION` is what the user sees in the About dialog;
`package.json.version` is what a local build stamps. Bumping only `package.json`
leaves the About dialog stuck on the old version. If those two disagree, `APP_VERSION`
is authoritative; fix `package.json` to match.

**The release tag must equal `APP_VERSION` too.** `release.yml` stamps the binary
from the tag while About renders `APP_VERSION`, so tagging `v4.3.0` while
`APP_VERSION` is 4.2.12 ships an installer named 4.3.0 whose About dialog says
4.2.12 — the same failure in a different disguise. Check before tagging: a pushed
tag cannot be "fixed to match".

In the editor, electron-builder reads **`release/app/package.json`**, not the root
one — `electron-builder.json` sets `directories.app` to `release/app`. The release
workflow runs `npm version <tag>` at the root AND in `release/app`, so a
*tag-triggered* release is always correct. Two cases are not: a LOCAL package
build takes whatever `release/app/package.json` says, and a `workflow_dispatch`
run with an empty `version` input falls back to root `package.json`
(`release.yml`, version resolution). Use `npm version <v> --no-git-tag-version
--allow-same-version` in both places rather than editing by hand: it updates each
lockfile too, which hand edits miss.

Release mechanics, in order: bump `APP_VERSION` and `package.json` to the same value in both
repos and merge to `development`; promote `development` to `main` in both repos; then tag `vX.Y.Z`
(equal to `APP_VERSION`) on openplc-editor's `main`, which triggers `release.yml` ("Build and
Release"). openplc-web has no release workflow: `production-cd.yml` deploys on every push to its
`main`, and `staging-cd.yml` on pushes to `development`.

### When adding a new port:
1. Define the interface in `src/middleware/shared/ports/`
2. Add it to `PlatformPorts` in `src/middleware/shared/providers/types.ts`
3. Add a convenience hook in `src/middleware/shared/providers/platform-context.tsx`
4. Implement the editor adapter in `src/middleware/adapters/editor/`
5. Wire it in `src/middleware/editor-platform.ts`

### When adding a new store slice:
1. Create `types.ts`, `slice.ts`, `index.ts` in `src/frontend/store/slices/<name>/`
2. Add the slice type to `RootState` union in `src/frontend/store/index.ts`
3. Spread the slice creator in `createOpenPLCStore()`
4. Add tests with it, so the directory stays above its coverage floor

### When adding a new POU language or type:
1. Update project parser (`src/backend/shared/utils/parse-project-files.ts`)
2. Update serializer for save flow
3. Add editor component if graphical
4. Register in library system and project actions

### When modifying graphical editors:
1. Flow state is stored separately from POU body during editing
2. Sync flows back to POU on save
3. Relink variables after variable table changes
4. Node IDs must be unique per flow

### IEC address allocation + alias registry

Located in `src/middleware/shared/utils/iec-address/` (byte-identical on
openplc-web). Pure functions, no IPC, no electron coupling.

- **Address pool** (`address-pool.ts`): producer-only, target-scoped
  view of every claimed IEC address. Producers = pin mapping, VPP
  module slots, Modbus TCP remote IO points, EtherCAT channel
  mappings. Capability scoping comes from `target-capabilities` —
  switching targets activates / deactivates entire producers.
  - Reservation pass: pin-mapping (Arduino-style fixed addresses).
  - Allocation pass: every other producer in deterministic order.
  - `nextFreeAddress(pool, prefix, isBit, startFrom?, alsoUsed?)`
    replaces the old `generateIecAddress` helper. Pass `alsoUsed` for
    in-flight allocations within a batch.
- **Alias registry** (`alias-registry.ts`): derived index on top of
  the pool. `byAlias` map plus `duplicateAliases` (first-wins). Pure
  function — rebuild on demand, cost is O(producers).
- **Compile-time resolution** (`registry/resolve.ts`): a variable's
  `location` holds EITHER an alias name OR a literal `%addr`
  (single-field model). `buildAliasIndex(registry)` builds the
  `alias → address` map; `resolveLocation(field, index)` resolves a
  variable's `location` for the compiler:
  - literal `%…` → used verbatim (manual locations honoured exactly);
  - alias that still exists → its current address;
  - alias that is gone → `''` (variable becomes unlocated).
  The compiler/runtime never see aliases: the editor resolves them in
  a pre-compile snapshot via the
  `projectActions.getCompileReadyProjectData()` store action. When a
  producer alias is renamed, `projectActions.renameAlias(old, new)`
  cascades onto every bound variable's `location`.

The variable cell renders `location` verbatim — the alias name when
alias-bound, the `%addr` when a manual literal — and shows an amber
warning glyph + tooltip when an alias-bound location no longer resolves
(orphaned) or when a manual `%addr` collides with an alias another
project variable is bound to (duplicate-location risk). Aliases are
intended to be unique system-wide; every IO-mapping / pin /
remote-device editor calls the registry's
`validateAliasEdit(registry, name, ignoring)` gate before persisting a
new alias.

## Environment

- **Node.js:** >= 22.x < 24
- **Dev server port:** 1313
- **Supported platforms:** macOS, Windows, Linux (x64 & ARM64)
- **Binaries:** Auto-downloaded via `scripts/download-binaries.ts` during `npm install`
