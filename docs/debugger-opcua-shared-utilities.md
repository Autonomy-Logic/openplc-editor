# Debugger and OPC-UA Shared Utilities Refactoring

## Overview

This document outlines the plan to refactor the OpenPLC Editor codebase to eliminate code duplication between the **debugger** and **OPC-UA** subsystems. Both systems need to resolve debug variable indices from the `debug.c` file generated during compilation, but currently they use separate implementations with duplicated logic.

## Problem Statement

### Current State

The debugger and OPC-UA configuration generator both need to:

1. Parse `debug.c` to extract variable entries with their indices
2. Build debug paths in specific formats (`RES0__INSTANCE.VAR`, `CONFIG0__GLOBAL`, etc.)
3. Match PLC variables to debug entries to resolve indices
4. Handle complex types (function blocks, structures, arrays)

However, these functionalities are implemented **twice**:

| Functionality | Debugger Implementation | OPC-UA Implementation |
|--------------|------------------------|----------------------|
| Parse debug.c | `renderer/utils/parse-debug-file.ts` | `utils/debug-variable-finder.ts` |
| Build paths | `renderer/utils/debug-tree-builder.ts` | `utils/debug-variable-finder.ts` |
| Find indices | `parse-debug-file.ts:matchVariableWithDebugEntry()` | `debug-variable-finder.ts:findVariableIndex()` |
| FB/struct lookup | Manual in `debug-tree-builder.ts` | `utils/pou-helpers.ts` |
| Tree traversal | `debug-tree-builder.ts` | `opcua/resolve-indices.ts` |

### Why This Is a Problem

1. **Bug Duplication**: A fix in one system may not be applied to the other
2. **Inconsistent Behavior**: Subtle differences in path building can cause one system to work while the other fails
3. **Maintenance Burden**: Changes to debug.c format require updates in multiple places
4. **Testing Overhead**: Both implementations need separate test coverage

### Recent Example

During OPC-UA development, shared utilities were created (`debug-variable-finder.ts`, `pou-helpers.ts`) but the debugger was not updated to use them. This led to confusion when debugging issues because the systems used different code paths.

## Architecture Analysis

### Debug Path Formats in debug.c

The IEC 61131-3 compiler generates `debug.c` with variable paths in these formats:

```c
// Global variables
{ &(CONFIG0__GLOBAL_VAR), INT_ENUM }

// Program variables (simple)
{ &(RES0__INSTANCE0.MOTOR_SPEED), INT_ENUM }

// Function block instance variables
{ &(RES0__INSTANCE0.TON0.Q), BOOL_ENUM }
{ &(RES0__INSTANCE0.TON0.ET), TIME_ENUM }

// Nested FB variables
{ &(RES0__INSTANCE0.CONTROLLER0.INNER_FB0.VALUE), REAL_ENUM }

// Structure fields (note the .value. segment)
{ &(RES0__INSTANCE0.MY_STRUCT.value.FIELD1), INT_ENUM }

// Array elements (note .value.table[i])
{ &(RES0__INSTANCE0.MY_ARRAY.value.table[0]), INT_ENUM }
{ &(RES0__INSTANCE0.MY_ARRAY.value.table[1]), INT_ENUM }
```

Key observations:
- Instance names come from Resources configuration, NOT POU names
- FB variables use direct dot notation (no `.value.`)
- Structure fields require `.value.` before field name
- Arrays require `.value.table[i]` syntax

### Current Debugger Files

```
src/renderer/
├── utils/
│   ├── parse-debug-file.ts      # Parses debug.c, matchVariableWithDebugEntry()
│   └── debug-tree-builder.ts    # Builds UI tree, has own path building
├── components/_organisms/
│   └── workspace-activity-bar/
│       └── default.tsx          # Initializes debugger, calls parsing
└── screens/
    └── workspace-screen.tsx     # Polling loop, builds paths inline
```

### Current OPC-UA Files

```
src/utils/
├── debug-variable-finder.ts     # Path building, variable lookup (SHARED)
├── pou-helpers.ts               # FB/struct lookup (SHARED)
└── opcua/
    ├── resolve-indices.ts       # Uses shared utilities
    ├── generate-opcua-config.ts # Generates JSON config
    └── types.ts                 # Type definitions
```

### Duplication Details

#### 1. Debug File Parsing

**Debugger** (`parse-debug-file.ts`):
```typescript
export function parseDebugFile(content: string): ParsedDebugData {
  const variables: DebugVariable[] = []
  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)
  // ... parsing logic
  return { variables, totalCount }
}
```

**Shared** (`debug-variable-finder.ts`):
```typescript
export function parseDebugVariables(content: string): DebugVariableEntry[] {
  const variables: DebugVariableEntry[] = []
  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)
  // ... nearly identical parsing logic
  return variables
}
```

