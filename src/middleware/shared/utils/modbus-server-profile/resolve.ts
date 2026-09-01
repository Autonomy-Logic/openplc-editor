/**
 * Resolve a target's Modbus-server profile from its BoardInfo.
 *
 * Pure function — same board in, same profile out. No store, no IPC, no React.
 * Safe on a hot path; expected cost is O(number of VPP screens), which is
 * single digits.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

import { resolveTargetCapabilities } from '../target-capabilities'
import type { ModbusSegment, ModbusSegmentCounts, ModbusServerProfile, ModbusServerTransport } from './types'

/** Minimal slice of BoardInfo the resolver reads. Loosely typed so a test
 *  fixture can hand over what it has instead of asserting a whole board. */
export type ModbusBoardInfoLike = {
  compiler?: string
  capabilities?: Record<string, unknown>
  vpp?: { screens?: Record<string, unknown> } | null
  io?: Partial<Record<keyof IoSizeFields, number>>
  ioMax?: Partial<Record<keyof IoSizeFields, number>>
}

/** Firmware buffer sizes a VPP declares per device, mirroring the `MAX_*`
 *  constants the board compiles with in `arduino/openplc.h`. */
export interface IoSizeFields {
  digitalInput: number
  digitalOutput: number
  analogInput: number
  analogOutput: number
  memoryWord: number
  memoryDword: number
  memoryLword: number
}

/** Every segment Runtime v4's Modbus slave plugin exposes, in block order. */
const RUNTIME_SEGMENTS: ModbusSegment[] = ['QW', 'MW', 'MD', 'ML', 'QX', 'MX', 'IX', 'IW']

/**
 * Segments the baremetal firmware exposes. `%MX` is deliberately absent:
 * `Baremetal.ino` calls `init_mbregs` with `MAX_DIGITAL_OUTPUT` as the coil
 * count and there is no `bool_memory` array anywhere in `arduino/openplc.h`,
 * so a `%MX` row would name storage the board does not have.
 */
const BAREMETAL_SEGMENTS: ModbusSegment[] = ['QW', 'MW', 'MD', 'ML', 'QX', 'IX', 'IW']

/** Port `modbus_tcp.cpp` hard-codes on every baremetal transport. */
const BAREMETAL_TCP_PORT = 502

/** The IANA Modbus port, and the default for a new Runtime v4 server. */
const DEFAULT_TCP_PORT = 502

/** Canonical name of the always-on serial screen a split VPP ships. */
const SERIAL_SCREEN = 'serial'
/** Canonical name of the network screen a split VPP ships. */
const NETWORK_SCREEN = 'network'
/** Canonical name of the Modbus screen every arduino-cli VPP ships. */
const MODBUS_SCREEN = 'modbus'

/**
 * Find a VPP screen by its canonical name, case-insensitively.
 *
 * Packages key screens by display name (`"Modbus"`, `"Serial"`, `"Network"`),
 * and the schema does not constrain the casing. Matching loosely means a
 * package that writes `"modbus"` still resolves, which costs nothing and saves
 * a support thread.
 */
function findScreen(screens: Record<string, unknown> | undefined, canonical: string): string | undefined {
  if (!screens) return undefined
  return Object.keys(screens).find((name) => name.toLowerCase() === canonical)
}

/**
 * Map a board's declared firmware buffer sizes onto IEC segment counts.
 *
 * The pairing is `init_mbregs`'s argument list read backwards
 * (`Baremetal.ino:247`): holding registers are `%QW` followed by `%MW`, the
 * 32- and 64-bit banks are `%MD` and `%ML`, coils are `%QX` alone, input
 * status is `%IX` and input registers are `%IW`.
 */
function countsFromIoSizes(io: Partial<IoSizeFields>): ModbusSegmentCounts | null {
  const required: Array<keyof IoSizeFields> = [
    'digitalInput',
    'digitalOutput',
    'analogInput',
    'analogOutput',
    'memoryWord',
    'memoryDword',
    'memoryLword',
  ]
  // A partially declared block is worse than none: it would render an address
  // map whose later segments start at the wrong offset.
  if (required.some((key) => typeof io[key] !== 'number')) return null

  return {
    QW: io.analogOutput as number,
    MW: io.memoryWord as number,
    MD: io.memoryDword as number,
    ML: io.memoryLword as number,
    QX: io.digitalOutput as number,
    MX: 0,
    IX: io.digitalInput as number,
    IW: io.analogInput as number,
  }
}

