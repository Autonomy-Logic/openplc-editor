# Name+Type-Based Variable Linking Design

## Executive Summary

This document defines the technical design for migrating from UUID-based variable linking to name+type-based linking in the OpenPLC Editor, following IEC 61131-3 standards. The design addresses all six core linking rules specified in the migration plan and provides a clear implementation path for Phase 2.

**Design Principles:**
- Case-insensitive name matching (IEC 61131-3 standard)
- Type compatibility validation
- Automatic variable creation for Function Blocks
- User-controlled reference updates on rename
- Broken link detection on type changes
- Backward compatibility with existing projects

---

## 1. Core Linking Rules

The new system must satisfy these requirements:

### Rule 1: Element-Variable Association
Elements (contacts, coils, function block instances, variable boxes) must be associated with a variable.

### Rule 2: Name+Type Matching
Variables are linked to elements based on **case-insensitive name AND type matching** (IEC 61131-3 standard).

### Rule 3: Function Block Instantiation
When a Function Block is added, a variable is automatically created (Function Blocks must be instantiated).

### Rule 4: Automatic Cleanup
If a Function Block is deleted and no other Function Block uses its variable, the variable should be deleted.

### Rule 5: Rename Propagation
Variable renaming should prompt user to update references:
- If declined: links break
- If accepted: find-and-replace all references

### Rule 6: Type Change Validation
Variable type changes should recheck all elements using that variable - break links if type no longer matches.

---

## 2. Composite Key Data Structure

### 2.1 Variable Reference Type

```typescript
/**
 * Composite key for identifying a variable reference in the system.
 * Replaces the previous UUID-based identification.
 */
export type VariableReference = {
  /** POU name where the variable is defined (for scoping) */
  pouName: string
  
  /** Variable name (case-insensitive matching) */
  variableName: string
  
  /** Variable type for compatibility checking */
  variableType: PLCVariable['type']
}

/**
 * Normalized form for lookups and comparisons.
 * Names are converted to lowercase for case-insensitive matching.
 */
export type NormalizedVariableReference = {
  pouName: string  // lowercase
  variableName: string  // lowercase
  variableType: PLCVariable['type']
}
```

### 2.2 Variable Scope Handling

```typescript
/**
 * Scope determines where to search for variables.
 */
export type VariableScope = 'local' | 'global'

/**
 * Extended reference that includes scope information.
 */
export type ScopedVariableReference = VariableReference & {
  scope: VariableScope
}
```

### 2.3 Block-Variable Connection

```typescript
/**
 * Replaces the current LadderBlockConnectedVariables type.
 * Removes handleTableId (ID-based) and uses name+type instead.
 */
export type BlockConnectedVariable = {
  /** Handle name on the block (e.g., "EN", "IN1", "OUT") */
  handleName: string
  
  /** Direction of the connection */
  type: 'input' | 'output'
  
  /** Reference to the connected variable (name+type) */
  variableRef: VariableReference | null
  
  /** Cached variable data for performance (updated on sync) */
  variable: PLCVariable | undefined
}

export type BlockConnectedVariables = BlockConnectedVariable[]
```

### 2.4 Element Variable Association

```typescript
/**
 * Replaces the current variable field in node data.
 * Used for contacts, coils, and block instances.
 */
export type ElementVariableAssociation = {
  /** Variable reference (name+type) */
  ref: VariableReference
  
  /** Cached variable data (updated on sync) */
  variable: PLCVariable | undefined
  
  /** Validation state */
  isValid: boolean
  validationError?: string
}
```

---

## 3. Type Compatibility System

### 3.1 Type Comparison Logic

```typescript
/**
 * Type compatibility result.
 */
export type TypeCompatibility = {
  isCompatible: boolean
  reason?: string
}

/**
 * Checks if a variable type is compatible with an expected type.
 * Handles base types, derived types, user-defined types, and arrays.
 */
export function checkTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedType: PLCVariable['type'] | string,
  dataTypes: PLCDataType[],
): TypeCompatibility {
  // Case 1: Expected type is a string (simple type name)
  if (typeof expectedType === 'string') {
    return checkSimpleTypeCompatibility(variableType, expectedType, dataTypes)
  }
  
  // Case 2: Expected type is a full type object
  return checkComplexTypeCompatibility(variableType, expectedType, dataTypes)
}

/**
 * Simple type compatibility (e.g., "BOOL", "INT", "MyFunctionBlock")
 */
function checkSimpleTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedTypeName: string,
  dataTypes: PLCDataType[],
): TypeCompatibility {
  const varTypeName = getTypeName(variableType)
  const expectedNormalized = expectedTypeName.toUpperCase()
  const varNormalized = varTypeName.toUpperCase()
  
  // Direct match
  if (varNormalized === expectedNormalized) {
    return { isCompatible: true }
  }
  
  // Check if expected type is a user-defined type
  const userType = dataTypes.find(dt => dt.name.toUpperCase() === expectedNormalized)
  if (userType) {
    // For structures and enums, check if variable type matches
    if (variableType.definition === 'user-data-type' && 
        variableType.value.toUpperCase() === expectedNormalized) {
      return { isCompatible: true }
    }
  }
  
  return {
    isCompatible: false,
    reason: `Type mismatch: expected ${expectedTypeName}, got ${varTypeName}`
  }
}

/**
 * Complex type compatibility (full type objects)
 */
function checkComplexTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedType: PLCVariable['type'],
  dataTypes: PLCDataType[],
): TypeCompatibility {
  // Definition must match
  if (variableType.definition !== expectedType.definition) {
    return {
      isCompatible: false,
      reason: `Definition mismatch: expected ${expectedType.definition}, got ${variableType.definition}`
    }
  }
  
  // Value must match (case-insensitive)
  const varValue = variableType.value.toUpperCase()
  const expectedValue = expectedType.value.toUpperCase()
  
  if (varValue !== expectedValue) {
    return {
      isCompatible: false,
      reason: `Type mismatch: expected ${expectedType.value}, got ${variableType.value}`
    }
  }
  
  // For arrays, check dimensions
  if (variableType.definition === 'array' && expectedType.definition === 'array') {
    // Array dimension checking would go here
    // For now, we consider arrays compatible if base types match
  }
  
  return { isCompatible: true }
}

/**
 * Extract type name from a type object.
 */
function getTypeName(type: PLCVariable['type']): string {
  return type.value
}
```

