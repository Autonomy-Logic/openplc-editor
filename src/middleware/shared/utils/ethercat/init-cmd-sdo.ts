import type { ESIInitCmd, SDOConfigurationEntry } from '../../ports/esi-types'

/** ASCII/UTF-8 text as `0x`-prefixed upper-case hex bytes (no terminator). */
export function textToHexBytes(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

/** Byte count of a `0x`-prefixed hex payload. */
export function hexByteLength(hex: string): number {
  return hex.replace(/^0x/i, '').length / 2
}

const TYPE_BITS: Readonly<Record<string, number>> = {
  BOOL: 1,
  SINT: 8,
  USINT: 8,
  BYTE: 8,
  INT: 16,
  UINT: 16,
  WORD: 16,
  DINT: 32,
  UDINT: 32,
  DWORD: 32,
  REAL: 32,
  LINT: 64,
  ULINT: 64,
  LWORD: 64,
  LREAL: 64,
}

/**
 * Convert one ESI CoE `<InitCmd>` into a startup SDO entry. `<Data>` and `<DataAscii>`
 * payloads travel as `0x`-prefixed byte strings in wire order; a `<Value>` stays numeric.
 * Returns undefined for a command with no payload at all.
 */
export function initCmdToSdoEntry(cmd: ESIInitCmd, objectName: string): SDOConfigurationEntry | undefined {
  const bytes = cmd.data ?? (cmd.dataAscii !== undefined ? textToHexBytes(cmd.dataAscii) : undefined)
  const name = cmd.comment ?? cmd.index
  if (bytes !== undefined) {
    return {
      index: cmd.index,
      subIndex: cmd.subIndex,
      value: '',
      defaultValue: '',
      valueBytes: bytes,
      dataType: 'OCTET_STRING',
      bitLength: hexByteLength(bytes) * 8,
      name,
      objectName,
      completeAccess: cmd.completeAccess,
      dependOnSlot: cmd.dependOnSlot,
      transition: cmd.transition,
    }
  }
  if (cmd.value === undefined) return undefined
  const dataType = cmd.dataType ?? 'UDINT'
  return {
    index: cmd.index,
    subIndex: cmd.subIndex,
    value: String(cmd.value),
    defaultValue: String(cmd.value),
    dataType,
    bitLength: TYPE_BITS[dataType.toUpperCase()] ?? 32,
    name,
    objectName,
    completeAccess: cmd.completeAccess,
    dependOnSlot: cmd.dependOnSlot,
    transition: cmd.transition,
  }
}

/** Transitions whose writes EtherDOG performs: all its startup SDOs go out in PRE-OP. */
export const PREOP_TRANSITIONS: readonly string[] = ['IP', 'PS']

/** The transitions of an InitCmd-derived entry, upper case; empty for a user startup SDO. */
export function sdoTransitions(entry: Pick<SDOConfigurationEntry, 'transition'>): string[] {
  return (entry.transition ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== '')
}

/** Convert a list of ESI CoE `<InitCmd>`s, dropping commands without a payload. */
export function initCmdsToSdoEntries(
  cmds: readonly ESIInitCmd[] | undefined,
  objectName: string,
): SDOConfigurationEntry[] {
  if (cmds === undefined) return []
  const out: SDOConfigurationEntry[] = []
  for (const cmd of cmds) {
    const entry = initCmdToSdoEntry(cmd, objectName)
    if (entry !== undefined) out.push(entry)
  }
  return out
}