/**
 * The profile for a target that serves no Modbus server at all — Runtime v3,
 * an unresolved board, a project opened before its VPP was installed.
 */
const NO_SERVER: ModbusServerProfile = {
  store: 'none',
  transports: [],
  segments: [],
  configurableBuffers: false,
  configurablePort: false,
  configurableBindAddress: false,
  fixedPort: DEFAULT_TCP_PORT,
  derivedCounts: null,
  minCounts: null,
  maxCounts: null,
  vppScreens: {},
}

/**
 * Resolve the Modbus-server profile for a board.
 *
 * Three outcomes, decided by where the settings live rather than by which
 * runtime it is:
 *
 *  - **vendor-screen** — the board carries a VPP Modbus screen. Baremetal.
 *    Transports come from the capability matrix, buffers are read-only, the
 *    port is fixed, and the serial / network screens are linked rather than
 *    absorbed.
 *  - **plc-server** — the target hosts a TCP server the project configures.
 *    Runtime v4 and the Simulator.
 *  - **none** — neither.
 *
 * A board with a VPP Modbus screen wins over the `plc-server` path even when
 * its capabilities also report `modbusTcpServer`, because the screen IS where
 * that board's Modbus state already lives; reading it from a `PLCServer`
 * instead would silently drop every existing project's configuration.
 */
export function resolveModbusServerProfile(board: ModbusBoardInfoLike | undefined | null): ModbusServerProfile {
  if (!board) return NO_SERVER

  const caps = resolveTargetCapabilities(board)
  const screens = board.vpp?.screens
  const modbusScreen = findScreen(screens, MODBUS_SCREEN)

  if (modbusScreen) {
    const defaults = board.io ? countsFromIoSizes(board.io) : null
    // A ceiling is only meaningful alongside the defaults it raises.
    const ceilings = defaults && board.ioMax ? countsFromIoSizes({ ...board.io, ...board.ioMax }) : null

    const transports: ModbusServerTransport[] = []
    if (caps.modbusRtuServer) transports.push('rtu')
    if (caps.modbusTcpServer) transports.push('tcp')
    if (transports.length === 0) return NO_SERVER

    return {
      store: 'vendor-screen',
      transports,
      segments: BAREMETAL_SEGMENTS,
      // Fixed at compile time by the MCU's MAX_* constants, which also size
      // the IEC pointer arrays. Phase 5 (DOPE-370) is what makes these move.
      // Raisable only when the package states both what the firmware compiles
      // and how far the board can be pushed. A package that declares neither
      // -- or only the defaults -- leaves nothing for the user to change, and
      // an input that cannot move is worse than a number.
      configurableBuffers: !!defaults && !!ceilings,
      configurablePort: false,
      configurableBindAddress: false,
      fixedPort: BAREMETAL_TCP_PORT,
      derivedCounts: defaults,
      // Never below the firmware default: these counts dimension the IEC
      // pointer arrays too, and mapEmptyBuffers() aliases %MW/%MD/%ML into the
      // Modbus banks, so shrinking a segment drops I/O silently.
      minCounts: defaults,
      maxCounts: ceilings,
      vppScreens: {
        serial: findScreen(screens, SERIAL_SCREEN),
        network: findScreen(screens, NETWORK_SCREEN),
        modbus: modbusScreen,
      },
    }
  }

  if (!caps.modbusTcpServer) return NO_SERVER

  return {
    store: 'plc-server',
    transports: ['tcp'],
    segments: RUNTIME_SEGMENTS,
    configurableBuffers: true,
    configurablePort: true,
    configurableBindAddress: true,
    fixedPort: DEFAULT_TCP_PORT,
    derivedCounts: null,
    minCounts: null,
    maxCounts: null,
    vppScreens: {},
  }
}