### 3.2 Contact/Coil Type Restrictions

```typescript
/**
 * Contacts and coils require BOOL type.
 */
export function validateContactCoilType(variableType: PLCVariable['type']): TypeCompatibility {
  const typeName = getTypeName(variableType).toUpperCase()
  
  if (typeName === 'BOOL') {
    return { isCompatible: true }
  }
  
  return {
    isCompatible: false,
    reason: 'Contacts and coils require BOOL type variables'
  }
}
```

### 3.3 Block Input/Output Type Validation

```typescript
/**
 * Validates that a variable matches a block's input/output type.
 */
export function validateBlockConnectionType(
  variableType: PLCVariable['type'],
  blockVariableType: BlockVariant['variables'][0]['type'],
  dataTypes: PLCDataType[],
): TypeCompatibility {
  const expectedType = {
    definition: blockVariableType.definition as PLCVariable['type']['definition'],
    value: blockVariableType.value,
  }
  
  return checkComplexTypeCompatibility(variableType, expectedType, dataTypes)
}
```

---

## 4. Variable Lookup System

### 4.1 Lookup by Name+Type

```typescript
/**
 * Finds a variable by name and type within a scope.
 * Replaces getVariableBasedOnRowIdOrVariableId.
 */
export function findVariableByNameAndType(
  variables: PLCVariable[],
  variableName: string,
  expectedType?: PLCVariable['type'] | string,
  dataTypes?: PLCDataType[],
): PLCVariable | null {
  const normalizedName = variableName.toLowerCase()
  
  // Find all variables with matching name (case-insensitive)
  const matchingVariables = variables.filter(
    v => v.name.toLowerCase() === normalizedName
  )
  
  // If no type specified, return first match
  if (!expectedType) {
    return matchingVariables[0] || null
  }
  
  // If type specified, find compatible match
  for (const variable of matchingVariables) {
    const compatibility = checkTypeCompatibility(
      variable.type,
      expectedType,
      dataTypes || []
    )
    
    if (compatibility.isCompatible) {
      return variable
    }
  }
  
  return null
}

/**
 * Finds a variable by reference (name+type+scope).
 */
export function findVariableByReference(
  ref: VariableReference,
  projectData: PLCProjectData,
): PLCVariable | null {
  // Determine scope
  const pou = projectData.pous.find(p => p.data.name === ref.pouName)
  
  if (!pou) {
    return null
  }
  
  // Search in local variables
  const localVar = findVariableByNameAndType(
    pou.data.variables,
    ref.variableName,
    ref.variableType,
    projectData.dataTypes
  )
  
  if (localVar) {
    return localVar
  }
  
  // Search in global variables
  return findVariableByNameAndType(
    projectData.configuration.resource.globalVariables,
    ref.variableName,
    ref.variableType,
    projectData.dataTypes
  )
}
```

### 4.2 Scoped Lookup

```typescript
/**
 * Finds a variable with explicit scope control.
 */
export function findVariableInScope(
  variableName: string,
  scope: VariableScope,
  pouName: string,
  projectData: PLCProjectData,
  expectedType?: PLCVariable['type'] | string,
): PLCVariable | null {
  if (scope === 'global') {
    return findVariableByNameAndType(
      projectData.configuration.resource.globalVariables,
      variableName,
      expectedType,
      projectData.dataTypes
    )
  }
  
  // Local scope
  const pou = projectData.pous.find(p => p.data.name === pouName)
  if (!pou) {
    return null
  }
  
  return findVariableByNameAndType(
    pou.data.variables,
    variableName,
    expectedType,
    projectData.dataTypes
  )
}
```

### 4.3 Uniqueness Validation