#### 2. Path Building

**Debugger** (`debug-tree-builder.ts`):
```typescript
function buildVariableBasePath(variableName: string, instanceName: string, variableClass?: string): string {
  if (variableClass === 'external') {
    return `CONFIG0__${variableNameUpper}`
  }
  return `RES0__${instanceNameUpper}.${variableNameUpper}`
}
```

**Shared** (`debug-variable-finder.ts`):
```typescript
export function buildDebugPath(instanceName: string, variablePath: string, options = {}): string {
  // More comprehensive implementation handling all path formats
}

export function buildGlobalDebugPath(variablePath: string): string {
  return `CONFIG0__${variablePath.toUpperCase()}`
}
```

#### 3. Index Lookup

**Debugger** (`parse-debug-file.ts`):
```typescript
export function matchVariableWithDebugEntry(
  pouVariableName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  variableClass?: string,
): number | null {
  const expectedPath = `RES0__${instanceNameUpper}.${variableNameUpper}`
  const match = debugVariables.find((dv) => dv.name === expectedPath)
  return match ? match.index : null
}
```

**Shared** (`debug-variable-finder.ts`):
```typescript
export function findVariableIndex(
  instanceName: string,
  variablePath: string,
  debugVariables: DebugVariableEntry[],
  options = {},
): number | null {
  const debugPath = buildDebugPath(instanceName, variablePath, options)
  const match = findDebugVariable(debugVariables, debugPath)
  return match ? match.index : null
}
```

## Refactoring Plan

The refactoring will be done in 6 phases, each building on the previous. This incremental approach minimizes risk and allows testing at each stage.

### Phase 1: Consolidate Debug File Parsing

**Goal**: Single source of truth for parsing `debug.c`

**Rationale**: The parsing logic is nearly identical in both implementations. Having a single parser ensures consistent behavior and makes it easier to handle any future changes to the debug.c format.

**Changes**:

1. Create canonical parser in `src/utils/debug-parser.ts`:
   ```typescript
   // src/utils/debug-parser.ts
   export interface DebugVariableEntry {
     name: string      // Full path (e.g., "RES0__INSTANCE0.VAR")
     type: string      // Type enum (e.g., "INT_ENUM")
     index: number     // Array index in debug_vars[]
   }

   export function parseDebugVariables(content: string): DebugVariableEntry[]
   ```

2. Update `renderer/utils/parse-debug-file.ts` to delegate:
   ```typescript
   // Re-export from shared module
   export { parseDebugVariables as parseDebugFile } from '@root/utils/debug-parser'

   // Keep DebugVariable interface for backwards compatibility
   export type DebugVariable = DebugVariableEntry
   ```

3. Update `utils/debug-variable-finder.ts` to import from `debug-parser.ts`

**Files Modified**:
- Create: `src/utils/debug-parser.ts`
- Modify: `src/renderer/utils/parse-debug-file.ts`
- Modify: `src/utils/debug-variable-finder.ts`

**Testing**:
- Existing debugger tests should pass unchanged
- Existing OPC-UA tests should pass unchanged
- Add shared parser unit tests

---

### Phase 2: Unify Path Building

**Goal**: Single implementation for all debug path formats

**Rationale**: Path building is where subtle bugs can occur. The shared `buildDebugPath()` already handles more cases than the debugger's `buildVariableBasePath()`. Unifying ensures both systems handle all path formats correctly.

**Changes**:

1. Ensure `buildDebugPath()` handles all cases:
   - Simple variables: `RES0__INSTANCE.VAR`
   - FB instance variables: `RES0__INSTANCE.FB.VAR`
   - Nested FB variables: `RES0__INSTANCE.FB1.FB2.VAR`
   - Structure fields: `RES0__INSTANCE.STRUCT.value.FIELD`
   - Array elements: `RES0__INSTANCE.ARR.value.table[i]`
   - Global variables: `CONFIG0__VAR`

2. Update `debug-tree-builder.ts` to use shared path builder:
   ```typescript
   // Before
   const fullPath = buildVariableBasePath(variable.name, instanceName, variable.class)

   // After
   import { buildDebugPath, buildGlobalDebugPath } from '@root/utils/debug-variable-finder'
   const fullPath = variable.class === 'external'
     ? buildGlobalDebugPath(variable.name)
     : buildDebugPath(instanceName, variable.name)
   ```

3. Keep `buildVariableBasePath()` as deprecated wrapper during transition

**Files Modified**:
- Modify: `src/utils/debug-variable-finder.ts` (ensure all path formats)
- Modify: `src/renderer/utils/debug-tree-builder.ts`

**Testing**:
- Test all path format variations
- Verify debugger tree building still works
- Test with nested FBs, arrays of structs, etc.

