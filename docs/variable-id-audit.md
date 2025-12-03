# Variable ID Audit - OpenPLC Editor

## Executive Summary

This document provides a comprehensive audit of all locations where variable IDs are currently used for linking variables to graphical elements in the OpenPLC Editor codebase. The audit was conducted as part of Phase 1 of the migration from UUID-based variable linking to name+type-based linking following IEC 61131-3 standards.

**Key Findings:**
- Variable IDs are optional in the schema (`z.string().optional()`)
- IDs are generated using `crypto.randomUUID()` during variable creation
- Primary usage is in graphical editors (Ladder, FBD) for block-variable linking
- XML generation already uses variable names, not IDs
- A dual lookup system exists (by row index OR by variable ID)
- Broken links are created with synthetic IDs (`broken-${nodeId}`)

---

## 1. Variable Schema Definitions

### 1.1 PLCVariableSchema
**File:** `src/types/PLC/open-plc.ts`  
**Lines:** 120-160

**Description:** Core variable type definition that includes an optional `id` field.

```typescript
const PLCVariableSchema = z.object({
  id: z.string().optional(),  // Line 121
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']).optional(),
  type: z.discriminatedUnion('definition', [...]),
  location: z.string(),
  initialValue: z.string().or(z.null()).optional(),
  documentation: z.string(),
  debug: z.boolean(),
})
```

**Usage Type:** Schema Definition  
**Classification:** Data Structure  
**Notes:** 
- ID field is **optional**, indicating the system was designed to potentially work without IDs
- No validation or uniqueness constraints on the ID field
- ID is not required for variable creation

### 1.2 PLCStructureVariableSchema
**File:** `src/types/PLC/open-plc.ts`  
**Lines:** 55-100

**Description:** Variable definition within structure data types, also includes optional `id` field.

```typescript
const PLCStructureVariableSchema = z.object({
  id: z.string().optional(),  // Line 56
  name: z.string(),
  type: z.discriminatedUnion('definition', [...]),
  initialValue: z.object({...}).optional(),
})
```

**Usage Type:** Schema Definition  
**Classification:** Data Structure  
**Notes:**
- Used for variables within user-defined structure types
- Same optional ID pattern as PLCVariableSchema

---

## 2. Variable Creation with UUID Generation

### 2.1 Local Variable Creation
**File:** `src/renderer/store/slices/project/slice.ts`  
**Lines:** 276-280

**Description:** UUID generation during local variable creation in POUs.

```typescript
variableToBeCreated.data = {
  ...variableToBeCreated.data,
  ...createVariableValidation(pou.data.variables, variableToBeCreated.data),
  id: variableToBeCreated.data.id ? variableToBeCreated.data.id : crypto.randomUUID(),  // Line 279
}
```

**Usage Type:** Creation  
**Classification:** ID Generation  
**Fallback Mechanism:** Only generates UUID if `id` is not already present  
**Notes:**
- Conditional generation: uses existing ID if present, otherwise generates new UUID
- Occurs in `createVariable` action for local scope
- Global variables do NOT receive IDs during creation (lines 250-265)

