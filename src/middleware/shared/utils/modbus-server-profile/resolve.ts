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

  // Baremetal is the compiler, not a screen. It used to be recognised by the
  // package shipping a Modbus screen, which stopped being a signal once that
  // screen's contents became the editor's: a package with nothing left to put
  // there ships none, and every board would have silently resolved as a
  // Runtime v4 target. The screen is still accepted so a package published
  // before the split keeps working.
  const modbusScreen = findScreen(screens, MODBUS_SCREEN)
  const isBaremetal = board.compiler === 'arduino-cli' || !!modbusScreen

  if (isBaremetal) {
    const transports: ModbusServerTransport[] = []
    // The default UART is offered like any other. It carries the editor's
    // connection, and the firmware serves the debugger and the register table
    // on it together (`MBSERIAL_SHARES_DEBUG_SERIAL`); which of the two the
    // user talks to at a given moment is theirs to arrange, not ours to refuse.
    if (caps.modbusRtuServer) transports.push('rtu')
    if (caps.modbusTcpServer) transports.push('tcp')
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
      configurablePort: false,
      configurableBindAddress: false,
      serialPorts: board.serialPorts ?? [],
      defaultSerial: board.defaultSerial ?? FALLBACK_DEFAULT_SERIAL,
      fixedPort: BAREMETAL_TCP_PORT,
      // The editor cannot know them: they are chosen by an MCU-family macro
      // inside a header the build never reports back, and nothing in the
      // project declares them. The screen says so rather than showing a map it
      // would be guessing at.
      derivedCounts: null,
      minCounts: null,
      maxCounts: null,
      vppScreens: {
        serial: findScreen(screens, SERIAL_SCREEN),
        network: findScreen(screens, NETWORK_SCREEN),
        modbus: modbusScreen,
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
