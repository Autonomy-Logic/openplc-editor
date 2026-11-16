import {
  isValidRs485Pin,
  RS485_PINS_KEY,
  SERIAL_SCREEN_STATE_KEY,
} from '../../../../middleware/shared/utils/modbus-master-profile'

export interface GenerateVppConfigInput {
  /** `DeviceConfiguration.vendorScreenData` from the project model.
   *  Top-level keys are persistence keys (one per screen section).
   *  Values are arbitrary JSON authored by the layout components.
   *  Absent / undefined emits a minimal stub header so the driver's
   *  `#include` still resolves. */
  vendorScreenData: Record<string, unknown> | undefined
}

/**
 * Build the contents of `vpp_config.h`.
 *
 * Always emits the include-guard header. Always emits a trailing
 * `#endif`. Body content depends entirely on what's in
 * `vendorScreenData` — every leaf walked through `walk()` becomes
 * one `#define`.
 */
export function generateVppConfigContent(input: GenerateVppConfigInput): string {
  const { vendorScreenData } = input

  const lines: string[] = []
  lines.push('// vpp_config.h — auto-generated, do not edit by hand.')
  lines.push('//')
  lines.push('// Carries the user-authored configuration-screen data for this')
  lines.push('// build target as C preprocessor #defines. The HAL driver')
  lines.push('// `#include`s this file and reads whatever subset it needs;')
  lines.push('// unused defines are harmless.')
  lines.push('')
  lines.push('#ifndef VPP_CONFIG_H')
  lines.push('#define VPP_CONFIG_H')
  lines.push('')

  if (vendorScreenData) {
    const screenData = withValidRs485Pins(vendorScreenData)
    const keys = Object.keys(screenData).sort()
    for (const key of keys) {
      const prefix = `VPP_${sanitize(key, true)}`
      walk(screenData[key], prefix, lines)
    }
    if (lines[lines.length - 1] !== '') lines.push('')
  }

  lines.push('#endif // VPP_CONFIG_H')
  lines.push('')
  return lines.join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `vendorScreenData` with the Serial screen's RS-485 pins limited to values matching the pin pattern:
 * invalid entries of `rs485_en_pins` are dropped as entered, and `rs485_en_pin` is trimmed, then kept
 * only when empty or valid.
 */
function withValidRs485Pins(vendorScreenData: Record<string, unknown>): Record<string, unknown> {
  const serial = vendorScreenData[SERIAL_SCREEN_STATE_KEY]
  if (!isRecord(serial)) return vendorScreenData

  const next: Record<string, unknown> = { ...serial }
  const legacyPin = typeof next['rs485_en_pin'] === 'string' ? next['rs485_en_pin'].trim() : next['rs485_en_pin']
  if (legacyPin === '' || isValidRs485Pin(legacyPin)) next['rs485_en_pin'] = legacyPin
  else if (legacyPin !== undefined) delete next['rs485_en_pin']
  const pins = next[RS485_PINS_KEY]
  if (isRecord(pins)) {
    next[RS485_PINS_KEY] = Object.fromEntries(Object.entries(pins).filter(([, pin]) => isValidRs485Pin(pin)))
  }
  return { ...vendorScreenData, [SERIAL_SCREEN_STATE_KEY]: next }
}

/**
 * Normalise a path segment for inclusion in a C identifier.  Non-
 * alphanumeric characters become `_`; identifiers are upper-cased.
 *
 * `topLevel` controls leading-digit handling. C identifiers can't
 * start with a digit, so a screen key like `"4g-network"` must
 * become `_4G_NETWORK` at the macro head. Nested keys (e.g.
 * `slotsConfig["1"]`) are concatenated AFTER an already-valid
 * parent path (`VPP_MODULE_CONFIGURATION_SLOTSCONFIG_`), so the
 * digit isn't at the head of the macro and no extra `_` is needed.
 * Adding one anyway would produce ugly double underscores like
 * `SLOTSCONFIG__1_…`.
 */
function sanitize(s: string, topLevel: boolean): string {
  const out = s.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
  if (topLevel && out.length > 0 && /^[0-9]/.test(out)) return `_${out}`
  return out
}

/**
 * Recursive emitter. `value` is the JSON node to serialise; `path`
 * is the macro-name prefix accumulated so far; `lines` is the output
 * buffer (mutated in place).
 *
 * Dispatches on the runtime type of `value`. Order of branches
 * matches the documented header shape (scalars, scalar arrays,
 * object arrays, nested objects).
 */
function walk(value: unknown, path: string, lines: string[]): void {
  if (value === null || value === undefined) return

  if (typeof value === 'boolean') {
    lines.push(`#define ${path} ${value ? 1 : 0}`)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return
    lines.push(`#define ${path} ${value.toString()}`)
    return
  }
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    lines.push(`#define ${path} "${escaped}"`)
    return
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`#define ${path}_COUNT 0`)
      return
    }

    const allScalar = value.every((el) => el === null || ['boolean', 'number', 'string'].includes(typeof el))

    if (allScalar) {
      const formatted = value.map((el) => {
        if (el === null) return '0'
        if (typeof el === 'boolean') return el ? '1' : '0'
        if (typeof el === 'number') {
          if (!Number.isFinite(el)) return '0'
          return el.toString()
        }
        const escaped = String(el)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
        return `"${escaped}"`
      })
      lines.push(`#define ${path}_COUNT ${value.length}`)
      lines.push(`#define ${path} { ${formatted.join(', ')} }`)
      return
    }

    lines.push(`#define ${path}_COUNT ${value.length}`)
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}_${i}`, lines)
    }
    if (value.length > 0) {
      const expansions = Array.from({ length: value.length }, (_, i) => `X(${i})`).join(' ')
      lines.push(`#define ${path}_FOREACH(X) ${expansions}`)
    }
    return
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    for (const k of keys) {
      walk(obj[k], `${path}_${sanitize(k, false)}`, lines)
    }
    return
  }
}
