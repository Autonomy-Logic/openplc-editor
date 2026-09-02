/**
 * Narrow helpers over xyflow's untyped `Node.data` — `backend/shared` cannot
 * import the `components`-layer node/data types, so these mirror the field
 * names the live editor's node builders and read-only diff renderers
 * (`_atoms/graphical-editor/{ladder,fbd}/*`) already use, the same way
 * `diff/ladder-nodes.tsx` / `diff/fbd-nodes.tsx` narrow the same data —
 * except every read here goes through a type guard instead of `as`.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type Data = Record<string, unknown> | undefined

export function getRecord(data: Data, key: string): Record<string, unknown> | undefined {
  const value = data?.[key]
  return isRecord(value) ? value : undefined
}

export function getString(data: Data, key: string): string | undefined {
  const value = data?.[key]
  return typeof value === 'string' ? value : undefined
}

export function getBoolean(data: Data, key: string): boolean | undefined {
  const value = data?.[key]
  return typeof value === 'boolean' ? value : undefined
}

export function getArray(data: Data, key: string): unknown[] | undefined {
  const value = data?.[key]
  return Array.isArray(value) ? value : undefined
}

export function getNumber(data: Data, key: string): number | undefined {
  const value = data?.[key]
  return typeof value === 'number' ? value : undefined
}

/** `data.variable?.name` / `data.variant?.name` — the one field read in many contexts. */
export function getNestedString(data: Data, key: string, nestedKey: string): string | undefined {
  return getString(getRecord(data, key), nestedKey)
}

export type BlockPinVariable = { name: string; class?: string }

function isBlockPinVariable(value: unknown): value is BlockPinVariable {
  return isRecord(value) && typeof value.name === 'string'
}

/** `data.variant.variables` — a block's own `PLCVariable[]`-shaped array (loosely typed at this boundary). */
export function getBlockVariables(data: Data): BlockPinVariable[] {
  const variant = getRecord(data, 'variant')
  const variables = getArray(variant, 'variables')
  return (variables ?? []).filter(isBlockPinVariable)
}

export function blockInputVariables(vars: BlockPinVariable[]): BlockPinVariable[] {
  return vars.filter((v) => v.class === 'input' || v.class === 'inOut')
}

export function blockOutputVariables(vars: BlockPinVariable[]): BlockPinVariable[] {
  return vars.filter((v) => v.class === 'output')
}

export function inOutVariableNames(vars: BlockPinVariable[]): Set<string> {
  return new Set(vars.filter((v) => v.class === 'inOut').map((v) => v.name))
}
