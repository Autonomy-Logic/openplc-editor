/**
 * The serial line, resolved the same way for the screen and the compiler.
 *
 * It lives here rather than beside the `defines.h` emitter for one reason: the
 * screen has to show exactly what the build will emit, and a hook may not import
 * from `backend/shared`. Two copies of the same chain is how a screen ends up
 * quietly disagreeing with the firmware, which is the failure this area keeps
 * producing.
 *
 * Every value below has exactly one source. The project's `PLCServer` owns the
 * protocol -- which UART, its speed when the server has it to itself, the slave
 * id. The board's package owns the physical line -- the default UART's speed and
 * the RS-485 driver-enable pin, through the Serial screen. Nothing reads a
 * pre-4.4.0 project's `modbus_rtu` section: 4.4.0 does not carry configuration
 * forward, and a project from before it creates its server again.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

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
  }
}

/**
 * First candidate that is a positive integer.
 *
 * `??` alone would return a persisted empty string, and this is the number the
 * editor dials to reach the debugger: a bad one locks the board out with no
 * diagnostic anywhere.
 */
function firstBaud(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value && /^[1-9][0-9]*$/.test(value)) return value
  }
  return DEFAULT_SERIAL_BAUD
}

/**
 * Speed of the board's default UART: the editor's own line, and the debugger's,
 * whether or not a Modbus server exists. It belongs to the package because it is
 * a property of that link rather than of any server.
 */
export function resolveDefaultPortBaud(state: SerialBaudScreenState): string {
  return firstBaud([state.serial?.baud_rate])
}

/**
 * Which UART the Modbus RTU server answers on.
 *
 * One resolver, because the screen and the emitter each used to derive this and
 * a disagreement between them puts a read-only baud on screen while the build
 * emits `MBSERIAL_ON_SECONDARY` for a different port.
 */
export function resolveRtuPort(serverPort: string | undefined, defaultSerial: string): string {
  const value = serverPort?.trim()
  return value ? value : defaultSerial
}

/** Whether `port` is the board's default UART, the one the editor is already on. */
export function isDefaultPort(port: string | undefined, defaultSerial: string): boolean {
  const value = port?.trim()
  return !value || value === defaultSerial
}

/**
 * The slave id the Modbus server answers to.
 *
 * Trivial today, and deliberately still a function both sides call: this was the
 * last value resolved in two places, and the screen showed one id while the
 * firmware compiled another.
 */
export function resolveServerSlaveId(serverSlaveId: number | undefined): number {
  return typeof serverSlaveId === 'number' && Number.isInteger(serverSlaveId) ? serverSlaveId : DEFAULT_SERVER_SLAVE_ID
}

/**
 * The RS-485 driver-enable pin, or `null` when the board drives none.
 *
 * The package's, through the Serial screen: it is a property of the transceiver
 * wired to that UART, not of whatever protocol happens to be speaking on it.
 */
export function resolveRs485Pin(state: SerialBaudScreenState): string | null {
  if (state.serial?.enable_rs485_en_pin !== true) return null
  const pin = state.serial.rs485_en_pin?.trim()
  return pin ? pin : null
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
  // A fraction, a zero or a negative reaches the firmware as `Serial1.begin(...)`
  // and either fails to compile or opens a dead line the screen confirms as good.
  if (typeof serverBaud === 'number' && Number.isInteger(serverBaud) && serverBaud > 0) return String(serverBaud)
  return DEFAULT_SERIAL_BAUD
}

/**
 * Narrow raw persisted screen state into the slice these functions read.
 *
 * The store holds it as `Record<string, unknown>` because a package may declare
 * any sections it likes, so the fields have to be checked rather than asserted:
 * this is a user's project file, and a value of the wrong type here would put a
 * bad baud rate on screen and into the build.
 */
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
    },
  }
}
