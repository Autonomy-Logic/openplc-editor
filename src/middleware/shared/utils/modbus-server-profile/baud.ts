/** The serial line, resolved the same way for the screen and the compiler. */

/** What the firmware falls back to, and what every package declares. */
export const DEFAULT_SERIAL_BAUD = '115200'

/** What a server answers to when the project states nothing. */
export const DEFAULT_SERVER_SLAVE_ID = 1

/**
 * The slice of persisted VPP screen state these functions read: the Serial
 * screen, and only the fields it declares. Structural so `backend/shared` can
 * depend on this module without this module depending back on it.
 */
export interface SerialBaudScreenState {
  serial?: {
    baud_rate?: string
    enable_rs485_en_pin?: boolean
    rs485_en_pin?: string
    /** RS-485 enable pin per UART, written by the Serial screen's `uart-pin-map` field. */
    rs485_en_pins?: Record<string, string>
  }
}

/** First candidate that is a positive integer. */
function firstBaud(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value && /^[1-9][0-9]*$/.test(value)) return value
  }
  return DEFAULT_SERIAL_BAUD
}

/**
 * Speed of the board's default UART: the editor's own line, and the debugger's, whether or not a Modbus server
 * exists.
 */
export function resolveDefaultPortBaud(state: SerialBaudScreenState): string {
  return firstBaud([state.serial?.baud_rate])
}

/** Which UART the Modbus RTU server answers on. */
export function resolveRtuPort(serverPort: string | undefined, defaultSerial: string): string {
  const value = serverPort?.trim()
  return value ? value : defaultSerial
}

/** Whether `port` is the board's default UART, the one the editor is already on. */
export function isDefaultPort(port: string | undefined, defaultSerial: string): boolean {
  const value = port?.trim()
  return !value || value === defaultSerial
}

/** The slave id the Modbus server answers to. */
export function resolveServerSlaveId(serverSlaveId: number | undefined): number {
  return typeof serverSlaveId === 'number' && Number.isInteger(serverSlaveId) ? serverSlaveId : DEFAULT_SERVER_SLAVE_ID
}

/**
 * Speed of the UART the Modbus server answers on.
 *
 * On the default port there is nothing to decide: one UART has one speed, the
 * editor is already on it, and bit timing is not something the firmware can
 * route around the way it routes two slave ids by function code. So the
 * package's value wins and the screen shows it read-only.
 *
 * On a UART of its own the speed is the server's.
 */
export function resolveServerBaud(args: {
  onDefaultPort: boolean
  serverBaud: number | undefined
  state: SerialBaudScreenState
}): string {
  const { onDefaultPort, serverBaud, state } = args
  if (onDefaultPort) return resolveDefaultPortBaud(state)
  if (typeof serverBaud === 'number' && Number.isInteger(serverBaud) && serverBaud > 0) return String(serverBaud)
  return DEFAULT_SERIAL_BAUD
}

/** The string entries of an RS-485 pin map, or `undefined` when `value` is not an object. */
export function readRs485PinMap(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

/** Narrow raw persisted screen state into the slice these functions read. */
export function readSerialBaudState(raw: Record<string, unknown> | undefined | null): SerialBaudScreenState {
  const value = raw?.['serial']
  const serial = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  const read = (key: string): unknown => (serial as Record<string, unknown> | undefined)?.[key]
  const text = (key: string): string | undefined => {
    const found = read(key)
    return typeof found === 'string' && found.length > 0 ? found : undefined
  }
  const flag = (key: string): boolean | undefined => {
    const found = read(key)
    return typeof found === 'boolean' ? found : undefined
  }

  return {
    serial: {
      baud_rate: text('baud_rate'),
      enable_rs485_en_pin: flag('enable_rs485_en_pin'),
      rs485_en_pin: text('rs485_en_pin'),
      rs485_en_pins: readRs485PinMap(read('rs485_en_pins')),
    },
  }
}
