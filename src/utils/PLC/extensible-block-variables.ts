/**
 * Utility functions for managing extensible block inputs (MUX, ADD, AND, OR, etc.).
 *
 * Extensible inputs always match the pattern /^IN\d+$/ (e.g. IN0, IN1, IN2).
 * Everything else (K, G, MN, MX, EN, ENO, OUT) is either fixed or an output.
 *
 * MUX starts extensible inputs at IN0; all other blocks start at IN1.
 */

/** Minimal variable interface compatible with both FBD and Ladder BlockVariant variables */
interface BlockVariable {
  name: string
  class: string
  type: { definition: string; value: string }
  id?: string
}

interface ClassifiedVariables {
  enVariable: BlockVariable | undefined
  fixedInputs: BlockVariable[]
  extensibleInputs: BlockVariable[]
  outputs: BlockVariable[]
}

const EXTENSIBLE_INPUT_PATTERN = /^IN\d+$/

function isExtensibleInput(variable: BlockVariable): boolean {
  return variable.class === 'input' && EXTENSIBLE_INPUT_PATTERN.test(variable.name)
}

function getExtensibleIndex(variable: BlockVariable): number {
  return Number(variable.name.slice(2))
}

/** Separate block variables into EN / fixed inputs / extensible inputs / outputs */
function classifyBlockVariables(variables: BlockVariable[]): ClassifiedVariables {
  const enVariable = variables.find((v) => v.class === 'input' && v.name === 'EN')
  const fixedInputs = variables.filter(
    (v) => (v.class === 'input' || v.class === 'inOut') && v.name !== 'EN' && !isExtensibleInput(v),
  )
  const extensibleInputs = variables
    .filter((v) => isExtensibleInput(v))
    .sort((a, b) => getExtensibleIndex(a) - getExtensibleIndex(b))
  const outputs = variables.filter((v) => v.class === 'output')

  return { enVariable, fixedInputs, extensibleInputs, outputs }
}

/** Get the type that new extensible inputs should have (derived from existing IN<n> variables) */
function getExtensibleInputType(variables: BlockVariable[]): BlockVariable['type'] {
  const { extensibleInputs } = classifyBlockVariables(variables)
  if (extensibleInputs.length > 0) {
    return extensibleInputs[0].type
  }
  // Fallback: first non-EN input
  const firstInput = variables.find((v) => v.class === 'input' && v.name !== 'EN')
  return firstInput?.type ?? { definition: 'base-type', value: 'INT' }
}

/** Determine the starting index for extensible inputs (0 for MUX, 1 for others) */
function getExtensibleStartIndex(variables: BlockVariable[]): number {
  const { extensibleInputs } = classifyBlockVariables(variables)
  if (extensibleInputs.length > 0) {
    return getExtensibleIndex(extensibleInputs[0])
  }
  return 1
}

/** Build the next extensible input variable with the correct name and type */
function buildNextExtensibleInput(variables: BlockVariable[]): BlockVariable {
  const { extensibleInputs } = classifyBlockVariables(variables)
  const type = getExtensibleInputType(variables)

  let nextIndex: number
  if (extensibleInputs.length > 0) {
    nextIndex = Math.max(...extensibleInputs.map(getExtensibleIndex)) + 1
  } else {
    nextIndex = 1
  }

  return { name: `IN${nextIndex}`, class: 'input', type }
}

/**
 * Remove the last extensible input and return the new variable list.
 * Returns null if already at the minimum extensible count.
 */
function removeLastExtensibleInput(variables: BlockVariable[], minExtensible = 2): BlockVariable[] | null {
  const classified = classifyBlockVariables(variables)
  if (classified.extensibleInputs.length <= minExtensible) {
    return null
  }
  return assembleVariables({
    ...classified,
    extensibleInputs: classified.extensibleInputs.slice(0, -1),
  })
}

/**
 * Rebuild the variable list for a target total non-EN input count (fixed + extensible).
 * Preserves fixed inputs and generates extensible inputs with correct names and types.
 */
function rebuildVariablesForInputCount(variables: BlockVariable[], targetTotalNonEN: number): BlockVariable[] {
  const classified = classifyBlockVariables(variables)
  const targetExtensible = Math.max(targetTotalNonEN - classified.fixedInputs.length, 2)
  const type = getExtensibleInputType(variables)
  const startIndex = getExtensibleStartIndex(variables)

  const newExtensible: BlockVariable[] = []
  for (let i = 0; i < targetExtensible; i++) {
    newExtensible.push({ name: `IN${startIndex + i}`, class: 'input', type })
  }

  return assembleVariables({ ...classified, extensibleInputs: newExtensible })
}

/** Reassemble variables in the correct order: EN? + fixedInputs + extensibleInputs + outputs */
function assembleVariables(classified: ClassifiedVariables): BlockVariable[] {
  const result: BlockVariable[] = []
  if (classified.enVariable) result.push(classified.enVariable)
  result.push(...classified.fixedInputs)
  result.push(...classified.extensibleInputs)
  result.push(...classified.outputs)
  return result
}

/** Calculate minimum total non-EN input count (fixed inputs + minimum extensible) */
function getMinInputCount(variables: BlockVariable[], minExtensible = 2): number {
  const { fixedInputs } = classifyBlockVariables(variables)
  return fixedInputs.length + minExtensible
}

export {
  assembleVariables,
  buildNextExtensibleInput,
  classifyBlockVariables,
  getExtensibleInputType,
  getMinInputCount,
  rebuildVariablesForInputCount,
  removeLastExtensibleInput,
}
export type { BlockVariable, ClassifiedVariables }
