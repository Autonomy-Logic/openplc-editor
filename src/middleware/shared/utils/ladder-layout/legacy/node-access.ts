import { getArray, getRecord, isRecord } from '../node-data'

/** A point in flow coordinates. */
export type LegacyPoint = { x: number; y: number }

/** An LD handle as the editor stores it in `Node.data`: its flow position plus whatever else it carries. */
export type LegacyHandle = { [key: string]: unknown; glbPosition: LegacyPoint }

/** Type guard for a stored handle: an object whose `glbPosition` holds numeric `x` and `y`. */
export function isLegacyHandle(value: unknown): value is LegacyHandle {
  if (!isRecord(value)) return false
  const position = value.glbPosition
  return isRecord(position) && typeof position.x === 'number' && typeof position.y === 'number'
}

/** Throws the `TypeError` today's layout raised when it read a field the node data lacks. */
export function missing(what: string): never {
  throw new TypeError(`ladder layout: ${what} is missing`)
}

/** The handle list stored under `key` (`handles`, `inputHandles`, `outputHandles`); throws when it is not one. */
export function handlesOf(data: Record<string, unknown>, key: string): LegacyHandle[] {
  const value = getArray(data, key)
  if (value === undefined || !value.every(isLegacyHandle)) return missing(`handle list "${key}"`)
  return value
}

/** The handle stored under `key` (a connector such as `outputConnector`), or `undefined`. */
export function connectorOf(data: Record<string, unknown>, key: string): LegacyHandle | undefined {
  const value = data[key]
  return isLegacyHandle(value) ? value : undefined
}

/** The `id` of the connector stored under `key`, as `data[key]?.id` reads it. */
export function connectorIdOf(data: Record<string, unknown>, key: string): unknown {
  return getRecord(data, key)?.id
}

/** A handle's id when it is a string, the only form a branch or an edge can name. */
export function handleIdOf(handle: LegacyHandle): string | undefined {
  return typeof handle.id === 'string' ? handle.id : undefined
}

/** Copies a handle with its flow `y`, its in-node `y` and its CSS `top` set to the given values. */
export function withHandleY(handle: LegacyHandle, glbY: number, relY: number): LegacyHandle {
  return {
    ...handle,
    glbPosition: { ...handle.glbPosition, y: glbY },
    relPosition: { ...getRecord(handle, 'relPosition'), y: relY },
    style: { ...getRecord(handle, 'style'), top: relY },
  }
}
