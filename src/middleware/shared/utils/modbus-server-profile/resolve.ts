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

/**
 * Segments the baremetal firmware exposes. `%MX` is deliberately absent:
 * `Baremetal.ino` calls `init_mbregs` with `MAX_DIGITAL_OUTPUT` as the coil
 * count and there is no `bool_memory` array anywhere in `arduino/openplc.h`,
 * so a `%MX` row would name storage the board does not have.
 */
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

/** The catalogue's `arduino:avr:` boards whose MCU lands in the small table.
 *  `arduino:avr:mega` is an ATmega2560 and deliberately absent. */
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

/** Port name assumed when a package declares no `defaultSerial`. */
const FALLBACK_DEFAULT_SERIAL = 'Serial'

/** Canonical name of the always-on serial screen a split VPP ships. */
const SERIAL_SCREEN = 'serial'
/** Canonical name of the network screen a split VPP ships. */
const NETWORK_SCREEN = 'network'

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

/**
 * Resolve the Modbus-server profile for a board.
 *
 * The settings always live in the same place — a `PLCServer` in the project —
 * so what this decides is what the target LETS the user set:
 *
 *  - a board carrying a VPP Modbus screen is baremetal. Transports come from
 *    the capability matrix, the buffer sizes are the firmware's and read-only,
 *    the TCP port is fixed at 502, and the serial / network screens are linked
 *    rather than absorbed, because the package owns the physical layer.
 *  - a target reporting `modbusTcpServer` without such a screen hosts a server
 *    the project sizes and addresses itself. Runtime v4 and the Simulator.
 *  - anything else serves no Modbus, and reports no transports.
 */
export function resolveModbusServerProfile(board: ModbusBoardInfoLike | undefined | null): ModbusServerProfile {
  if (!board) return NO_SERVER

  const caps = resolveTargetCapabilities(board)
  const screens = board.vpp?.screens

  // Baremetal is the compiler, and only the compiler. It used to also be
  // recognised by the package shipping a Modbus screen, which was compatibility
  // with a pre-4.4.0 package -- and 4.4.0 does not carry that compatibility.
  const isBaremetal = board.compiler === 'arduino-cli'

  if (isBaremetal) {
    const transports: ModbusServerTransport[] = []
    // The default UART is offered like any other. It carries the editor's
    // connection, and the firmware serves the debugger and the register table
    // on it together (`MBSERIAL_SHARES_DEBUG_SERIAL`); which of the two the
    // user talks to at a given moment is theirs to arrange, not ours to refuse.
    if (caps.modbusRtuServer) transports.push('rtu')
    // The capability says the firmware CAN serve Modbus TCP; this decides
    // whether the board has a carrier to serve it over. Offering it without one
    // emits `MBTCP` into a firmware with no stack -- on an ESP32 with no RMII
    // PHY that compiles `MBTCP_ETHERNET` to `ETH.begin()` and never links.
    //
    // A package states its carriers by SHIPPING a Network screen: the 29
    // devices declaring `WiFi: No` and `Ethernet: No` ship none, and offering
    // TCP there emits `MBTCP` into a firmware with no stack -- on an ESP32 with
    // no RMII PHY that compiles `MBTCP_ETHERNET` to `ETH.begin()` and never
    // links. `networkInterfaces: []` is an explicit refusal and says the same.
    const hasNetwork = board.networkInterfaces?.length !== 0 && !!findScreen(screens, NETWORK_SCREEN)
    if (caps.modbusTcpServer && hasNetwork) transports.push('tcp')
    if (transports.length === 0) return NO_SERVER

    return {
      transports,
      segments: BAREMETAL_SEGMENTS,
      // Fixed at compile time by the MCU's MAX_* constants in `openplc.h`,
      // which also dimension the IEC pointer arrays and are aliased into the
      // Modbus banks by mapEmptyBuffers(). They are an I/O-image property
      // rather than a Modbus setting, so both sizing them and reporting them
      // belong to DOPE-615, which derives the image from the project.
      configurableBuffers: false,
      // The firmware reads `MBTCP_PORT` and falls back to 502 only when nothing
      // defines it (`modbus_tcp.cpp:12`), so the port IS the project's. It was
      // hard-coded in three places before this demand, and the screen still said
      // so -- which would have shown 502 for a project carrying 8502 and flashed
      // a board listening on the number the screen never displayed.
      configurablePort: true,
      // One network interface on a microcontroller; there is nothing to bind to.
      configurableBindAddress: false,
      serialPorts: board.serialPorts ?? [],
      defaultSerial: board.defaultSerial ?? FALLBACK_DEFAULT_SERIAL,
      fixedPort: BAREMETAL_TCP_PORT,
      derivedCounts: firmwareCounts(board.platform),
      minCounts: null,
      maxCounts: null,
      vppScreens: {
        serial: findScreen(screens, SERIAL_SCREEN),
        network: findScreen(screens, NETWORK_SCREEN),
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
    // A Runtime v4 target's Modbus is TCP only, so it declares no UART here.
    serialPorts: [],
    defaultSerial: FALLBACK_DEFAULT_SERIAL,
    fixedPort: DEFAULT_TCP_PORT,
    derivedCounts: null,
    minCounts: null,
    maxCounts: null,
    vppScreens: {},
  }
}
