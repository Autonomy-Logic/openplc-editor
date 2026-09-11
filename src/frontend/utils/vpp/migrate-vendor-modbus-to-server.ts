/**
 * Promote a baremetal board's Modbus configuration to a real `PLCServer`.
 *
 * Until 4.4.0 a baremetal target had no server element: its Modbus lived in the
 * `modbus_rtu` and `modbus_tcp` sections of the board's VPP screen, which the
 * package ships whether or not anyone wanted a server. Protocol configuration
 * now belongs to the editor and travels in `project.data.servers` like every
 * other target's, so a project saved by an older editor owes this migration on
 * open.
 *
 * What it does NOT do, deliberately: it copies rather than moves. The sections
 * stay where they are until the compile pipeline reads the server instead
 * (FR20), because until then the emitter is still the only consumer and
 * stripping them would produce a project that opens fine and compiles to a
 * firmware with no Modbus at all. That is why re-running it has to be cheap and
 * safe, and why the skip below keys on the SERVER rather than on the sections.
 *
 * Idempotent: a project whose servers already speak the new model (any of them
 * carrying `transports`) is left alone, so reopening does not accumulate
 * `mb_baremetal_server_2`, `_3`, and so on.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

import type { PLCServer } from '../../../middleware/shared/ports/types'

/** VPP section ids the pre-4.4.0 shape carried protocol configuration in. */
const RTU_SECTION = 'modbus_rtu'
const TCP_SECTION = 'modbus_tcp'
/** Where the RTU's wiring lands once `migrate-modbus-serial-fields` has run. */
const SERIAL_SECTION = 'serial'

/** Name the migrated server takes, before any collision suffix. */
export const MIGRATED_SERVER_NAME = 'mb_baremetal_server'

/** Port every baremetal build listens on: `modbus_tcp.cpp` hard-codes 502. */
const BAREMETAL_TCP_PORT = 502

function asSection(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isEnabled(section: Record<string, unknown> | null): boolean {
  return section?.enabled === true
}

/**
 * Screens persist numbers as strings often enough that reading one straight
 * would silently produce `NaN` in the emitted config.
 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Keep only a value the project schema would accept back.
 *
 * A screen field is free text, so a legacy project can carry `rtu_slave_id: 300`
 * or a fractional baud. Persisting one produces a server that
 * `ModbusSlaveConfigSchema` rejects on the NEXT load, where the parser skips it
 * with a warning nobody reads -- and `alreadyMigrated` is then false again, so
 * the server the user can see in the tree disappears on every open, the project
 * is dirty every time, and the compile quietly falls back to the screen
 * sections. Dropping the bad field migrates everything else and ends the loop.
 */
function inRange(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * First value that is actually present, in precedence order.
 *
 * The RTU's UART and its speed have lived under three spellings: `serial`'s
 * `modbus_port` / `modbus_baud_rate` today, `modbus_rtu`'s `serial_port` /
 * `baud_rate` from the first screen split, and `rtu_interface` /
 * `rtu_baud_rate` from the original single-screen shape.
 * `migrate-modbus-serial-fields` folds the old spellings forward, but it runs
 * when the board list resolves and this runs on project load, so the keys are
 * still under their old names here -- and on a board whose package was never
 * split it never runs at all. Reading only the new key drops the user's wiring
 * on exactly the projects this migration exists for.
 */
function firstOf(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

/** A project is already on the new model when any server declares transports. */
function alreadyMigrated(servers: readonly PLCServer[] | undefined): boolean {
  return !!servers?.some((server) => Array.isArray(server.modbusSlaveConfig?.transports))
}

/** First free name in the `mb_baremetal_server`, `_2`, `_3` … sequence. */
function freeName(taken: ReadonlySet<string>): string {
  if (!taken.has(MIGRATED_SERVER_NAME)) return MIGRATED_SERVER_NAME
  for (let suffix = 2; ; suffix++) {
    const candidate = `${MIGRATED_SERVER_NAME}_${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The server a pre-4.4.0 baremetal project implies, or `null` when there is
 * nothing to migrate.
 *
 * `vendorScreenData` is the ACTIVE board's bucket, not the per-board archive:
 * a `PLCServer` is project-scoped, so only the board the project is currently
 * built for can contribute one. Migrating every archived board would create a
 * server per board the project had ever been opened against.
 */
export function planVendorModbusMigration(
  vendorScreenData: Record<string, unknown> | undefined,
  servers: readonly PLCServer[] | undefined,
): PLCServer | null {
  if (!vendorScreenData || alreadyMigrated(servers)) return null

  const rtu = asSection(vendorScreenData[RTU_SECTION])
  const tcp = asSection(vendorScreenData[TCP_SECTION])
  const serial = asSection(vendorScreenData[SERIAL_SECTION])

  const transports: ('rtu' | 'tcp')[] = []
  if (isEnabled(rtu)) transports.push('rtu')
  if (isEnabled(tcp)) transports.push('tcp')
  // A board serving nothing had no server, and `BR05` says one is never
  // implied. The sections being present is not evidence of intent -- the
  // package ships them on every board.
  if (transports.length === 0) return null

  const slaveId = inRange(asNumber(rtu?.rtu_slave_id), 1, 247)
  const serialPort = asString(firstOf(serial?.modbus_port, rtu?.serial_port, rtu?.rtu_interface))
  const baudRate = inRange(asNumber(firstOf(serial?.modbus_baud_rate, rtu?.baud_rate, rtu?.rtu_baud_rate)), 1, 4000000)

  return {
    name: freeName(new Set((servers ?? []).map((server) => server.name))),
    protocol: 'modbus-tcp',
    modbusSlaveConfig: {
      enabled: true,
      transports,
      // Baremetal binds every interface and listens on a fixed port; neither is
      // configurable there, so these carry the firmware's own answer rather
      // than a user choice.
      networkInterface: '0.0.0.0',
      port: BAREMETAL_TCP_PORT,
      ...(slaveId !== undefined ? { slaveId } : {}),
      ...(serialPort !== undefined ? { serialPort } : {}),
      ...(baudRate !== undefined ? { baudRate } : {}),
    },
  }
}