```typescript
/**
 * Checks if a variable name is unique within its scope.
 * IEC 61131-3 requires case-insensitive uniqueness.
 */
export function isVariableNameUnique(
  variableName: string,
  scope: VariableScope,
  pouName: string,
  projectData: PLCProjectData,
  excludeVariable?: PLCVariable,
): boolean {
  const normalizedName = variableName.toLowerCase()
  
  const variables = scope === 'global'
    ? projectData.configuration.resource.globalVariables
    : projectData.pous.find(p => p.data.name === pouName)?.data.variables || []
  
  const conflicts = variables.filter(v => 
    v.name.toLowerCase() === normalizedName &&
    v !== excludeVariable
  )
  
  return conflicts.length === 0
}
```

---

## 5. Reference Validation and Broken Link Detection

### 5.1 Validation Result Type

```typescript
/**
 * Result of validating a variable reference.
 */
export type ValidationResult = {
  isValid: boolean
  variable?: PLCVariable
  error?: string
  errorType?: 'not-found' | 'type-mismatch' | 'scope-error'
}
```

### 5.2 Reference Validation

```typescript
/**
 * Validates a variable reference and returns the variable if valid.
 */
export function validateVariableReference(
  ref: VariableReference,
  projectData: PLCProjectData,
): ValidationResult {
  const variable = findVariableByReference(ref, projectData)
  
  if (!variable) {
    return {
      isValid: false,
      error: `Variable '${ref.variableName}' not found in POU '${ref.pouName}'`,
      errorType: 'not-found'
    }
  }
  
  // Check type compatibility
  const compatibility = checkTypeCompatibility(
    variable.type,
    ref.variableType,
    projectData.dataTypes
  )
  
  if (!compatibility.isCompatible) {
    return {
      isValid: false,
      variable,
      error: compatibility.reason,
      errorType: 'type-mismatch'
    }
  }
  
  return {
    isValid: true,
    variable
  }
}
```

### 5.3 Broken Link Detection

```typescript
/**
 * Finds all broken references in a POU's graphical diagram.
 */
export function findBrokenReferences(
  pouName: string,
  projectData: PLCProjectData,
  ladderFlows: LadderFlowState['ladderFlows'],
): BrokenReference[] {
  const brokenRefs: BrokenReference[] = []
  
  const flow = ladderFlows.find(f => f.name === pouName)
  if (!flow) return brokenRefs
  
  flow.rungs.forEach(rung => {
    rung.nodes.forEach(node => {
      // Check contacts and coils
      if (node.type === 'contact' || node.type === 'coil') {
        const data = node.data as { variable?: ElementVariableAssociation }
        if (data.variable?.ref) {
          const validation = validateVariableReference(data.variable.ref, projectData)
          if (!validation.isValid) {
            brokenRefs.push({
              nodeId: node.id,
              rungId: rung.id,
              elementType: node.type,
              ref: data.variable.ref,
              error: validation.error!,
              errorType: validation.errorType!
            })
          }
        }
      }
      
      // Check blocks
      if (node.type === 'block') {
        const data = node.data as BlockNodeData<BlockVariant>
        
        // Check instance variable
        if (data.variable?.ref) {
          const validation = validateVariableReference(data.variable.ref, projectData)
          if (!validation.isValid) {
            brokenRefs.push({
              nodeId: node.id,
              rungId: rung.id,
              elementType: 'block-instance',
              ref: data.variable.ref,
              error: validation.error!,
              errorType: validation.errorType!
            })
          }
        }
        
        // Check connected variables
        data.connectedVariables?.forEach(conn => {
          if (conn.variableRef) {
            const validation = validateVariableReference(conn.variableRef, projectData)
            if (!validation.isValid) {
              brokenRefs.push({
                nodeId: node.id,
                rungId: rung.id,
                elementType: 'block-connection',
                handleName: conn.handleName,
                ref: conn.variableRef,
                error: validation.error!,
                errorType: validation.errorType!
              })
            }
          }
        })
      }
    })
  })
  
  return brokenRefs
}

export type BrokenReference = {
  nodeId: string
  rungId: string
  elementType: 'contact' | 'coil' | 'block-instance' | 'block-connection'
  handleName?: string
  ref: VariableReference
  error: string
  errorType: 'not-found' | 'type-mismatch' | 'scope-error'
}
```

---

## 6. Variable Lifecycle Management

### 6.1 Automatic Function Block Variable Creation

```typescript
/**
 * Creates a variable for a function block instance.
 * Implements Rule 3: Function Blocks must be instantiated.
 */
export function createFunctionBlockVariable(
  blockName: string,
  blockType: string,
  pouName: string,
  projectData: PLCProjectData,
): { variable: PLCVariable; name: string } {
  // Generate unique name
  const baseName = blockType.toUpperCase()
  let counter = 0
  let variableName = baseName
  
  while (!isVariableNameUnique(variableName, 'local', pouName, projectData)) {
    counter++
    variableName = `${baseName}${counter}`
  }
  
  // Create variable
  const variable: PLCVariable = {
    name: variableName,
    class: 'local',
    type: {
      definition: 'derived',
      value: blockType
    },
    location: '',
    documentation: `Instance of ${blockType}`,
    debug: false
  }
  
  return { variable, name: variableName }
}
```

