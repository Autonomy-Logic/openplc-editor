export type EdgeTriggerType = 'R_TRIG' | 'F_TRIG'

export const edgeTriggerTypeForVariant = (variant: string): EdgeTriggerType | null => {
  if (variant === 'risingEdge') return 'R_TRIG'
  if (variant === 'fallingEdge') return 'F_TRIG'
  return null
}

// Derived from the node, like function-call temps, so the debugger finds the instance without the transpiler.
export const edgeTriggerInstanceName = (type: EdgeTriggerType, numericId: unknown): string | null => {
  let id: number
  if (typeof numericId === 'number') id = numericId
  else if (typeof numericId === 'string' && /^(0|[1-9]\d*)$/.test(numericId)) id = Number(numericId)
  else return null
  if (!Number.isSafeInteger(id) || id < 0) return null
  return `_TMP_${type}${id}`
}
