# Phase 5: Editor Frontend Debugger Updates

## Goal

Update the editor's debugger frontend to support both the legacy flat-index protocol (v1,
MatIEC) and the new hierarchical protocol (v2, STruC++). The UI should parse `debug-map.json`,
build a hierarchical variable tree, and use `(program_idx, var_idx)` addressing for variable
reads and writes.

## Prerequisites

- Phase 3 (debug-map.json format, Modbus protocol v2)
- Phase 4 (IPC bridge for reading debug-map.json)

## Step 5.1: New Debug Map Parser

**File to modify**: `src/frontend/utils/debug-parser.ts`

Add `parseDebugMapV2()` alongside the existing `parseDebugVariables()` (which parses debug.c).

```typescript
// ----- Types for debug-map.json (Protocol v2) -----

export interface DebugMapV2 {
  version: 2
  md5: string
  commonTicktimeNs: number
  programs: DebugMapProgram[]
}

export interface DebugMapProgram {
  index: number
  instanceName: string
  programType: string
  intervalNs: number
  vars: DebugMapVariable[]
}

export interface DebugMapVariable {
  index: number
  name: string
  type: string
  typeTag: string
  size: number
  location?: string         // e.g., "%QW0" for located variables
  isArray?: boolean
  dimensions?: number[]     // e.g., [100] for ARRAY[0..99]
  isStruct?: boolean
  fields?: DebugMapVariable[]
}

// ----- Reference type for hierarchical addressing -----

export interface DebugVarRef {
  programIdx: number
  varIdx: number
  elementIdx?: number       // For array elements (omit for scalars)
}

// ----- Parser -----

export function parseDebugMapV2(jsonContent: string): DebugMapV2 {
  const raw = JSON.parse(jsonContent)

  if (raw.version !== 2) {
    throw new Error(`Unsupported debug map version: ${raw.version}`)
  }

  return raw as DebugMapV2
}

// ----- Existing functions (unchanged) -----
// export function parseDebugVariables(content: string): DebugVariableEntry[]
// export function parseDebugData(content: string): ParsedDebugData
```

## Step 5.2: Update Variable Ref Map Builder

**File to modify**: `src/frontend/utils/debugger-session.ts`

Add a function that builds the variable reference map from `DebugMapV2`. This maps composite
keys (used by the variable tree UI) to `DebugVarRef` objects.

```typescript
/**
 * Build a variable reference map from debug-map.json (protocol v2).
 * Maps composite keys (e.g., "instance0.counter") to DebugVarRef objects.
 */
export function buildVariableRefMapV2(
  debugMap: DebugMapV2,
): Map<string, DebugVarRef> {
  const refMap = new Map<string, DebugVarRef>()

  for (const program of debugMap.programs) {
    const progPrefix = program.instanceName

    for (const variable of program.vars) {
      const key = `${progPrefix}.${variable.name}`

      refMap.set(key, {
        programIdx: program.index,
        varIdx: variable.index,
      })

      // For arrays: also register element keys
      if (variable.isArray && variable.dimensions) {
        const totalElements = variable.dimensions.reduce((a, b) => a * b, 1)
        for (let elem = 0; elem < totalElements; elem++) {
          refMap.set(`${key}[${elem}]`, {
            programIdx: program.index,
            varIdx: variable.index,
            elementIdx: elem,
          })
        }
      }

      // For structs: register field keys
      if (variable.isStruct && variable.fields) {
        for (const field of variable.fields) {
          refMap.set(`${key}.${field.name}`, {
            programIdx: program.index,
            varIdx: variable.index,
            // Struct field access: var_idx points to the struct, field offset computed at runtime
          })
        }
      }
    }
  }

  return refMap
}
```

## Step 5.3: Update Debugger Port Interface

**File to modify**: `src/middleware/shared/ports/debugger-port.ts`

The debugger port needs to support both v1 (flat index) and v2 (hierarchical) protocols.

```typescript
// Add to existing types:
export { DebugVarRef } from '@utils/debug-parser'

// The port interface methods are updated to accept both ref types:
export interface DebuggerPort {
  // ... existing methods ...

  /**
   * Read variable values (protocol v2 - hierarchical).
   * Falls back to flat index for v1 targets.
   */
  getVariablesList(refs: DebugVarRef[]): Promise<DebugVariableResult>

  /**
   * Force/unforce a variable (protocol v2 - hierarchical).
   */
  setVariable(ref: DebugVarRef, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult>

  /**
   * Read the debug map file (protocol v2).
   * Returns null if debug-map.json doesn't exist (v1 target).
   */
  readDebugMap(projectPath: string, boardTarget: string): Promise<DebugMapV2 | null>
}
```

## Step 5.4: Update Debug Tree Builder

**File to modify**: `src/frontend/utils/debug-tree-builder.ts`

Add the ability to build the debug variable tree from `DebugMapV2`. The tree structure matches
what the UI expects but is built from the new hierarchical format.

Key improvement: **arrays appear as single expandable nodes** instead of being pre-expanded
into individual entries. When the user clicks to expand an array, the UI generates child
nodes on-demand and requests their values individually.