### 6.2 Automatic Cleanup on Function Block Deletion

```typescript
/**
 * Checks if a function block variable is still in use.
 * Implements Rule 4: Delete unused FB variables.
 */
export function isFunctionBlockVariableInUse(
  variableName: string,
  pouName: string,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): boolean {
  // Check ladder flows
  const ladderFlow = ladderFlows.find(f => f.name === pouName)
  if (ladderFlow) {
    for (const rung of ladderFlow.rungs) {
      for (const node of rung.nodes) {
        if (node.type === 'block') {
          const data = node.data as BlockNodeData<BlockVariant>
          if (data.variable?.ref?.variableName.toLowerCase() === variableName.toLowerCase()) {
            return true
          }
        }
      }
    }
  }
  
  // Check FBD flows
  const fbdFlow = fbdFlows.find(f => f.name === pouName)
  if (fbdFlow) {
    for (const node of fbdFlow.rung.nodes) {
      if (node.type === 'block') {
        const data = node.data as BlockNodeData<BlockVariant>
        if (data.variable?.ref?.variableName.toLowerCase() === variableName.toLowerCase()) {
          return true
        }
      }
    }
  }
  
  return false
}

/**
 * Deletes a function block variable if no longer in use.
 */
export function cleanupFunctionBlockVariable(
  variableName: string,
  pouName: string,
  projectData: PLCProjectData,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): boolean {
  if (isFunctionBlockVariableInUse(variableName, pouName, ladderFlows, fbdFlows)) {
    return false
  }
  
  // Delete the variable
  const pou = projectData.pous.find(p => p.data.name === pouName)
  if (!pou) return false
  
  const index = pou.data.variables.findIndex(
    v => v.name.toLowerCase() === variableName.toLowerCase()
  )
  
  if (index !== -1) {
    pou.data.variables.splice(index, 1)
    return true
  }
  
  return false
}
```

---

## 7. Variable Rename Handling

### 7.1 Find References

```typescript
/**
 * Finds all references to a variable by name (case-insensitive).
 * Implements Rule 5: Rename propagation.
 */
export function findVariableReferences(
  variableName: string,
  pouName: string,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): VariableReferenceLocation[] {
  const normalizedName = variableName.toLowerCase()
  const references: VariableReferenceLocation[] = []
  
  // Search ladder flows
  const ladderFlow = ladderFlows.find(f => f.name === pouName)
  if (ladderFlow) {
    ladderFlow.rungs.forEach(rung => {
      rung.nodes.forEach(node => {
        if (node.type === 'contact' || node.type === 'coil') {
          const data = node.data as { variable?: ElementVariableAssociation }
          if (data.variable?.ref?.variableName.toLowerCase() === normalizedName) {
            references.push({
              type: 'ladder',
              nodeId: node.id,
              rungId: rung.id,
              elementType: node.type,
              currentRef: data.variable.ref
            })
          }
        }
        
        if (node.type === 'block') {
          const data = node.data as BlockNodeData<BlockVariant>
          
          // Check instance variable
          if (data.variable?.ref?.variableName.toLowerCase() === normalizedName) {
            references.push({
              type: 'ladder',
              nodeId: node.id,
              rungId: rung.id,
              elementType: 'block-instance',
              currentRef: data.variable.ref
            })
          }
          
          // Check connected variables
          data.connectedVariables?.forEach((conn, index) => {
            if (conn.variableRef?.variableName.toLowerCase() === normalizedName) {
              references.push({
                type: 'ladder',
                nodeId: node.id,
                rungId: rung.id,
                elementType: 'block-connection',
                connectionIndex: index,
                currentRef: conn.variableRef
              })
            }
          })
        }
      })
    })
  }
  
  // Search FBD flows (similar pattern)
  const fbdFlow = fbdFlows.find(f => f.name === pouName)
  if (fbdFlow) {
    // Similar logic for FBD nodes...
  }
  
  return references
}

export type VariableReferenceLocation = {
  type: 'ladder' | 'fbd'
  nodeId: string
  rungId?: string  // ladder only
  elementType: 'contact' | 'coil' | 'block-instance' | 'block-connection' | 'variable'
  connectionIndex?: number  // for block connections
  currentRef: VariableReference
}
```

### 7.2 Propagate Rename