### 2.2 Autocomplete Variable Creation (Ladder)
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx`  
**Lines:** 169-185

**Description:** UUID generation when creating variables from autocomplete in ladder editor.

```typescript
const res = createVariable({
  data: {
    id: uuidv4(),  // Line 171 (using uuid library, equivalent to crypto.randomUUID())
    name: variableName,
    type: {...},
    class: 'local',
    location: '',
    documentation: '',
    debug: false,
  },
  scope: 'local',
  associatedPou: editor.meta.name,
})
```

**Usage Type:** Creation  
**Classification:** ID Generation  
**Notes:**
- Uses `uuid` library's `v4()` function
- Always generates new ID for autocomplete-created variables
- Similar pattern exists in FBD autocomplete

### 2.3 Additional UUID Generation Locations
**Files with `crypto.randomUUID()` usage:**
- `src/renderer/components/_atoms/graphical-editor/fbd/autocomplete/index.tsx`
- `src/renderer/store/slices/fbd/utils/index.ts`
- `src/renderer/store/slices/ladder/utils/index.ts`
- `src/utils/python/addPythonLocalVariables.ts`
- `src/utils/cpp/addCppLocalVariables.ts`

**Usage Type:** Creation  
**Classification:** ID Generation

---

## 3. Variable Lookup Utilities

### 3.1 Dual Lookup Function
**File:** `src/renderer/store/slices/project/utils/index.ts`  
**Lines:** 3-26

**Description:** Core utility function that supports looking up variables by EITHER row index OR variable ID.

```typescript
export const getVariableBasedOnRowIdOrVariableId = (
  variables: PLCVariable[] | Omit<PLCVariable, 'class'>[],
  rowId?: number,
  variableId?: string,
): PLCVariable | Omit<PLCVariable, 'class'> | null => {
  // Priority 1: Lookup by row index
  if (rowId !== undefined) {
    const variable = variables[rowId]  // Line 9
    if (!variable) return null
    return variable
  }

  // Priority 2: Lookup by variable ID
  if (variableId) {
    const variable = variables.find((variable) => variable.id === variableId)  // Line 17
    if (!variable) return null
    return variable
  }

  console.error('variableId or rowId not given')
  return null
}
```

**Usage Type:** Lookup  
**Classification:** Utility Function  
**Fallback Mechanism:** Row index takes priority over variable ID  
**Notes:**
- **Critical finding:** Row index lookup is prioritized over ID lookup
- This suggests the system was designed to work primarily with positional references
- ID lookup is a fallback mechanism
- Used extensively throughout the codebase (20+ call sites)

### 3.2 Lookup Usage in Project Actions
**File:** `src/renderer/store/slices/project/slice.ts`  
**Multiple locations:**

#### Update Variable (Global)
**Lines:** 320-324
```typescript
const variableToUpdate = getVariableBasedOnRowIdOrVariableId(
  project.data.configuration.resource.globalVariables,
  dataToBeUpdated.rowId,
  dataToBeUpdated.data.id,
)
```

#### Update Variable (Local)
**Lines:** 347-351
```typescript
const variableToUpdate = getVariableBasedOnRowIdOrVariableId(
  pou.data.variables,
  dataToBeUpdated.rowId,
  dataToBeUpdated.variableId,
)
```

#### Delete Variable
**Lines:** 462-466, 482-486
```typescript
const variable = getVariableBasedOnRowIdOrVariableId(
  project.data.configuration.resource.globalVariables,
  variableToBeDeleted.rowId,
  variableToBeDeleted.variableId,
)
```

#### Rearrange Variables
**Lines:** 510-514, 530
```typescript
const variableToBeRemoved = getVariableBasedOnRowIdOrVariableId(
  project.data.configuration.resource.globalVariables,
  rowId,
  variableId,
)
```

**Usage Type:** Lookup  
**Classification:** State Management  
**Notes:**
- All CRUD operations use this dual lookup pattern
- Row index is always provided when available
- Variable ID is used as fallback

---

## 4. Graphical Editor Block-Variable Linking

### 4.1 Block Node Data Structure
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/block.tsx`  
**Lines:** 34-48

**Description:** Data structure for blocks that includes `handleTableId` for tracking variable connections.

```typescript
export type LadderBlockConnectedVariables = {
  handleId: string
  handleTableId?: string  // Line 36 - References variable ID
  type: 'input' | 'output'
  variable: PLCVariable | undefined
}[]

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
  lockExecutionControl: boolean
  connectedVariables: LadderBlockConnectedVariables  // Line 45
  variable: { id?: string; name: string } | PLCVariable  // Line 46
  hasDivergence?: boolean
}
```

**Usage Type:** Linking  
**Classification:** Data Structure  
**Notes:**
- `handleTableId` stores the variable ID from the block variant's variable definition
- Used to track which variables are connected to which block handles
- The `variable` field can be either a full PLCVariable or a minimal object with optional ID

