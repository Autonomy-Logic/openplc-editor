/**
 * The speed of a serial line, resolved the same way for the screen and the
 * compiler.
 *
 * It lives here rather than beside the `defines.h` emitter for one reason: the
 * screen has to show exactly what the build will emit, and a hook may not import
 * from `backend/shared`. Two copies of the same fallback chain is how a screen
 * ends up quietly disagreeing with the firmware, which is the failure this area
 * keeps producing.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

/** What the firmware falls back to, and what every package declares. */
export const DEFAULT_SERIAL_BAUD = '115200'

/**
 * The slice of persisted VPP screen state these functions read. Declared
 * structurally so `backend/shared` can depend on this module without this module
 * depending back on it.
 */
export interface SerialBaudScreenState {
  serial?: {
    baud_rate?: string
    modbus_baud_rate?: string
    modbus_port?: string
    enable_rs485_en_pin?: boolean
    rs485_en_pin?: string
  }
  /** The pre-split spellings. `migrate-modbus-serial-fields` folds them into
   *  `serial`, but it runs in the STORE while the compiler reads the project
   *  from disk -- and on a board whose package was never split it never runs at
   *  all. Reading only the new keys loses the user's wiring on exactly the
   *  projects that still carry the old ones. */
  modbus_rtu?: {
    baud_rate?: string
    rtu_baud_rate?: string
    serial_port?: string
    rtu_interface?: string
    enable_rs485_en_pin?: boolean
    rtu_rs485_en_pin?: string
  }
}

/**
 * Speed of the board's default UART: the editor's own line, and the debugger's,
 * whether or not a Modbus server exists. It belongs to the package because it is
 * a property of that link rather than of any server.
 *
 * The `modbus_rtu` arms carry a package published before it declared a `serial`
 * section. The editor's version floor stops an old EDITOR meeting a new package;
 * nothing stops a new editor meeting an old package, which is what they are for.
 */
export function resolveDefaultPortBaud(state: SerialBaudScreenState, rtuSharesDefaultPort = false): string {
  const candidates = [state.serial?.baud_rate]
  // The legacy arms are the RTU's own speed under its pre-split spellings, so
  // they only describe THIS port when the RTU was on it. A project running RTU
  // on Serial1 at 9600 must not bring the USB port up at 9600 -- the editor
  // would then be dialling a speed nothing answers on. `serial.modbus_baud_rate`
  // is where the fold lands that same value, so it belongs to the same arm.
  if (rtuSharesDefaultPort) {
    candidates.push(state.serial?.modbus_baud_rate, state.modbus_rtu?.baud_rate, state.modbus_rtu?.rtu_baud_rate)
  }
  return firstBaud(candidates)
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
 * Which UART the Modbus RTU server answers on.
 *
 * One resolver, because the screen and the emitter each used to derive this and
 * a disagreement between them puts a read-only baud on screen while the build
 * emits `MBSERIAL_ON_SECONDARY` for a different port.
 *
 * Precedence matches `migrate-modbus-serial-fields`: the new key first, then the
 * two older spellings, then the board's default UART.
 */
export function resolveRtuPort(
  state: SerialBaudScreenState,
  serverPort: string | undefined,
  defaultSerial: string,
): string {
  const candidates = [
    serverPort,
    state.serial?.modbus_port,
    state.modbus_rtu?.serial_port,
    state.modbus_rtu?.rtu_interface,
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value) return value
  }
  return defaultSerial
}

/** Whether `port` is the board's default UART, the one the editor is already on. */
export function isDefaultPort(port: string | undefined, defaultSerial: string): boolean {
  const value = port?.trim()
  return !value || value === defaultSerial
}

/**
 * The RS-485 driver-enable pin, or `null` when the board drives none.
 *
 * Same reason as the port: the fields moved from `modbus_rtu` to `serial`, and
 * reading only the new home drops the pin on every project the fold has not
 * reached -- after which the transceiver never asserts DE and the board
 * receives but never answers.
 */
export function resolveRs485Pin(state: SerialBaudScreenState): string | null {
  const enabled = state.serial?.enable_rs485_en_pin ?? state.modbus_rtu?.enable_rs485_en_pin
  if (enabled !== true) return null
  const pin = (state.serial?.rs485_en_pin ?? state.modbus_rtu?.rtu_rs485_en_pin)?.trim()
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
 * On a UART of its own the speed is the server's, and `serial.modbus_baud_rate`
 * is only a fallback: it is where the value lived before it became the server's,
 * so a project that has a server but no `baudRate` keeps building what it built
 * yesterday.
 */
export function resolveServerBaud(args: {
  onDefaultPort: boolean
  serverBaud: number | undefined
  state: SerialBaudScreenState
}): string {
  const { onDefaultPort, serverBaud, state } = args
  if (onDefaultPort) return resolveDefaultPortBaud(state, true)
  // Same rule as the default port's: a fraction, a zero or a negative reaches
  // the firmware as `Serial1.begin(...)` and either fails to compile or opens a
  // dead line the screen confirms as configured.
  if (typeof serverBaud === 'number' && Number.isInteger(serverBaud) && serverBaud > 0) return String(serverBaud)
  // The legacy arms are the RTU's own speed, and on a UART of its own the RTU is
  // by definition the thing on it -- so unlike the default port, they always
  // apply here.
  return firstBaud([state.serial?.modbus_baud_rate, state.modbus_rtu?.baud_rate, state.modbus_rtu?.rtu_baud_rate])
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
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const section = (name: string): Record<string, unknown> | undefined => {
    const value = raw?.[name]
    return isRecord(value) ? value : undefined
  }
  const text = (source: Record<string, unknown> | undefined, key: string): string | undefined => {
    const value = source?.[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  const flag = (source: Record<string, unknown> | undefined, key: string): boolean | undefined => {
    const value = source?.[key]
    return typeof value === 'boolean' ? value : undefined
  }

  const serial = section('serial')
  const rtu = section('modbus_rtu')

  return {
    serial: {
      baud_rate: text(serial, 'baud_rate'),
      modbus_baud_rate: text(serial, 'modbus_baud_rate'),
      modbus_port: text(serial, 'modbus_port'),
      enable_rs485_en_pin: flag(serial, 'enable_rs485_en_pin'),
      rs485_en_pin: text(serial, 'rs485_en_pin'),
    },
    modbus_rtu: {
      baud_rate: text(rtu, 'baud_rate'),
      rtu_baud_rate: text(rtu, 'rtu_baud_rate'),
      serial_port: text(rtu, 'serial_port'),
      rtu_interface: text(rtu, 'rtu_interface'),
      enable_rs485_en_pin: flag(rtu, 'enable_rs485_en_pin'),
      rtu_rs485_en_pin: text(rtu, 'rtu_rs485_en_pin'),
    },
  }
}
