import type { ModbusIOGroup, ModbusIOPoint } from '../../../middleware/shared/ports/types'

type ModbusFunctionCode = ModbusIOGroup['functionCode']

/**
 * Maximum number of elements a single Modbus request can carry per function
 * code, straight from the protocol's PDU limits. FC 5 and FC 6 address exactly
 * one element by definition; the read codes are bounded by the 253-byte PDU.
 *
 * This is an INPUT rule (what the user may type), not a stored invariant — see
 * `clampIOGroupLength`.
 */
export const MAX_IO_GROUP_LENGTH_BY_FC: Record<ModbusFunctionCode, number> = {
  '1': 2000,
  '2': 2000,
  '3': 125,
  '4': 125,
  '5': 1,
  '6': 1,
  '15': 1968,
  '16': 123,
}

/**
 * FC 5 (Write Single Coil) and FC 6 (Write Single Register) write exactly one
 * element, so a group using them always holds a single I/O point.
 */
export const isSingleElementFunctionCode = (functionCode: ModbusFunctionCode): boolean =>
  functionCode === '5' || functionCode === '6'

/**
 * Normalizes a group's length to the invariant every writer must uphold: a
 * positive integer, and exactly 1 for single-element function codes.
 *
 * FLOOR ONLY — deliberately does NOT apply `MAX_IO_GROUP_LENGTH_BY_FC`. Doing
 * so would silently truncate a pre-existing group (say an FC 3 group of length
 * 200) the moment the user edited only its name, i.e. data loss introduced by
 * a bug fix. The maximum is enforced at the input, by `validateIOGroupLength`.
 */
export const clampIOGroupLength = (functionCode: ModbusFunctionCode, length: number): number => {
  if (isSingleElementFunctionCode(functionCode)) return 1
  if (!Number.isFinite(length)) return 1
  const floored = Math.floor(length)
  return floored < 1 ? 1 : floored
}

type IOGroupLengthValidation = { ok: true; length: number } | { ok: false; message: string }

/**
 * Validates the raw string a user typed into the Length field. Rejects
 * non-integers, values below 1 and values above the function code's PDU limit,
 * returning a message that names the code so the reason is actionable.
 */
export const validateIOGroupLength = (functionCode: ModbusFunctionCode, raw: string): IOGroupLengthValidation => {
  if (isSingleElementFunctionCode(functionCode)) return { ok: true, length: 1 }

  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, message: 'Length is required.' }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { ok: false, message: 'Length must be a number.' }
  if (!Number.isInteger(parsed)) return { ok: false, message: 'Length must be a whole number.' }
  if (parsed < 1) return { ok: false, message: 'Length must be at least 1.' }

  const max = MAX_IO_GROUP_LENGTH_BY_FC[functionCode]
  if (parsed > max) return { ok: false, message: `FC ${functionCode} addresses at most ${max} elements per request.` }

  return { ok: true, length: parsed }
}

/**
 * Renders a group's occupied IEC address span for the collapsed table row.
 * Showing the range (rather than just the first point's address) is what makes
 * a size change — and the project-wide address recompaction that follows it —
 * visible without expanding the group.
 */
export const formatIOGroupAddressRange = (points: ModbusIOPoint[]): string => {
  if (points.length === 0) return '-'
  const first = points[0].iecLocation
  if (points.length === 1) return first
  return `${first} – ${points[points.length - 1].iecLocation}`
}