```typescript
/**
 * Updates all references to use the new variable name.
 */
export function propagateVariableRename(
  oldName: string,
  newName: string,
  pouName: string,
  references: VariableReferenceLocation[],
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  ladderFlowActions: any,
  fbdFlowActions: any,
): void {
  references.forEach(ref => {
    if (ref.type === 'ladder') {
      const flow = ladderFlows.find(f => f.name === pouName)
      if (!flow) return
      
      const rung = flow.rungs.find(r => r.id === ref.rungId)
      if (!rung) return
      
      const node = rung.nodes.find(n => n.id === ref.nodeId)
      if (!node) return
      
      // Update the reference
      const updatedRef: VariableReference = {
        ...ref.currentRef,
        variableName: newName
      }
      
      if (ref.elementType === 'contact' || ref.elementType === 'coil') {
        const data = node.data as { variable?: ElementVariableAssociation }
        if (data.variable) {
          data.variable.ref = updatedRef
        }
      } else if (ref.elementType === 'block-instance') {
        const data = node.data as BlockNodeData<BlockVariant>
        if (data.variable) {
          data.variable.ref = updatedRef
        }
      } else if (ref.elementType === 'block-connection' && ref.connectionIndex !== undefined) {
        const data = node.data as BlockNodeData<BlockVariant>
        if (data.connectedVariables[ref.connectionIndex]) {
          data.connectedVariables[ref.connectionIndex].variableRef = updatedRef
        }
      }
      
      // Update the node in the flow
      ladderFlowActions.updateNode({
        editorName: pouName,
        rungId: ref.rungId!,
        nodeId: ref.nodeId,
        node
      })
    }
    
    // Similar logic for FBD...
  })
}
```

### 7.3 Break References on Declined Rename

```typescript
/**
 * Marks references as broken when user declines rename propagation.
 */
export function breakVariableReferences(
  references: VariableReferenceLocation[],
  pouName: string,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  ladderFlowActions: any,
  fbdFlowActions: any,
): void {
  references.forEach(ref => {
    if (ref.type === 'ladder') {
      const flow = ladderFlows.find(f => f.name === pouName)
      if (!flow) return
      
      const rung = flow.rungs.find(r => r.id === ref.rungId)
      if (!rung) return
      
      const node = rung.nodes.find(n => n.id === ref.nodeId)
      if (!node) return
      
      // Mark as invalid
      if (ref.elementType === 'contact' || ref.elementType === 'coil') {
        const data = node.data as { variable?: ElementVariableAssociation }
        if (data.variable) {
          data.variable.isValid = false
          data.variable.validationError = 'Variable renamed - reference not updated'
        }
      } else if (ref.elementType === 'block-instance') {
        const data = node.data as BlockNodeData<BlockVariant>
        if (data.variable) {
          data.variable.isValid = false
          data.variable.validationError = 'Variable renamed - reference not updated'
        }
      } else if (ref.elementType === 'block-connection' && ref.connectionIndex !== undefined) {
        const data = node.data as BlockNodeData<BlockVariant>
        const conn = data.connectedVariables[ref.connectionIndex]
        if (conn) {
          conn.variable = undefined
          // Keep the ref but it will fail validation
        }
      }
      
      // Update the node in the flow
      ladderFlowActions.updateNode({
        editorName: pouName,
        rungId: ref.rungId!,
        nodeId: ref.nodeId,
        node
      })
    }
    
    // Similar logic for FBD...
  })
}
```

---

## 8. Type Change Handling

### 8.1 Detect Type Change Impact

```typescript
/**
 * Finds all references that will be broken by a type change.
 * Implements Rule 6: Type change validation.
 */
export function findReferencesAffectedByTypeChange(
  variableName: string,
  oldType: PLCVariable['type'],
  newType: PLCVariable['type'],
  pouName: string,
  projectData: PLCProjectData,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): VariableReferenceLocation[] {
  const allReferences = findVariableReferences(variableName, pouName, ladderFlows, fbdFlows)
  const affectedReferences: VariableReferenceLocation[] = []
  
  allReferences.forEach(ref => {
    // Check if new type is compatible with the reference's expected type
    const compatibility = checkTypeCompatibility(
      newType,
      ref.currentRef.variableType,
      projectData.dataTypes
    )
    
    if (!compatibility.isCompatible) {
      affectedReferences.push(ref)
    }
  })
  
  return affectedReferences
}
```

### 8.2 Break References on Type Change

```typescript
/**
 * Breaks references that are no longer type-compatible.
 */
export function breakReferencesOnTypeChange(
  affectedReferences: VariableReferenceLocation[],
  pouName: string,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  ladderFlowActions: any,
  fbdFlowActions: any,
): void {
  affectedReferences.forEach(ref => {
    if (ref.type === 'ladder') {
      const flow = ladderFlows.find(f => f.name === pouName)
      if (!flow) return
      
      const rung = flow.rungs.find(r => r.id === ref.rungId)
      if (!rung) return
      
      const node = rung.nodes.find(n => n.id === ref.nodeId)
      if (!node) return
      
      // Mark as type mismatch
      if (ref.elementType === 'contact' || ref.elementType === 'coil') {
        const data = node.data as { variable?: ElementVariableAssociation }
        if (data.variable) {
          data.variable.isValid = false
          data.variable.validationError = 'Variable type changed - no longer compatible'
        }
      } else if (ref.elementType === 'block-instance') {
        const data = node.data as BlockNodeData<BlockVariant>
        if (data.variable) {
          data.variable.isValid = false
          data.variable.validationError = 'Variable type changed - no longer compatible'
        }
      } else if (ref.elementType === 'block-connection' && ref.connectionIndex !== undefined) {
        const data = node.data as BlockNodeData<BlockVariant>
        const conn = data.connectedVariables[ref.connectionIndex]
        if (conn) {
          conn.variable = undefined
          // Ref remains but will fail validation
        }
      }
      
      // Update the node in the flow
      ladderFlowActions.updateNode({
        editorName: pouName,
        rungId: ref.rungId!,
        nodeId: ref.nodeId,
        node
      })
    }
    
    // Similar logic for FBD...
  })
}
```