### 4.2 Variable Connection in Autocomplete
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx`  
**Lines:** 124-137

**Description:** Populates `handleTableId` when connecting variables to blocks via autocomplete.

```typescript
const connectedVariables: LadderBlockConnectedVariables = [
  ...(relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables.filter(
    (v) => v.type !== variableNode.data.variant || v.handleId !== (variableNode as VariableNode).data.block.handleId,
  ),
  {
    handleId: (variableNode as VariableNode).data.block.handleId,
    handleTableId: (relatedBlock.data as BlockNodeData<BlockVariant>).variant.variables.find(
      (v) => v.name === (variableNode as VariableNode).data.block.handleId,
    )?.id,  // Line 131-133 - Looks up ID from block variant definition
    type: (variableNode as VariableNode).data.variant,
    variable: variable,
  },
]
```

**Usage Type:** Linking  
**Classification:** Connection Management  
**Notes:**
- `handleTableId` is populated by finding the matching variable in the block variant's definition
- This creates a link between the block handle and the variable table
- Used for multi-input/output blocks

### 4.3 Block Divergence Detection
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/block.tsx`  
**Lines:** 627-773 (handleUpdateDivergence function)

**Description:** Uses `handleTableId` to maintain connections during library updates.

```typescript
const handleUpdateDivergence = () => {
  const { variables, rung, node, edges } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
    nodeId: id,
  })
  if (!rung || !node) return

  // ... divergence detection logic ...

  const connectedVariables: LadderBlockConnectedVariables = []
  data.connectedVariables.forEach((connectedVariable) => {
    const newVariable = newNodeVariables.find(
      (v) => v.id === connectedVariable.handleTableId,  // Line 714 - Uses handleTableId to find matching variable
    )
    if (newVariable) {
      connectedVariables.push({
        handleId: newVariable.name,
        handleTableId: newVariable.id,
        type: connectedVariable.type,
        variable: connectedVariable.variable,
      })
    }
  })
  // ... update node with new connections ...
}
```

**Usage Type:** Linking  
**Classification:** Divergence Management  
**Notes:**
- **Critical for library updates:** When a function block definition changes, this maintains variable connections
- Matches old connections to new block definition using `handleTableId`
- This is a key area where ID-based linking is actively used

### 4.4 Variable Node ID Comparison
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/block.tsx`  
**Lines:** 479-496

**Description:** Compares variable IDs to detect when variable table changes affect blocks.

```typescript
const variable = variables.selected
if (!variable) {
  setWrongVariable(true)
  return
}

if ((node.data as BasicNodeData).variable.id === variable.id) {  // Line 479 - ID comparison
  if ((node.data as BasicNodeData).variable.name !== variable.name) {
    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: node.id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable,
        },
      },
    })
    setWrongVariable(false)
    return
  }
}
```

**Usage Type:** Linking  
**Classification:** Synchronization  
**Notes:**
- Detects when a variable's name changes but ID remains the same
- Updates block to reflect new variable name
- Relies on ID stability across renames

---

## 5. Variable Component Connection

### 5.1 Variable Node Update on Table Changes
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/variable.tsx`  
**Lines:** 143-213

**Description:** Monitors variable table changes and updates variable nodes using ID comparison.

```typescript
useEffect(() => {
  const {
    node: variableNode,
    rung,
    variables,
  } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
    nodeId: id,
    variableName: variableValue,
  })
  if (!rung || !variableNode) return

  const variable = variables.selected
  if (!variable || !inputVariableRef) {
    setIsAVariable(false)
  } else {
    // if the variable is not the same as the one in the node, update the node
    if (variable.id !== (variableNode as VariableNode).data.variable.id) {  // Line 159 - ID comparison
      updateNode({...})
      updateRelatedNode(rung, variableNode as VariableNode, variable)
    }

    // if the variable is the same as the one in the node, update the node
    if (
      variable.id === (variableNode as VariableNode).data.variable.id &&  // Line 177 - ID comparison
      variable.name !== (variableNode as VariableNode).data.variable.name
    ) {
      updateNode({...})
      updateRelatedNode(rung, variableNode as VariableNode, variable)
    }
    // ... validation logic ...
  }
}, [pous])
```

**Usage Type:** Linking  
**Classification:** Synchronization  
**Notes:**
- Uses ID to detect when variable has changed
- Handles both variable replacement and variable rename scenarios
- Updates both the variable node and related block nodes

