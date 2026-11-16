import { debuggerUart, FALLBACK_DEFAULT_SERIAL } from '../board-hardware/default-serial'
import { BOARD_NETWORK_SCREEN, BOARD_SERIAL_SCREEN, findBoardScreen } from '../board-screens'
import { resolveTargetCapabilities } from '../target-capabilities'
import type { ModbusSegment, ModbusSegmentCounts, ModbusServerProfile, ModbusServerTransport } from './types'

/** Minimal slice of BoardInfo the resolver reads. Loosely typed so a test
 *  fixture can hand over what it has instead of asserting a whole board. */
export type ModbusBoardInfoLike = {
  compiler?: string
  /** The board's fully-qualified name, e.g. `arduino:avr:uno`. Picks which of
   *  the firmware's two I/O size tables this board compiles with. */
  platform?: string
  capabilities?: Record<string, unknown>
  vpp?: { screens?: Record<string, unknown> } | null
  /** TCP carriers the board can actually bring up, from `device.networkInterfaces`.
   *  Absent means the package did not say, which keeps both on offer. */
  networkInterfaces?: string[]
  serialPorts?: string[]
  defaultSerial?: string
}

/** Every segment Runtime v4's Modbus slave plugin exposes, in block order. */
const RUNTIME_SEGMENTS: ModbusSegment[] = ['QW', 'MW', 'MD', 'ML', 'QX', 'MX', 'IX', 'IW']

/** Segments the baremetal firmware exposes. */
const BAREMETAL_SEGMENTS: ModbusSegment[] = ['QW', 'MW', 'MD', 'ML', 'QX', 'IX', 'IW']

/**
 * The firmware's I/O buffer sizes, mirroring `resources/sources/arduino/openplc.h`.
 *
 * That header carries two tables behind one `#if`, and the difference is not a
 * rounding: the small one has no `%MW`, `%MD` or `%ML` at all. `init_mbregs`
 * (`Baremetal.ino:257`) allocates the Modbus banks straight from these, so they
 * are what a board actually answers on -- not an estimate.
 *
 * The `#if` tests `__AVR_ATmega328P__ || __AVR_ATmega168__ || __AVR_ATmega32U4__
 * || __AVR_ATmega16U4__`, macros the compiler defines from `build.mcu`. The
 * editor never compiles, so it maps from the board's FQBN instead -- the same
 * string arduino-cli reads that value from.
 *
 * ADDING AN AVR BOARD: if its MCU is one of those four, add it to
 * `SMALL_AVR_PLATFORMS`. Anything absent falls to the large table, which is what
 * the header's own `#else` does for every other MCU.
 */
const SMALL_AVR_COUNTS: ModbusSegmentCounts = { QW: 32, MW: 0, MD: 0, ML: 0, QX: 32, MX: 0, IX: 8, IW: 6 }
const DEFAULT_COUNTS: ModbusSegmentCounts = { QW: 32, MW: 20, MD: 20, ML: 20, QX: 56, MX: 0, IX: 56, IW: 32 }

/** The catalogue's `arduino:avr:` boards whose MCU lands in the small table. */
const SMALL_AVR_PLATFORMS = new Set([
  'arduino:avr:uno',
  'arduino:avr:nano',
  'arduino:avr:leonardo',
  'arduino:avr:micro',
])

/** Counts the board compiles with, read off its FQBN. */
function firmwareCounts(platform: string | undefined): ModbusSegmentCounts {
  return platform && SMALL_AVR_PLATFORMS.has(platform) ? SMALL_AVR_COUNTS : DEFAULT_COUNTS
}

/** Port `modbus_tcp.cpp` hard-codes on every baremetal transport. */
const BAREMETAL_TCP_PORT = 502

/** The IANA Modbus port, and the default for a new Runtime v4 server. */
const DEFAULT_TCP_PORT = 502

/**
 * The profile for a target that serves no Modbus server at all — Runtime v3,
 * an unresolved board, a project opened before its VPP was installed.
 */
const NO_SERVER: ModbusServerProfile = {
  transports: [],
  segments: [],
  configurableBuffers: false,
  configurablePort: false,
  configurableBindAddress: false,
  serialPorts: [],
  defaultSerial: FALLBACK_DEFAULT_SERIAL,
  fixedPort: DEFAULT_TCP_PORT,
  derivedCounts: null,
  minCounts: null,
  maxCounts: null,
  vppScreens: {},
}

/** Resolve the Modbus-server profile for a board. */
export function resolveModbusServerProfile(board: ModbusBoardInfoLike | undefined | null): ModbusServerProfile {
  if (!board) return NO_SERVER

  const caps = resolveTargetCapabilities(board)
  const screens = board.vpp?.screens

  const isBaremetal = board.compiler === 'arduino-cli'

  if (isBaremetal) {
    const transports: ModbusServerTransport[] = []
    if (caps.modbusRtuServer) transports.push('rtu')
    const hasNetwork = board.networkInterfaces?.length !== 0 && !!findBoardScreen(screens, BOARD_NETWORK_SCREEN)
    if (caps.modbusTcpServer && hasNetwork) transports.push('tcp')
    if (transports.length === 0) return NO_SERVER

    return {
      transports,
      segments: BAREMETAL_SEGMENTS,
      configurableBuffers: true,
      configurablePort: true,
      configurableBindAddress: false,
      serialPorts: board.serialPorts ?? [],
      defaultSerial: debuggerUart(board),
      fixedPort: BAREMETAL_TCP_PORT,
      derivedCounts: firmwareCounts(board.platform),
      minCounts: null,
      maxCounts: null,
      vppScreens: {
        serial: findBoardScreen(screens, BOARD_SERIAL_SCREEN),
        network: findBoardScreen(screens, BOARD_NETWORK_SCREEN),
      },
    }
  }

  if (!caps.modbusTcpServer) return NO_SERVER

  return {
    transports: ['tcp'],
    segments: RUNTIME_SEGMENTS,
    configurableBuffers: true,
    configurablePort: true,
    configurableBindAddress: true,
    serialPorts: [],
    defaultSerial: FALLBACK_DEFAULT_SERIAL,
    fixedPort: DEFAULT_TCP_PORT,
    derivedCounts: null,
    minCounts: null,
    maxCounts: null,
    vppScreens: {},
  }
}