---

## 9. Migration Strategy

### 9.1 Project Version Detection

```typescript
/**
 * Detects if a project uses the old ID-based system.
 */
export function isLegacyProject(projectData: PLCProjectData): boolean {
  // Check if any variables have IDs
  const hasVariableIds = projectData.pous.some(pou =>
    pou.data.variables.some(v => v.id !== undefined)
  )
  
  const hasGlobalIds = projectData.configuration.resource.globalVariables.some(
    v => v.id !== undefined
  )
  
  return hasVariableIds || hasGlobalIds
}
```

### 9.2 Migration Algorithm

```typescript
/**
 * Migrates a project from ID-based to name+type-based linking.
 */
export function migrateProjectToNameTypeLinking(
  projectData: PLCProjectData,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): MigrationResult {
  const result: MigrationResult = {
    success: true,
    migratedNodes: 0,
    errors: []
  }
  
  // Step 1: Migrate ladder flows
  ladderFlows.forEach(flow => {
    const pou = projectData.pous.find(p => p.data.name === flow.name)
    if (!pou) return
    
    flow.rungs.forEach(rung => {
      rung.nodes.forEach(node => {
        try {
          if (node.type === 'contact' || node.type === 'coil') {
            migrateContactCoilNode(node, pou, projectData)
            result.migratedNodes++
          } else if (node.type === 'block') {
            migrateBlockNode(node, pou, projectData)
            result.migratedNodes++
          } else if (node.type === 'variable') {
            migrateVariableNode(node, pou, projectData)
            result.migratedNodes++
          }
        } catch (error) {
          result.errors.push({
            nodeId: node.id,
            rungId: rung.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })
    })
  })
  
  // Step 2: Migrate FBD flows (similar pattern)
  fbdFlows.forEach(flow => {
    // Similar logic...
  })
  
  // Step 3: Remove IDs from variables
  projectData.pous.forEach(pou => {
    pou.data.variables.forEach(v => {
      delete v.id
    })
  })
  
  projectData.configuration.resource.globalVariables.forEach(v => {
    delete v.id
  })
  
  result.success = result.errors.length === 0
  return result
}

function migrateContactCoilNode(
  node: Node,
  pou: PLCPou,
  projectData: PLCProjectData
): void {
  const data = node.data as any
  
  // Old format: { variable: { id?: string, name: string } }
  // New format: { variable: ElementVariableAssociation }
  
  if (!data.variable || !data.variable.name) {
    throw new Error('Node has no variable')
  }
  
  const variableName = data.variable.name
  
  // Find the variable by name
  let variable = findVariableByNameAndType(
    pou.data.variables,
    variableName
  )
  
  if (!variable) {
    variable = findVariableByNameAndType(
      projectData.configuration.resource.globalVariables,
      variableName
    )
  }
  
  if (!variable) {
    throw new Error(`Variable '${variableName}' not found`)
  }
  
  // Create new reference
  const ref: VariableReference = {
    pouName: pou.data.name,
    variableName: variable.name,
    variableType: variable.type
  }
  
  // Validate type (contacts/coils need BOOL)
  const validation = validateContactCoilType(variable.type)
  
  // Update node data
  data.variable = {
    ref,
    variable,
    isValid: validation.isCompatible,
    validationError: validation.reason
  }
}

function migrateBlockNode(
  node: Node,
  pou: PLCPou,
  projectData: PLCProjectData
): void {
  const data = node.data as any
  
  // Migrate instance variable
  if (data.variable && data.variable.name) {
    const variableName = data.variable.name
    
    let variable = findVariableByNameAndType(
      pou.data.variables,
      variableName
    )
    
    if (!variable) {
      variable = findVariableByNameAndType(
        projectData.configuration.resource.globalVariables,
        variableName
      )
    }
    
    if (variable) {
      const ref: VariableReference = {
        pouName: pou.data.name,
        variableName: variable.name,
        variableType: variable.type
      }
      
      data.variable = {
        ref,
        variable,
        isValid: true
      }
    }
  }
  
  // Migrate connected variables
  if (data.connectedVariables && Array.isArray(data.connectedVariables)) {
    const newConnectedVariables: BlockConnectedVariable[] = []
    
    data.connectedVariables.forEach((conn: any) => {
      if (!conn.variable || !conn.variable.name) {
        newConnectedVariables.push({
          handleName: conn.handleId || conn.handleName,
          type: conn.type,
          variableRef: null,
          variable: undefined
        })
        return
      }
      
      const variableName = conn.variable.name
      
      let variable = findVariableByNameAndType(
        pou.data.variables,
        variableName
      )
      
      if (!variable) {
        variable = findVariableByNameAndType(
          projectData.configuration.resource.globalVariables,
          variableName
        )
      }
      
      if (variable) {
        const ref: VariableReference = {
          pouName: pou.data.name,
          variableName: variable.name,
          variableType: variable.type
        }
        
        newConnectedVariables.push({
          handleName: conn.handleId || conn.handleName,
          type: conn.type,
          variableRef: ref,
          variable
        })
      } else {
        newConnectedVariables.push({
          handleName: conn.handleId || conn.handleName,
          type: conn.type,
          variableRef: null,
          variable: undefined
        })
      }
    })
    
    data.connectedVariables = newConnectedVariables
  }
}

function migrateVariableNode(
  node: Node,
  pou: PLCPou,
  projectData: PLCProjectData
): void {
  // Similar to migrateContactCoilNode
  migrateContactCoilNode(node, pou, projectData)
}

export type MigrationResult = {
  success: boolean
  migratedNodes: number
  errors: Array<{
    nodeId: string
    rungId?: string
    error: string
  }>
}
```