### 5.2 Update Related Block Node
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/variable.tsx`  
**Lines:** 95-128

**Description:** Updates block's `connectedVariables` array when variable changes.

```typescript
const updateRelatedNode = (rung: RungLadderState, variableNode: VariableNode, variable: PLCVariable) => {
  const relatedBlock = rung.nodes.find((node) => node.id === variableNode.data.block.id)
  if (!relatedBlock) {
    setInputError(true)
    return
  }

  const connectedVariables: LadderBlockConnectedVariables = [
    ...(relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables.filter(
      (v) => v.type !== variableNode.data.variant || v.handleId !== variableNode.data.block.handleId,
    ),
    {
      handleId: variableNode.data.block.handleId,
      handleTableId: (relatedBlock.data as BlockNodeData<BlockVariant>).variant.variables.find(
        (v) => v.name === variableNode.data.block.handleId,
      )?.id,  // Line 108-110 - Populates handleTableId
      type: variableNode.data.variant,
      variable,
    },
  ]

  updateNode({...})
}
```

**Usage Type:** Linking  
**Classification:** Connection Management  
**Notes:**
- Maintains `handleTableId` when updating connections
- Ensures block knows which variable is connected to which handle

---

## 6. Variable Renaming Logic

### 6.1 Rename with Broken Link Creation
**File:** `src/renderer/components/_molecules/variables-table/editable-cell.tsx`  
**Lines:** 124-265 (EditableNameCell onBlur)

**Description:** When user declines to propagate rename, creates broken links with synthetic IDs.

```typescript
const onBlur = async () => {
  // ... validation ...

  /* 1 ▸ which blocks use the variable? */
  const nodesUsingVarLadder = findNodesUsingVariable(ladderFlows, oldName)
  const nodesUsingVarFbd = findNodesUsingVariableFbd(fbdFlows, oldName)

  let shouldPropagate = true
  if (nodesUsingVarLadder.length || nodesUsingVarFbd.length) {
    shouldPropagate = await askRenameBlocks()
  }

  /* 2 ▸ IF NOT propagating, break the link before renaming */
  if (nodesUsingVarLadder.length && !shouldPropagate && language === 'ld') {
    addSnapshot(editor.meta.name)

    nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
      const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
      if (!rung || !node) return

      const variableClone = {
        ...(node.data as { variable: PLCVariable }).variable,
        id: `broken-${nodeId}`,  // Line 159 - Creates synthetic broken ID
        name: oldName,
      }

      updateNode({
        editorName: editor.meta.name,
        rungId,
        nodeId,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: variableClone,
            wrongVariable: true,
          },
        },
      })
    })
  }
  // ... similar logic for FBD ...
}
```

**Usage Type:** Linking  
**Classification:** Broken Link Management  
**Notes:**
- **Synthetic ID pattern:** `broken-${nodeId}` indicates a deliberately broken link
- Preserves old variable name in the node
- Sets `wrongVariable: true` flag for visual indication
- Same pattern used for FBD (lines 179-208)

### 6.2 Name-Based Variable Finding
**File:** `src/renderer/components/_molecules/variables-table/editable-cell.tsx`  
**Lines:** 90-106, 108-122

**Description:** Finds nodes using variables by **name** (case-insensitive), not ID.

```typescript
const findNodesUsingVariable = (ladderFlows: LadderFlowState['ladderFlows'], varName: string) => {
  const lower = varName.toLowerCase()
  const matches: { rungId: string; nodeId: string }[] = []

  ladderFlows.forEach((flow) =>
    flow.rungs.forEach((rung) =>
      rung.nodes.forEach((node) => {
        const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
        if (data?.name?.toLowerCase() === lower) {  // Line 98 - Name-based comparison
          matches.push({ rungId: rung.id, nodeId: node.id })
        }
      }),
    ),
  )

  return matches
}
```

**Usage Type:** Lookup  
**Classification:** Name-Based Search  
**Notes:**
- **Critical finding:** Variable rename detection uses NAME matching, not ID matching
- Case-insensitive comparison
- This suggests the system already has name-based lookup infrastructure

### 6.3 Propagate Rename to Blocks
**File:** `src/renderer/components/_molecules/variables-table/editable-cell.tsx`  
**Lines:** 220-239

**Description:** When user accepts propagation, updates variable name in all nodes.

```typescript
/* 4 ▸ If the user said YES, propagate the change to the blocks */
if (nodesUsingVarLadder.length && shouldPropagate && language === 'ld') {
  nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
    const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
    if (!rung || !node) return

    updateNode({
      editorName: editor.meta.name,
      rungId,
      nodeId,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },  // Line 233 - Updates name
          wrongVariable: false,
        },
      },
    })
  })
}
```

**Usage Type:** Linking  
**Classification:** Synchronization  
**Notes:**
- Updates only the name field, preserves other variable properties including ID
- Clears `wrongVariable` flag

---

## 7. XML Serialization

### 7.1 Ladder XML Generation - Contacts
**File:** `src/utils/PLC/xml-generator/codesys/language/ladder-xml.ts`  
**Lines:** 337-383

**Description:** XML generation uses variable **names**, not IDs.

```typescript
const contactToXML = (
  contact: ContactNode,
  rung: RungLadderState,
  offsetY: number = 0,
  leftRailId: string,
): ContactLadderXML => {
  // ... connection logic ...
  return {
    '@localId': contact.data.numericId,
    '@negated': contact.data.variant === 'negated',
    // ... other properties ...
    variable: contact.data.variable && contact.data.variable.name !== '' ? contact.data.variable.name : 'A',  // Line 381 - Uses NAME
  }
}
```

**Usage Type:** Serialization  
**Classification:** XML Export  
**Notes:**
- **Critical finding:** XML output uses variable names, not IDs
- IDs are never serialized to XML
- This validates that name-based linking is architecturally sound for compilation

### 7.2 Ladder XML Generation - Coils
**File:** `src/utils/PLC/xml-generator/codesys/language/ladder-xml.ts`  
**Lines:** 385-427

**Description:** Coil XML generation also uses variable names.

```typescript
const coilToXml = (coil: CoilNode, rung: RungLadderState, offsetY: number = 0, leftRailId: string): CoilLadderXML => {
  // ... connection logic ...
  return {
    '@localId': coil.data.numericId,
    // ... other properties ...
    variable: coil.data.variable && coil.data.variable.name !== '' ? coil.data.variable.name : 'A',  // Line 425 - Uses NAME
  }
}
```

**Usage Type:** Serialization  
**Classification:** XML Export

### 7.3 Ladder XML Generation - Blocks
**File:** `src/utils/PLC/xml-generator/codesys/language/ladder-xml.ts`  
**Lines:** 429-524

**Description:** Block XML generation uses variable names for input/output variables.

```typescript
const blockToXml = (
  block: BlockNode<BlockVariant>,
  rung: RungLadderState,
  offsetY: number = 0,
  leftRailId: string,
): BlockLadderXML => {
  // ... connection logic ...

  const inputVariables = block.data.variant.variables
    .filter((v) => v.class === 'input' || v.class === 'inOut')
    .map((variable, index) => {
      const variableNode = rung.nodes.find(
        (node) =>
          node.type === 'variable' &&
          (node as VariableNode).data.variant === 'input' &&
          (node as VariableNode).data.block.handleId === variable.name,
      ) as VariableNode | undefined

      return {
        '@formalParameter': variable.name,  // Line 476 - Uses variable NAME from block definition
        '#text': variableNode?.data.variable.name ?? '',  // Line 477 - Uses connected variable NAME
      }
    })

  const outputVariable = block.data.variant.variables
    .filter((v) => v.class === 'output')
    .map((variable) => {
      // ... similar pattern ...
      return {
        '@formalParameter': variable.name,  // Line 504 - Uses NAME
        '#text': variableNode?.data.variable.name ?? '',  // Line 505 - Uses NAME
      }
    })

  return {
    '@localId': block.data.numericId,
    '@typeName': block.data.variant.name,
    '@instanceName': block.data.variable && 'name' in block.data.variable ? block.data.variable.name : '',  // Line 508 - Uses NAME
    // ... other properties ...
    inputVariables,
    outputVariables: outputVariable,
  }
}
```

**Usage Type:** Serialization  
**Classification:** XML Export  
**Notes:**
- Block instance name uses variable name
- Input/output variable connections use names
- No IDs in XML output

---

## 8. Project Persistence

### 8.1 Project Save
**File:** `src/main/services/project-service/index.ts`  
**Lines:** 307-310 (approximate, based on onboarding guide)

**Description:** Projects are saved as JSON with variable IDs serialized.

**Usage Type:** Persistence  
**Classification:** File I/O  
**Notes:**
- Variables with IDs will have those IDs persisted to JSON
- Variables without IDs will be saved without ID field (since it's optional)
- No special handling or transformation of IDs during save

### 8.2 Project Load
**File:** `src/main/services/project-service/index.ts`

**Description:** Projects are loaded from JSON, IDs are preserved if present.

**Usage Type:** Persistence  
**Classification:** File I/O  
**Notes:**
- Existing projects may have variables with or without IDs
- Schema validation allows both cases (ID is optional)
- No migration or ID generation on load

---

## 9. Additional ID Usage Patterns

### 9.1 Variable Search in Graphical Editors
**File:** `src/renderer/components/_atoms/graphical-editor/ladder/utils/utils.ts`  
**Estimated lines:** Multiple locations (4 occurrences of `variable.id`)

**Description:** Utility functions for finding variables in ladder diagrams.

**Usage Type:** Lookup  
**Classification:** Utility Function  
**Notes:**
- Used for variable selection and highlighting
- Likely uses ID for quick lookups

### 9.2 Autocomplete Variable Selection
**File:** `src/renderer/components/_atoms/graphical-editor/autocomplete/index.tsx`  
**Estimated lines:** Multiple locations (2 occurrences of `variable.id`)

**Description:** Autocomplete component uses IDs for variable selection.

**Usage Type:** Lookup  
**Classification:** UI Component  
**Notes:**
- Dropdown selection likely uses ID as key
- Falls back to name if ID not present

### 9.3 FBD Editor Usage
**Files:**
- `src/renderer/components/_atoms/graphical-editor/fbd/block.tsx` (1 occurrence)
- `src/renderer/components/_atoms/graphical-editor/fbd/variable.tsx` (2 occurrences)
- `src/renderer/components/_atoms/graphical-editor/fbd/autocomplete/index.tsx` (3 occurrences)
- `src/renderer/components/_atoms/graphical-editor/fbd/utils/utils.ts` (4 occurrences)

**Description:** FBD editor has similar ID usage patterns as Ladder editor.

**Usage Type:** Linking, Lookup  
**Classification:** Graphical Editor  
**Notes:**
- Same patterns as Ladder: block-variable linking, autocomplete, synchronization
- Should be migrated in parallel with Ladder editor

### 9.4 Variables Editor
**File:** `src/renderer/components/_organisms/variables-editor/index.tsx`  
**Estimated lines:** 1 occurrence of `variable.id`

**Description:** Variables table editor uses IDs for row identification.

**Usage Type:** Lookup  
**Classification:** UI Component  
**Notes:**
- Likely uses ID as React key for table rows
- May need to switch to using row index or composite key

---

## 10. Summary of ID Usage by Category

### 10.1 By Usage Type

| Usage Type | Count | Critical? | Notes |
|------------|-------|-----------|-------|
| Schema Definition | 2 | No | Optional field, no constraints |
| Creation/Generation | 8+ | No | Conditional, only if not present |
| Lookup | 15+ | **Yes** | Dual system with row index fallback |
| Linking | 10+ | **Yes** | Block-variable connections, divergence |
| Synchronization | 5+ | **Yes** | Variable table changes → diagram updates |
| Serialization | 0 | No | XML uses names, not IDs |
| Persistence | 2 | No | Pass-through, no special handling |

### 10.2 By File Category

| Category | File Count | ID Usage Intensity |
|----------|------------|-------------------|
| Type Definitions | 1 | Low (schema only) |
| State Management | 2 | High (CRUD operations) |
| Graphical Editors (Ladder) | 8+ | **Very High** (linking, sync) |
| Graphical Editors (FBD) | 5+ | **Very High** (linking, sync) |
| UI Components | 5+ | Medium (display, selection) |
| Utilities | 3+ | Medium (lookup helpers) |
| XML Generation | 1 | **None** (uses names) |
| Services | 1 | Low (pass-through) |

### 10.3 Critical Migration Areas

**High Priority (Core Functionality):**
1. **Block-variable linking** (`handleTableId` mechanism)
2. **Variable lookup utilities** (dual row/ID system)
3. **Divergence detection** (library update handling)
4. **Variable synchronization** (table ↔ diagram)

**Medium Priority (User Experience):**
5. **Autocomplete** (variable selection)
6. **Variable renaming** (broken link creation)
7. **Variables table** (row identification)

**Low Priority (Already Name-Based):**
8. **XML generation** (already uses names)
9. **Project persistence** (pass-through)

---

## 11. Fallback Mechanisms Already in Place

### 11.1 Row Index Priority
The `getVariableBasedOnRowIdOrVariableId` function prioritizes row index over ID, suggesting the system was designed to work primarily with positional references.

### 11.2 Optional ID Field
The schema defines ID as optional, indicating the system was architected to potentially work without IDs.

### 11.3 Name-Based Rename Detection
Variable rename detection uses name matching (case-insensitive), not ID matching, showing existing name-based infrastructure.

### 11.4 XML Uses Names
The fact that XML generation uses names exclusively validates that name-based linking is architecturally sound for the compilation pipeline.

---

## 12. Recommendations for Phase 2

Based on this audit, the following areas should be prioritized in Phase 2 (Implementation):

1. **Replace `handleTableId` with name+type composite key** in block-variable linking
2. **Refactor `getVariableBasedOnRowIdOrVariableId`** to use name+type lookup
3. **Update divergence detection** to match variables by name+type instead of ID
4. **Modify synchronization logic** to use name+type comparison
5. **Update autocomplete** to use name+type for variable selection
6. **Revise broken link creation** to use name+type instead of synthetic IDs
7. **Add migration logic** for existing projects with IDs

---

## Appendix A: Files with Variable ID Usage

Complete list of files containing `variable.id` references (20 files total):

1. `src/types/PLC/open-plc.ts` (schema definitions)
2. `src/renderer/store/slices/project/slice.ts` (CRUD operations)
3. `src/renderer/store/slices/project/utils/index.ts` (lookup utility)
4. `src/renderer/components/_atoms/graphical-editor/ladder/block.tsx` (linking)
5. `src/renderer/components/_atoms/graphical-editor/ladder/variable.tsx` (synchronization)
6. `src/renderer/components/_atoms/graphical-editor/ladder/contact.tsx` (linking)
7. `src/renderer/components/_atoms/graphical-editor/ladder/coil.tsx` (linking)
8. `src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx` (creation)
9. `src/renderer/components/_atoms/graphical-editor/ladder/utils/utils.ts` (utilities)
10. `src/renderer/components/_atoms/graphical-editor/fbd/block.tsx` (linking)
11. `src/renderer/components/_atoms/graphical-editor/fbd/variable.tsx` (synchronization)
12. `src/renderer/components/_atoms/graphical-editor/fbd/autocomplete/index.tsx` (creation)
13. `src/renderer/components/_atoms/graphical-editor/fbd/utils/utils.ts` (utilities)
14. `src/renderer/components/_atoms/graphical-editor/autocomplete/index.tsx` (UI)
15. `src/renderer/components/_molecules/variables-table/editable-cell.tsx` (renaming)
16. `src/renderer/components/_molecules/graphical-editor/ladder/rung/body.tsx` (diagram)
17. `src/renderer/components/_molecules/graphical-editor/fbd/index.tsx` (diagram)
18. `src/renderer/components/_organisms/variables-editor/index.tsx` (table)
19. `src/renderer/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx` (UI)
20. `src/renderer/components/_organisms/modals/delete-confirmation-modal.tsx` (UI)

---

## Appendix B: Files with UUID Generation

Complete list of files containing `crypto.randomUUID()` or `uuidv4()` (12 files total):

1. `src/renderer/store/slices/project/slice.ts`
2. `src/renderer/store/slices/fbd/utils/index.ts`
3. `src/renderer/store/slices/ladder/utils/index.ts`
4. `src/renderer/components/_atoms/graphical-editor/ladder/block.tsx`
5. `src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx`
6. `src/renderer/components/_atoms/graphical-editor/fbd/block.tsx`
7. `src/renderer/components/_atoms/graphical-editor/fbd/autocomplete/index.tsx`
8. `src/renderer/components/_organisms/workspace-activity-bar/default.tsx`
9. `src/renderer/components/_features/[workspace]/editor/monaco/index.tsx`
10. `src/renderer/screens/workspace-screen.tsx`
11. `src/utils/python/addPythonLocalVariables.ts`
12. `src/utils/cpp/addCppLocalVariables.ts`

---

**Document Version:** 1.0  
**Date:** 2025-10-22  
**Author:** Devin (AI Assistant)  
**Status:** Complete