---

### Phase 3: Unify Variable Index Lookup

**Goal**: Single function for finding variable indices

**Rationale**: Index lookup depends on correct path building. By this phase, paths are unified, so lookup can also be unified.

**Changes**:

1. Update `workspace-activity-bar/default.tsx` to use shared utilities:
   ```typescript
   // Before
   import { parseDebugFile, matchVariableWithDebugEntry } from '../utils/parse-debug-file'
   const index = matchVariableWithDebugEntry(v.name, instance.name, parsed.variables, v.class)

   // After
   import { parseDebugVariables } from '@root/utils/debug-parser'
   import { findVariableIndex, findGlobalVariableIndex } from '@root/utils/debug-variable-finder'
   const index = v.class === 'external'
     ? findGlobalVariableIndex(v.name, debugVariables)
     : findVariableIndex(instance.name, v.name, debugVariables)
   ```

2. Deprecate `matchVariableWithDebugEntry()` and `matchGlobalVariableWithDebugEntry()`

**Files Modified**:
- Modify: `src/renderer/components/_organisms/workspace-activity-bar/default.tsx`
- Modify: `src/renderer/utils/parse-debug-file.ts` (mark functions deprecated)

**Testing**:
- Verify debugger initialization works correctly
- Test with various variable types (local, external, FB instances)
- Ensure index map is populated correctly

---

### Phase 4: Unify Tree Building

**Goal**: Shared tree/leaf variable traversal for both debugger and OPC-UA

**Rationale**: Both systems need to traverse complex types (FBs, structs, arrays) to find leaf variables. The traversal logic is complex and having it in one place reduces bugs.

**Changes**:

1. Create shared tree traversal with visitor pattern:
   ```typescript
   // src/utils/debug-tree-traversal.ts

   export interface DebugNodeVisitor<T> {
     visitLeaf(path: string, compositeKey: string, type: string, index: number | undefined): T
     visitComplex(path: string, compositeKey: string, type: string, children: T[]): T
     visitArray(path: string, compositeKey: string, elementType: string, indices: [number, number], children: T[]): T
   }

   export function traverseVariable<T>(
     variable: PouVariable,
     pouName: string,
     instanceName: string,
     debugVariables: DebugVariableEntry[],
     projectPous: PLCPou[],
     dataTypes: PLCDataType[],
     visitor: DebugNodeVisitor<T>
   ): T
   ```

2. Debugger implements visitor for `DebugTreeNode`:
   ```typescript
   const debuggerVisitor: DebugNodeVisitor<DebugTreeNode> = {
     visitLeaf: (path, key, type, index) => ({
       name: path.split('.').pop()!,
       fullPath: path,
       compositeKey: key,
       type,
       isComplex: false,
       debugIndex: index
     }),
     // ... other methods
   }
   ```

3. OPC-UA implements visitor for `ResolvedField[]`:
   ```typescript
   const opcuaVisitor: DebugNodeVisitor<ResolvedField[]> = {
     visitLeaf: (path, key, type, index) => [{
       name: path,
       datatype: type,
       index: index!,
       // ...
     }],
     // ... other methods
   }
   ```

**Files Created**:
- `src/utils/debug-tree-traversal.ts`

**Files Modified**:
- Modify: `src/renderer/utils/debug-tree-builder.ts` (use shared traversal)
- Modify: `src/utils/opcua/resolve-indices.ts` (use shared traversal)

**Testing**:
- Test with deeply nested FBs
- Test with arrays of structures
- Test with mixed complex types
- Verify both debugger and OPC-UA produce correct results

---

### Phase 5: Update Debugger Polling

**Goal**: Consistent index lookup in polling code

**Rationale**: The polling loop in `workspace-screen.tsx` builds paths inline. Using shared utilities ensures consistency with initialization.

**Changes**:

1. Replace inline path construction:
   ```typescript
   // Before
   const debugPath = `RES0__${programInstance.name.toUpperCase()}.${fbInstance.name.toUpperCase()}.${fbVar.name.toUpperCase()}`

   // After
   import { buildDebugPath } from '@root/utils/debug-variable-finder'
   const debugPath = buildDebugPath(programInstance.name, `${fbInstance.name}.${fbVar.name}`)
   ```

2. Use `findInstanceName()` instead of manual instance lookup

3. Centralize FB variable iteration logic

**Files Modified**:
- Modify: `src/renderer/screens/workspace-screen.tsx`

**Testing**:
- Test debugger polling with real hardware
- Verify all variable types update correctly
- Test force variable functionality

---

### Phase 6: Remove Deprecated Code

**Goal**: Clean up duplicate implementations after verification