### 9.3 Backward Compatibility

```typescript
/**
 * Ensures new projects work with old editor versions (graceful degradation).
 */
export function ensureBackwardCompatibility(projectData: PLCProjectData): void {
  // Generate IDs for all variables that don't have them
  // This allows old editor versions to open new projects
  
  projectData.pous.forEach(pou => {
    pou.data.variables.forEach(v => {
      if (!v.id) {
        v.id = crypto.randomUUID()
      }
    })
  })
  
  projectData.configuration.resource.globalVariables.forEach(v => {
    if (!v.id) {
      v.id = crypto.randomUUID()
    }
  })
}
```

---

## 10. Implementation Phases

### Phase 2A: Core Infrastructure (Week 1-2)
1. Implement new type definitions (VariableReference, ElementVariableAssociation, etc.)
2. Implement type compatibility system
3. Implement new lookup functions (findVariableByNameAndType, etc.)
4. Add unit tests for core functions

### Phase 2B: Graphical Editor Updates (Week 3-4)
1. Update Ladder editor components (contact, coil, block, variable)
2. Update FBD editor components
3. Replace handleTableId with name+type references
4. Update autocomplete components

### Phase 2C: Variable Management (Week 5)
1. Update variable creation/deletion logic
2. Implement automatic FB variable creation
3. Implement automatic FB variable cleanup
4. Update variable renaming with propagation

### Phase 2D: Validation and Synchronization (Week 6)
1. Implement reference validation
2. Implement broken link detection
3. Implement type change handling
4. Add validation UI indicators

### Phase 2E: Migration and Testing (Week 7-8)
1. Implement project migration algorithm
2. Add migration UI/prompts
3. Comprehensive testing (unit, integration, E2E)
4. Performance testing and optimization

### Phase 2F: Documentation and Rollout (Week 9)
1. Update user documentation
2. Create migration guide
3. Beta testing with real projects
4. Final release

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
describe('Type Compatibility', () => {
  it('should match identical base types', () => {
    const result = checkTypeCompatibility(
      { definition: 'base-type', value: 'BOOL' },
      { definition: 'base-type', value: 'BOOL' },
      []
    )
    expect(result.isCompatible).toBe(true)
  })
  
  it('should be case-insensitive', () => {
    const result = checkTypeCompatibility(
      { definition: 'base-type', value: 'bool' },
      { definition: 'base-type', value: 'BOOL' },
      []
    )
    expect(result.isCompatible).toBe(true)
  })
  
  it('should reject type mismatches', () => {
    const result = checkTypeCompatibility(
      { definition: 'base-type', value: 'INT' },
      { definition: 'base-type', value: 'BOOL' },
      []
    )
    expect(result.isCompatible).toBe(false)
    expect(result.reason).toContain('Type mismatch')
  })
})

describe('Variable Lookup', () => {
  it('should find variable by name (case-insensitive)', () => {
    const variables: PLCVariable[] = [
      { name: 'MyVar', type: { definition: 'base-type', value: 'INT' }, ... }
    ]
    
    const result = findVariableByNameAndType(variables, 'myvar')
    expect(result).toBeDefined()
    expect(result?.name).toBe('MyVar')
  })
  
  it('should return null for non-existent variable', () => {
    const result = findVariableByNameAndType([], 'NonExistent')
    expect(result).toBeNull()
  })
})
```

### 11.2 Integration Tests

```typescript
describe('Variable Rename Propagation', () => {
  it('should update all references when user accepts', async () => {
    // Setup: Create project with variable and references
    // Action: Rename variable with propagation
    // Assert: All references updated
  })
  
  it('should break references when user declines', async () => {
    // Setup: Create project with variable and references
    // Action: Rename variable without propagation
    // Assert: References marked as broken
  })
})

