# Investigation Report: Issue #461 - Keyboard Arrow Variable Selection Bug

**Date**: 2025-12-31
**Issue**: [#461](https://github.com/Autonomy-Logic/openplc-editor/issues/461)
**Title**: Changing a variable assigned to a contact in ladder logic using the keyboard arrows

---

## User Story Summary

### Expected Behavior
When a variable is selected using keyboard arrows in the dropdown and Enter is pressed, the variable name should change to the selected variable (same behavior as mouse selection).

### Current Behavior
Instead of selecting the highlighted variable, the system creates a completely new undeclared variable.

### Reproduction Steps
1. Create 3 variables: `In0`, `In1`, and `Out`
2. Create a ladder rung with a contact and a coil
3. Assign `In0` to the contact and `Out` to the coil
4. Try to change the contact variable using keyboard arrows to select `In1`
5. Press Enter to confirm
6. **Bug**: A new variable `In2` is created instead of selecting the existing `In1`

**Important**: This bug does NOT occur with mouse selection - only with keyboard navigation.

---

## Root Cause Analysis

A **multi-layered state synchronization issue** exists between the autocomplete component, keyboard event handlers, and the variable submission logic.

### 1. State Synchronization Problem

**Primary Issue**: When keyboard arrows are used to navigate the autocomplete dropdown, the selected variable's position is tracked, but the **input field text is NOT updated** to reflect the selected variable's full name before submission.

**Location**: `src/renderer/components/_atoms/graphical-editor/ladder/contact.tsx:458-464` (same pattern in `coil.tsx:488-495`)

```typescript
onKeyDown={(e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
  if (e.key === 'Enter' && autocompleteRef.current?.selectedVariable.positionInArray !== -1) {
    inputVariableRef.current?.blur({ submit: false })
  }
  setKeyPressedAtTextarea(e.key)
}}
```

**The Problem Flow:**
- When Enter is pressed, `blur({ submit: false })` is called
- This prevents the normal form submission in the HighlightedTextArea component
- The autocomplete's keyboard handler then attempts to submit, but uses incomplete data

### 2. Variable Lookup Failure

**Location**: `src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx:202-217`

```typescript
const submit = ({ variable }: { variable: { name: string } }) => {
  if (variable.name === 'add') {
    submitAddVariable({ variableName: valueToSearch })
    return
  }

  const selectedVariable = filteredVariables.find(
    (variableItem) => variableItem.name.toLowerCase() === variable.name.toLowerCase(),
  )
  if (!selectedVariable) {  // <- CRITICAL: This check fails!
    submitAddVariable({ variableName: valueToSearch })  // <- Creates NEW variable
    return
  }

  submitVariableToBlock(selectedVariable as PLCVariable)
}
```

**Why It Fails:**
1. User types "In" → autocomplete shows filtered list: `["In0", "In1"]`
2. User presses Arrow Down to highlight "In1" → internal state tracks position
3. User presses Enter → submits with the variable from `selectedVariable` state
4. The lookup tries to find the variable in `filteredVariables` by exact name match
5. If there's any mismatch or if the variable name isn't properly synchronized, `selectedVariable` is null
6. System falls back to creating a new variable using `valueToSearch` (the partial input text)

### 3. Initial State Issues

**Location**: `src/renderer/components/_atoms/graphical-editor/autocomplete/index.tsx:46-55`

```typescript
const [selectedVariable, setSelectedVariable] = useState<{
  positionInArray: number
  variable: { id: string; name: string }
}>({
  positionInArray: -1,  // Initially no selection
  variable: {
    id: '',
    name: '',  // Empty variable name
  },
})
```

The initial state has an empty variable name, and the update logic when arrow keys are pressed may not properly populate the full variable details before Enter is pressed.

### 4. Why Mouse Selection Works

**Location**: `src/renderer/components/_atoms/graphical-editor/autocomplete/index.tsx:198-205`

Mouse clicks bypass the problematic flow entirely:

```typescript
onClick={() => {
  submitAutocompletion({
    variable: {
      id: variable.id ?? '',
      name: variable.name,  // <- ALWAYS has the complete, correct variable name
    },
  })
}}
```

The mouse handler directly calls submit with the complete variable object from the list, avoiding the state synchronization and lookup issues.

---

## Critical Files Involved

1. **`src/renderer/components/_atoms/graphical-editor/ladder/contact.tsx`**
   - Lines 458-464: Keyboard event handler
   - Calls `blur({ submit: false })` on Enter key

2. **`src/renderer/components/_atoms/graphical-editor/ladder/coil.tsx`**
   - Lines 488-495: Same problematic pattern as contact

3. **`src/renderer/components/_atoms/graphical-editor/ladder/autocomplete/index.tsx`**
   - Lines 74-94: Variable filtering logic
   - Lines 202-217: Submit function with failing variable lookup
   - Lines 152-165: Add variable logic (erroneously invoked)

4. **`src/renderer/components/_atoms/graphical-editor/autocomplete/index.tsx`**
   - Lines 46-55: Initial selectedVariable state
   - Lines 98-134: Keyboard event handler for arrow keys and Enter
   - Lines 157-160: submitAutocompletion function

5. **`src/renderer/components/_atoms/highlighted-textarea/index.tsx`**
   - Lines 62-67: The blur method with canSubmit flag
   - Lines 144-152: Blur handler that conditionally submits

---

## The Bug Chain

Here's the complete sequence that causes the bug:

1. **User types** "In" in the contact variable field
2. **Autocomplete filters** and shows: `["In0", "In1"]`
3. **User presses Arrow Down** → `selectedVariable.positionInArray` updates to 1
4. **User presses Enter** → Contact component calls `inputVariableRef.current?.blur({ submit: false })`
5. **Blur is prevented** from submitting due to `canSubmit = false`
6. **Autocomplete detects Enter key** → calls `submitAutocompletion()` with current `selectedVariable` state
7. **Variable lookup runs** but fails to find exact match (likely due to state sync issues)
8. **Fallback logic triggers** → creates new variable using `valueToSearch` (current input text "In")
9. **New variable created** with an auto-incremented or default name like "In2"

---

## Summary

### Root Cause
The keyboard-based variable selection flow has a critical state synchronization bug where:
- The autocomplete tracks which variable is highlighted (by position)
- But the variable name isn't properly synchronized before submission
- The variable lookup fails to find the selected variable in the filtered list
- The system incorrectly falls back to creating a new variable

### Why Mouse Works
Mouse selection directly provides the complete variable object, bypassing the flawed keyboard state management flow.

### Impact
Users cannot reliably change variables using keyboard navigation, which is a significant UX/accessibility issue.

---

## Recommended Solution

The simplest and most efficient fix is to ensure that when keyboard navigation is used:

1. Update the `selectedVariable` state in the autocomplete to include the complete variable object (with full name and id) when arrow keys change the selection
2. Modify the submit logic to directly use the selected variable from the autocomplete state when it's available (positionInArray !== -1)
3. Only fall back to the name lookup when no keyboard selection has been made

This approach:
- Matches the mouse selection behavior
- Requires minimal code changes
- Doesn't alter the overall architecture
- Fixes the state synchronization issue at its source