```typescript
/**
 * Build debug tree from debug-map.json (protocol v2).
 * Arrays are NOT pre-expanded -- they appear as single nodes.
 */
export function buildDebugTreeV2(
  debugMap: DebugMapV2,
  pous: PLCPou[],
): Map<string, DebugTreeNode> {
  const tree = new Map<string, DebugTreeNode>()

  for (const program of debugMap.programs) {
    const progKey = program.instanceName

    // Program root node
    tree.set(progKey, {
      key: progKey,
      name: program.instanceName,
      type: 'program',
      children: [],
    })

    for (const variable of program.vars) {
      const varKey = `${progKey}.${variable.name}`

      const node: DebugTreeNode = {
        key: varKey,
        name: variable.name,
        type: variable.isArray ? 'array' : variable.isStruct ? 'struct' : 'scalar',
        dataType: variable.type,
        typeTag: variable.typeTag,
        size: variable.size,
        ref: { programIdx: program.index, varIdx: variable.index },
      }

      if (variable.isArray && variable.dimensions) {
        // Array node: children are generated lazily when expanded
        node.arrayDimensions = variable.dimensions
        node.childCount = variable.dimensions.reduce((a, b) => a * b, 1)
        node.lazyChildren = true  // Don't generate child nodes yet
      }

      if (variable.isStruct && variable.fields) {
        // Struct node: children are the fields
        node.children = variable.fields.map(field => ({
          key: `${varKey}.${field.name}`,
          name: field.name,
          type: 'scalar',
          dataType: field.type,
          typeTag: field.typeTag,
          size: field.size,
          ref: { programIdx: program.index, varIdx: variable.index },
        }))
      }

      tree.set(varKey, node)
    }
  }

  return tree
}

/**
 * Generate child nodes for a lazy array node (called when user expands the array).
 */
export function expandArrayNode(
  parentNode: DebugTreeNode,
): DebugTreeNode[] {
  if (!parentNode.arrayDimensions || !parentNode.ref) return []

  const totalElements = parentNode.arrayDimensions.reduce((a, b) => a * b, 1)
  const children: DebugTreeNode[] = []

  for (let i = 0; i < totalElements; i++) {
    children.push({
      key: `${parentNode.key}[${i}]`,
      name: `[${i}]`,
      type: 'scalar',
      dataType: parentNode.typeTag ?? parentNode.dataType,
      size: parentNode.size,
      ref: {
        programIdx: parentNode.ref.programIdx,
        varIdx: parentNode.ref.varIdx,
        elementIdx: i,
      },
    })
  }

  return children
}
```

## Step 5.5: Update Debug Session Hook

**File to modify**: `src/frontend/hooks/useDebugSession.ts`

The debug session hook orchestrates the connection between the editor and the target device.
It needs to detect the protocol version and use the appropriate parser.

```typescript
// In the connect/start function:
async function startDebugSession(projectPath: string, boardTarget: string) {
  // 1. Try to read debug-map.json (protocol v2)
  const debugMap = await debuggerPort.readDebugMap(projectPath, boardTarget)

  if (debugMap) {
    // Protocol v2: hierarchical addressing
    setDebugProtocolVersion(2)
    const refMap = buildVariableRefMapV2(debugMap)
    setDebugVariableIndexes(refMap)
    const tree = buildDebugTreeV2(debugMap, projectData.pous)
    setDebugVariableTree(tree)
    setDebugMd5(debugMap.md5)
  } else {
    // Protocol v1: fall back to debug.c parsing (legacy)
    const debugFile = await debuggerPort.readDebugFile(projectPath, boardTarget)
    if (debugFile) {
      setDebugProtocolVersion(1)
      const variables = parseDebugVariables(debugFile)
      // ... existing v1 tree building logic
    }
  }

  // 2. Connect to target (unchanged)
  await debuggerPort.connect(config)

  // 3. Verify MD5 match (unchanged in concept, uses new MD5)
  const runtimeMd5 = await debuggerPort.verifyMd5(debugMd5, config)
  if (!runtimeMd5.match) {
    setDebugMd5Mismatch(true)
  }

  // 4. Start polling (see Step 5.7)
}
```

## Step 5.6: Update Workspace Store

**File to modify**: `src/frontend/store/slices/workspace/types.ts`

```typescript
export interface WorkspaceState {
  // ... existing fields ...

  /** Debug protocol version: 1 = flat index (MatIEC), 2 = hierarchical (STruC++) */
  debugProtocolVersion: 1 | 2

  /** Variable indexes: DebugVarRef for v2, number for v1 */
  debugVariableIndexes: Map<string, DebugVarRef | number>

  // ... rest unchanged
}
```

**File to modify**: `src/frontend/store/slices/workspace/slice.ts`

Add actions:
```typescript
setDebugProtocolVersion: (version: 1 | 2) => void
```

## Step 5.7: Update Debug Polling

**File to modify**: `src/frontend/hooks/useDebugPolling.ts`

The polling hook needs to handle both protocols:

```typescript
// In the polling function:
async function pollVariables() {
  const visibleVarKeys = getVisibleVariableKeys()  // from scroll position
  const protocolVersion = useStore.getState().debugProtocolVersion
  const indexes = useStore.getState().debugVariableIndexes

  if (protocolVersion === 2) {
    // Collect DebugVarRef objects for visible variables
    const refs: DebugVarRef[] = visibleVarKeys
      .map(key => indexes.get(key))
      .filter((ref): ref is DebugVarRef => ref !== undefined && typeof ref !== 'number')

    const result = await debuggerPort.getVariablesList(refs)
    // Update variable values in store...

  } else {
    // Legacy v1: flat indices
    const flatIndexes: number[] = visibleVarKeys
      .map(key => indexes.get(key))
      .filter((idx): idx is number => typeof idx === 'number')

    const result = await debuggerPort.getVariablesList(
      flatIndexes.map(idx => ({ programIdx: 0, varIdx: idx })),
    )
    // Update variable values in store...
  }
}
```

## Step 5.8: Update Debugger Adapter

**File to modify**: `src/middleware/adapters/editor/debugger-adapter.ts`

The adapter translates port calls into IPC bridge calls:

```typescript
async getVariablesList(refs: DebugVarRef[]): Promise<DebugVariableResult> {
  // Encode refs into the format expected by the main process Modbus client
  return await window.bridge.debuggerGetVariablesList(refs)
}

async setVariable(ref: DebugVarRef, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
  return await window.bridge.debuggerSetVariable(ref, force, valueBuffer)
}

async readDebugMap(projectPath: string, boardTarget: string): Promise<DebugMapV2 | null> {
  const result = await window.bridge.debuggerReadDebugMap(projectPath, boardTarget)
  if (!result.success || !result.content) return null
  return parseDebugMapV2(result.content)
}
```

## Step 5.9: Update Variable Force Dialog

The force variable dialog needs to work with `DebugVarRef` instead of flat indices:

```typescript
// When user clicks "Force Variable" on a variable in the tree:
async function handleForceVariable(varKey: string, value: Uint8Array) {
  const ref = debugVariableIndexes.get(varKey)
  if (!ref || typeof ref === 'number') {
    // v1 legacy path
    await debuggerPort.setVariable({ programIdx: 0, varIdx: ref as number }, true, value)
  } else {
    // v2 hierarchical path
    await debuggerPort.setVariable(ref, true, value)
  }
}
```

## Design Notes

### Lazy Array Expansion

In the current system, arrays are pre-expanded in `debug.c`, so the variable tree shows all
elements immediately. With the new system, arrays appear as a single node. When expanded:

1. `expandArrayNode()` generates child nodes with `elementIdx` in their `DebugVarRef`
2. The polling hook requests values for visible child nodes
3. Only visible elements are fetched (windowed rendering)

For a 10,000-element array, this means reading ~20-50 elements at a time (visible in the scroll
viewport) instead of all 10,000.

### Backward Compatibility

The v1 path is preserved for:
- MatIEC-compiled boards (compiler_backend: "matiec" in hals.json)
- Runtime v3 targets
- Runtime v4 targets that haven't been updated to Phase 8

The protocol version detection is automatic based on which debug file exists.

### Struct/FB Instance Deep Access

For struct fields and FB instance variables:
- The debug-map.json lists fields under the parent variable
- The tree builder creates nested nodes
- The debug protocol accesses fields via the parent var_idx + field offset
- The exact mechanism depends on STruC++ struct memory layout (IECVar-wrapped fields)

## Testing Strategy

1. **Variable tree building**: Parse a debug-map.json with scalars, arrays, and structs
   - Verify tree has correct hierarchy
   - Verify arrays are single nodes (not expanded)
   - Verify expandArrayNode generates correct children

2. **Protocol detection**: Test with both debug.c and debug-map.json present/absent
   - Only debug.c -> v1
   - Only debug-map.json -> v2
   - Both present -> v2 takes priority

3. **Variable polling**: Connect to simulator, verify values update in real time
   - Scalar variables show correct values
   - Array elements show correct values when expanded
   - Forced variables show forced value (not hardware value)

4. **Force/unforce**: Force a variable, verify it stays forced through cycles

5. **Regression**: All existing debug tests pass for v1 targets

## Files Created/Modified

| File | Action |
|------|--------|
| `src/frontend/utils/debug-parser.ts` | Modified -- add DebugMapV2 types and parser |
| `src/frontend/utils/debugger-session.ts` | Modified -- add buildVariableRefMapV2() |
| `src/frontend/utils/debug-tree-builder.ts` | Modified -- add buildDebugTreeV2(), expandArrayNode() |
| `src/middleware/shared/ports/debugger-port.ts` | Modified -- DebugVarRef, updated signatures |
| `src/frontend/hooks/useDebugSession.ts` | Modified -- protocol detection |
| `src/frontend/hooks/useDebugPolling.ts` | Modified -- v2 polling path |
| `src/frontend/store/slices/workspace/types.ts` | Modified -- debugProtocolVersion |
| `src/frontend/store/slices/workspace/slice.ts` | Modified -- new actions |
| `src/middleware/adapters/editor/debugger-adapter.ts` | Modified -- v2 transport |
