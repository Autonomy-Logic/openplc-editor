import type { DevicePin, PinPullMode, PinPullOverride, PinPullSpec } from '../../ports/types'

export type PinPullRule =
  | { kind: 'fixed'; value: PinPullMode }
  | { kind: 'select'; options: PinPullMode[]; default: PinPullMode }

/** Firmware codes for `PINPULL_DIN`; the HAL maps them to its own pinMode constants. */
export const PIN_PULL_CODES: Record<PinPullMode, number> = { none: 0, up: 1, down: 2 }

export const PIN_PULL_LABELS: Record<PinPullMode, string> = { none: 'None', up: 'Pull-up', down: 'Pull-down' }

const isNumericPin = (pin: string) => /^\d+$/.test(pin)

/** Numeric names match by value, so a table entry "5" finds a manifest key "05" and vice versa. */
function findPinOverride(spec: PinPullSpec, pin: string): PinPullOverride | undefined {
  const pins = spec.pins
  if (!pins) return undefined
  if (pins[pin]) return pins[pin]
  if (!isNumericPin(pin)) return undefined
  const key = Object.keys(pins).find((k) => isNumericPin(k) && Number(k) === Number(pin))
  return key === undefined ? undefined : pins[key]
}

export function resolvePinPullRule(spec: PinPullSpec, pin: string): PinPullRule {
  const override = findPinOverride(spec, pin.trim())
  if (override?.fixed) return { kind: 'fixed', value: override.fixed }

  const options = override?.options?.length ? override.options : spec.options
  if (options.length === 0) return { kind: 'fixed', value: 'none' }
  if (options.length === 1) return { kind: 'fixed', value: options[0] }

  const preferred = override?.default ?? spec.default ?? 'none'
  return { kind: 'select', options, default: options.includes(preferred) ? preferred : options[0] }
}

/** A stored value the rule no longer allows (the pin was renamed) falls back to the rule's default. */
export function resolveEffectivePinPull(spec: PinPullSpec, pin: Pick<DevicePin, 'pin' | 'pull'>): PinPullMode {
  const rule = resolvePinPullRule(spec, pin.pin)
  if (rule.kind === 'fixed') return rule.value
  return pin.pull && rule.options.includes(pin.pull) ? pin.pull : rule.default
}
