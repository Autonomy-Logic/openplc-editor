import { BOARD_SERIAL_SCREEN, findBoardScreen } from '../board-screens'
import { type ModbusBoardInfoLike, resolveModbusServerProfile } from '../modbus-server-profile'
import { readRs485PinMap, resolveRtuPort, type SerialBaudScreenState } from '../modbus-server-profile/baud'

/** Shape every RS-485 enable pin must have: up to two capital letters, then one to three digits. */
export const RS485_PIN_PATTERN = /^[A-Z]{0,2}\d{1,3}$/

/** Field type of the Serial screen field that holds one RS-485 enable pin per UART. */
export const UART_PIN_MAP_FIELD_TYPE = 'uart-pin-map'

/** Persistence key of the Serial screen state in `vendorScreenData`. */
export const SERIAL_SCREEN_STATE_KEY = 'serial'

/** Key of the per-UART RS-485 pin map inside the Serial screen state. */
export const RS485_PINS_KEY = 'rs485_en_pins'

/** Serial screen state the RS-485 resolver reads. */
export type SerialScreenState = SerialBaudScreenState

/** Board facts the RS-485 resolver reads. */
export interface Rs485Board {
  serialPorts?: string[]
  rs485FixedPins?: Record<string, string>
  /** True when the Serial screen has a `uart-pin-map` field or the device declares `rs485FixedPins`. */
  perUartAware: boolean
}

/** Board facts `resolveRs485Pins` assumes when the caller gives none: today's Serial screen. */
export const LEGACY_RS485_BOARD: Rs485Board = { perUartAware: false }

/** Server shape `resolveRtuServerUart` reads. */
export interface RtuServerLike {
  protocol: string
  modbusSlaveConfig?: {
    enabled?: boolean
    transports?: readonly string[]
    serialPort?: string
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/** Whether `value` is a string matching `RS485_PIN_PATTERN`, as entered. */
export function isValidRs485Pin(value: unknown): value is string {
  return typeof value === 'string' && RS485_PIN_PATTERN.test(value)
}

/** The single pin of a 4.3.x Serial screen, or `null` when its switch is off or the pin is empty. */
function legacyPin(serial: SerialScreenState['serial']): string | null {
  if (serial?.enable_rs485_en_pin !== true) return null
  const pin = serial.rs485_en_pin
  return typeof pin === 'string' && pin.length > 0 ? pin : null
}

/**
 * RS-485 enable pin of each UART, for the Serial screen and for the build.
 *
 * Precedence on a per-UART aware board: the package's fixed pins, then `rs485_en_pins`, then the legacy
 * pin on `rtuServerUart` while `rs485_en_pins` is absent. On a legacy board the legacy pin goes to
 * `rtuServerUart`. Only values matching `RS485_PIN_PATTERN` are returned; `state` is never modified.
 *
 * @param state Serial screen state as persisted.
 * @param board The board's UARTs, fixed pins and whether it is per-UART aware.
 * @param rtuServerUart UART of the enabled Modbus RTU server, or `null` when there is none.
 * @returns Pin per UART.
 */
export function resolveRs485Pins(
  state: SerialScreenState,
  board: Rs485Board,
  rtuServerUart: string | null,
): Record<string, string> {
  const legacy = legacyPin(state.serial)

  if (!board.perUartAware) {
    return rtuServerUart !== null && isValidRs485Pin(legacy) ? Object.fromEntries([[rtuServerUart, legacy]]) : {}
  }

  const fixed = readRs485PinMap(board.rs485FixedPins) ?? {}
  const perUart = readRs485PinMap(state.serial?.rs485_en_pins)
  const entries: Array<[string, string]> = []

  if (perUart) {
    for (const [uart, pin] of Object.entries(perUart)) {
      if (!hasOwn(fixed, uart) && isValidRs485Pin(pin)) entries.push([uart, pin])
    }
  } else if (rtuServerUart !== null && !hasOwn(fixed, rtuServerUart) && isValidRs485Pin(legacy)) {
    entries.push([rtuServerUart, legacy])
  }

  for (const [uart, pin] of Object.entries(fixed)) {
    if (isValidRs485Pin(pin)) entries.push([uart, pin])
  }

  return Object.fromEntries(entries)
}

/** Pin `resolveRs485Pins` gives `uart`, or `undefined` when it gives none. */
export function rs485PinOf(pins: Record<string, string>, uart: string): string | undefined {
  return hasOwn(pins, uart) ? pins[uart] : undefined
}

/**
 * UART the project's Modbus RTU server answers on, or `null` when no single enabled server serves RTU
 * on a board that offers it.
 */
export function resolveRtuServerUart(
  servers: readonly RtuServerLike[] | undefined,
  board: ModbusBoardInfoLike | undefined | null,
): string | null {
  const profile = resolveModbusServerProfile(board)
  if (!profile.transports.includes('rtu')) return null

  const serving = (servers ?? []).filter(
    (entry) =>
      entry.protocol === 'modbus-tcp' &&
      entry.modbusSlaveConfig !== undefined &&
      entry.modbusSlaveConfig.enabled !== false &&
      (entry.modbusSlaveConfig.transports?.length ?? 0) > 0,
  )
  if (serving.length !== 1) return null

  const config = serving[0].modbusSlaveConfig
  if (!config?.transports?.includes('rtu')) return null
  return resolveRtuPort(config.serialPort, profile.defaultSerial)
}

/** Whether a parsed screen definition has a field of type `uart-pin-map` in any of its sections. */
export function screenHasUartPinMap(definition: unknown): boolean {
  if (!isPlainObject(definition) || !Array.isArray(definition.sections)) return false
  return definition.sections.some(
    (section) =>
      isPlainObject(section) &&
      Array.isArray(section.fields) &&
      section.fields.some((field) => isPlainObject(field) && field.type === UART_PIN_MAP_FIELD_TYPE),
  )
}

/** Name the device's Serial screen is keyed under, case-insensitively, or `undefined` when it ships none. */
export function findSerialScreenName(screens: Record<string, unknown> | undefined): string | undefined {
  return findBoardScreen(screens, BOARD_SERIAL_SCREEN)
}

/**
 * Whether a board takes RS-485 pins per UART.
 *
 * @param board.rs485FixedPins The device's fixed pins, when it declares any.
 * @param board.serialScreen The parsed Serial screen definition, when the device ships one.
 */
export function isRs485PerUartAware(board: { rs485FixedPins?: unknown; serialScreen?: unknown }): boolean {
  return isPlainObject(board.rs485FixedPins) || screenHasUartPinMap(board.serialScreen)
}

/**
 * Serial screen state to store: once `rs485_en_pins` is written, the legacy `enable_rs485_en_pin` and
 * `rs485_en_pin` are removed in the same update. Any other value is returned as given.
 */
export function withoutLegacyRs485Pin(serial: unknown): unknown {
  if (!isPlainObject(serial) || !hasOwn(serial, RS485_PINS_KEY)) return serial
  const next = { ...serial }
  delete next['enable_rs485_en_pin']
  delete next['rs485_en_pin']
  return next
}