**Prerequisites**:
- All phases 1-5 completed
- Debugger verified working with real hardware
- OPC-UA verified working with real hardware
- No regressions in functionality
- All tests passing

**Removals**:

1. **`src/renderer/utils/parse-debug-file.ts`**:
   - Remove `parseDebugFile()` implementation body (keep as re-export)
   - Remove `matchVariableWithDebugEntry()` function
   - Remove `matchGlobalVariableWithDebugEntry()` function
   - Remove `parsePathComponents()` helper
   - Keep file with re-exports for backwards compatibility

2. **`src/renderer/utils/debug-tree-builder.ts`**:
   - Remove `buildVariableBasePath()` function
   - Remove `normalizeTypeString()` (use from `pou-helpers.ts`)
   - Remove duplicate FB/struct lookup code
   - Update to be thin wrapper around shared traversal

3. **`src/renderer/screens/workspace-screen.tsx`**:
   - Remove any remaining inline path building

4. **Update all imports** to point to canonical shared locations

**Final File Structure**:

```
src/
├── utils/
│   ├── debug-parser.ts              # CANONICAL: Parse debug.c
│   ├── debug-variable-finder.ts     # CANONICAL: Path building, index lookup
│   ├── debug-tree-traversal.ts      # CANONICAL: Tree traversal (NEW)
│   ├── pou-helpers.ts               # CANONICAL: FB/struct lookup
│   └── opcua/
│       ├── resolve-indices.ts       # Uses shared utilities
│       ├── generate-opcua-config.ts
│       └── types.ts
├── renderer/
│   ├── utils/
│   │   ├── parse-debug-file.ts      # Re-exports only (backwards compat)
│   │   └── debug-tree-builder.ts    # UI wrapper using shared traversal
│   ├── components/_organisms/
│   │   └── workspace-activity-bar/
│   │       └── default.tsx          # Uses shared utilities
│   └── screens/
│       └── workspace-screen.tsx     # Uses shared utilities
└── types/
    └── debugger.ts                  # Shared debug node types
```

**Testing**:
- Full regression test suite
- Manual testing with various PLC programs
- Test edge cases (empty programs, complex nesting)

## Migration Strategy

### Backwards Compatibility

During the transition, we maintain backwards compatibility by:

1. **Re-exporting**: Old import paths continue to work
2. **Wrapper functions**: Deprecated functions delegate to new implementations
3. **Type aliases**: Old type names map to new types

Example:
```typescript
// src/renderer/utils/parse-debug-file.ts (during transition)

// Re-export new parser with old name
export { parseDebugVariables as parseDebugFile } from '@root/utils/debug-parser'

// Type alias for backwards compatibility
export type { DebugVariableEntry as DebugVariable } from '@root/utils/debug-parser'

// Deprecated wrapper (to be removed in Phase 6)
/** @deprecated Use findVariableIndex from debug-variable-finder instead */
export function matchVariableWithDebugEntry(...) {
  console.warn('matchVariableWithDebugEntry is deprecated')
  return findVariableIndex(...)
}
```

### Testing Strategy

Each phase includes specific testing requirements:

1. **Unit Tests**: Test shared utilities in isolation
2. **Integration Tests**: Test debugger and OPC-UA with shared code
3. **Hardware Tests**: Verify with actual PLC hardware
4. **Regression Tests**: Ensure no existing functionality breaks

### Rollback Plan

If issues are discovered:

1. Each phase can be reverted independently
2. Deprecated wrappers provide fallback during transition
3. Git branches allow easy rollback to previous state

## Timeline Estimate

| Phase | Complexity | Dependencies |
|-------|------------|--------------|
| Phase 1 | Low | None |
| Phase 2 | Medium | Phase 1 |
| Phase 3 | Medium | Phase 2 |
| Phase 4 | High | Phase 2, 3 |
| Phase 5 | Medium | Phase 2 |
| Phase 6 | Low | All above + verification |

Recommended order: 1 → 2 → 3 → 5 → 4 → 6

(Phase 5 can be done before Phase 4 as it only requires path building)

## Success Criteria

The refactoring is complete when:

1. ✅ Single debug.c parser used by both systems
2. ✅ Single path building implementation
3. ✅ Single index lookup implementation
4. ✅ Shared tree traversal logic
5. ✅ No duplicate implementations remain
6. ✅ All tests pass
7. ✅ Debugger works correctly with hardware
8. ✅ OPC-UA works correctly with hardware
9. ✅ Code coverage maintained or improved

## References

- `src/utils/debug-variable-finder.ts` - Current shared path building
- `src/utils/pou-helpers.ts` - Current shared POU helpers
- `src/renderer/utils/debug-tree-builder.ts` - Current debugger tree builder
- `src/utils/opcua/resolve-indices.ts` - Current OPC-UA index resolution