describe('Function Block Lifecycle', () => {
  it('should create variable when FB added', () => {
    // Setup: Add function block to diagram
    // Assert: Variable created in table
  })
  
  it('should delete variable when last FB removed', () => {
    // Setup: Add FB, then remove it
    // Assert: Variable deleted from table
  })
  
  it('should keep variable when other FBs use it', () => {
    // Setup: Add two FBs with same variable, remove one
    // Assert: Variable still exists
  })
})
```

### 11.3 Migration Tests

```typescript
describe('Project Migration', () => {
  it('should migrate ID-based project to name+type', () => {
    // Setup: Load legacy project with IDs
    // Action: Run migration
    // Assert: All nodes migrated, IDs removed
  })
  
  it('should handle missing variables gracefully', () => {
    // Setup: Project with broken ID references
    // Action: Run migration
    // Assert: Errors reported, other nodes migrated
  })
})
```

---

## 12. Performance Considerations

### 12.1 Caching Strategy

```typescript
/**
 * Cache for variable lookups to avoid repeated searches.
 */
class VariableLookupCache {
  private cache: Map<string, PLCVariable | null> = new Map()
  
  getCacheKey(name: string, pouName: string, scope: VariableScope): string {
    return `${scope}:${pouName}:${name.toLowerCase()}`
  }
  
  get(name: string, pouName: string, scope: VariableScope): PLCVariable | null | undefined {
    return this.cache.get(this.getCacheKey(name, pouName, scope))
  }
  
  set(name: string, pouName: string, scope: VariableScope, variable: PLCVariable | null): void {
    this.cache.set(this.getCacheKey(name, pouName, scope), variable)
  }
  
  invalidate(): void {
    this.cache.clear()
  }
  
  invalidateScope(pouName: string, scope: VariableScope): void {
    const prefix = `${scope}:${pouName}:`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }
}
```

### 12.2 Batch Validation

```typescript
/**
 * Validates multiple references in a single pass.
 */
export function batchValidateReferences(
  refs: VariableReference[],
  projectData: PLCProjectData,
  cache?: VariableLookupCache
): Map<VariableReference, ValidationResult> {
  const results = new Map<VariableReference, ValidationResult>()
  
  refs.forEach(ref => {
    const result = validateVariableReference(ref, projectData)
    results.set(ref, result)
  })
  
  return results
}
```

### 12.3 Lazy Validation

```typescript
/**
 * Only validate references when needed (on save, compile, or user request).
 * Don't validate on every keystroke.
 */
export function scheduleValidation(
  pouName: string,
  debounceMs: number = 500
): void {
  // Debounce validation to avoid excessive checks
  // Implementation would use a debounce utility
}
```

---

## 13. UI/UX Considerations

### 13.1 Visual Indicators

- **Valid reference:** Normal appearance
- **Broken reference (not found):** Red border, red text
- **Type mismatch:** Yellow border, warning icon
- **Pending validation:** Gray/dimmed appearance

### 13.2 Error Messages

```typescript
export const ERROR_MESSAGES = {
  VARIABLE_NOT_FOUND: (name: string) => 
    `Variable '${name}' not found. Check the variable table.`,
  
  TYPE_MISMATCH: (expected: string, actual: string) =>
    `Type mismatch: expected ${expected}, got ${actual}`,
  
  CONTACT_COIL_BOOL_ONLY: () =>
    `Contacts and coils require BOOL type variables`,
  
  FB_MUST_BE_INSTANTIATED: (blockType: string) =>
    `Function block '${blockType}' must be instantiated with a variable`,
}
```

### 13.3 Rename Dialog

```
┌─────────────────────────────────────────────┐
│ Rename Variable                             │
├─────────────────────────────────────────────┤
│                                             │
│ You renamed 'OldName' to 'NewName'.         │
│                                             │
│ This variable is used in 5 locations.       │
│                                             │
│ Do you want to update all references?       │
│                                             │
│  ○ Yes, rename all references               │
│  ○ No, keep old references (will break)     │
│                                             │
│         [Cancel]  [Apply]                   │
└─────────────────────────────────────────────┘
```

---

## 14. Summary

This design provides a complete specification for migrating from ID-based to name+type-based variable linking. Key features:

**Strengths:**
- ✅ Follows IEC 61131-3 standards (case-insensitive names)
- ✅ Type-safe with comprehensive validation
- ✅ Handles all 6 core linking rules
- ✅ Backward compatible with migration path
- ✅ Performance-optimized with caching
- ✅ Clear error handling and user feedback

**Implementation Complexity:**
- **High:** Touches many parts of the codebase
- **Mitigated by:** Phased approach, comprehensive testing

**Risk Mitigation:**
- Migration algorithm preserves data
- Validation catches broken references
- Backward compatibility maintained
- Extensive test coverage planned

**Next Steps:**
- Review and approve design
- Begin Phase 2A implementation
- Set up CI/CD for automated testing
- Create feature branch for development

---

**Document Version:** 1.0  
**Date:** 2025-10-22  
**Author:** Devin (AI Assistant)  
**Status:** Complete - Ready for Review
