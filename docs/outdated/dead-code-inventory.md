# Dead Code Inventory

Audit date: 2026-03-17
Branch: `fix/step-31-final-adjustments`

This document tracks dead code identified during a code quality audit.
Items here are documented for later cleanup — they are not blocking any work.

---

## Unused Exported Function

### `getVariableSize()` — `src/frontend/utils/variable-sizes.ts:101-146`

Exported function that takes a full `PLCVariable` object and returns byte size.
Superseded by `getTypeSizeByName()` (line 152) which takes just a type name string.

- Never imported by any other file in the codebase.
- Not called internally within the file.
- The sibling function `getTypeSizeByName` covers the same logic and is actively used.

**Action:** Remove the function. No callers to update.

---

## Unnecessary Export Keyword

### `parseVariableValue()` — `src/frontend/utils/variable-sizes.ts:189-258`

Exported but only called internally by `parseValueByTypeName()` (line 277).
No external file imports `parseVariableValue` directly.

**Action:** Remove the `export` keyword. The function itself is live code (used by `parseValueByTypeName` which is consumed by `useDebugPolling.ts`).

---

## Commented-Out Imports

These are leftover commented imports that should be removed:

| File | Line | Content |
|------|------|---------|
| `src/main/modules/preload/preload.ts` | 1 | `// import './splash-screen/index'` |
| `src/frontend/components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram/index.ts` | 4 | `// import type { VariableNode } from '...'` |
| `src/types/common/project.ts` | 1, 3 | `// import { z } from 'zod'`, `// import { CONSTANTS, formatDate } from '@/utils'` |
| `src/frontend/utils/PLC/xml-generator/codesys/pou-xml.ts` | 1 | `// import { PLCVariable } from '@root/types/PLC'` |
| `src/frontend/components/_organisms/global-variables-editor/index.tsx` | 1 | `// import * as PrimitiveSwitch from '@radix-ui/react-switch'` |

**Action:** Delete each commented line.

---

## TODO/FIXME Comments (Incomplete Implementations)

These are not dead code but flag missing validation logic:

| File | Description |
|------|-------------|
| `src/types/PLC/open-plc.ts:165-168` | Task name uniqueness — needs homologation |
| `src/types/PLC/open-plc.ts:234-236` | Schema validation TODOs |
| `src/types/PLC/units/task.ts` | Task interval regex validation missing |
| `src/types/PLC/units/instance.ts` | Instance task/program validation missing |
| `src/types/PLC/units/library.ts` | Library validation TODOs |
| `src/backend/editor/hardware/hardware-module.ts` | TODO comment |
| `src/backend/editor/compiler/compiler-module.ts` | TODO comment |
| `src/backend/editor/services/project-service/utils/read-project.ts` | TODO comment |
| `src/main/main.ts` | Multiple TODO comments |

**Action:** Track as separate backlog items, not dead code cleanup.
