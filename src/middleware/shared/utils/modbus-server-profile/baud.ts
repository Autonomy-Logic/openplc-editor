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
  }
  modbus_rtu?: {
    baud_rate?: string
    rtu_baud_rate?: string
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
export function resolveDefaultPortBaud(state: SerialBaudScreenState): string {
  return (
    state.serial?.baud_rate ?? state.modbus_rtu?.baud_rate ?? state.modbus_rtu?.rtu_baud_rate ?? DEFAULT_SERIAL_BAUD
  )
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
  if (onDefaultPort) return resolveDefaultPortBaud(state)
  if (typeof serverBaud === 'number' && Number.isFinite(serverBaud)) return String(serverBaud)
  return state.serial?.modbus_baud_rate ?? DEFAULT_SERIAL_BAUD
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

  const serial = section('serial')
  const rtu = section('modbus_rtu')

  return {
    serial: { baud_rate: text(serial, 'baud_rate'), modbus_baud_rate: text(serial, 'modbus_baud_rate') },
    modbus_rtu: { baud_rate: text(rtu, 'baud_rate'), rtu_baud_rate: text(rtu, 'rtu_baud_rate') },
  }
}
