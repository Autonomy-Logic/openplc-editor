import type { PinPullSpec } from '../../../../middleware/shared/ports/types'
import { IMAGE_TABLES } from '../../../../middleware/shared/utils/io-image/tables'
import type { Rs485Board } from '../../../../middleware/shared/utils/modbus-master-profile'
import { PIN_PULL_CODES, resolveEffectivePinPull } from '../../../../middleware/shared/utils/pin-pull'
import type { DevicePin } from '../../types/PLC/devices'
import type { IoImageSizes } from './compute-io-image'
import {
  DEBUG_SLAVE,
  generateModbusDefines,
  type ModbusServerCompileConfig,
  resolveDefaultPortBaud,
  type VppModbusScreenState,
} from './modbus-defines'

export type { VppModbusScreenState } from './modbus-defines'

/**
 * IEC prefix → the `MAX_*` macro `openplc.h` declares its buffer from, in emission order, which reads like the
 * header does: inputs before outputs, I/O before memory.
 */
/* The nine macros bare metal declares, and the order it declares them in, both derived from the one table list. */
const PROCESS_IMAGE_MACROS: ReadonlyArray<readonly [prefix: string, macro: string]> = IMAGE_TABLES.filter(
  (table): table is typeof table & { macro: string } => table.macro !== undefined,
).map((table) => [table.prefix, table.macro] as const)

/** Bit areas reach the firmware as a whole number of bytes. */
const BITS_PER_BYTE = 8
const BIT_MACRO_PREFIXES: ReadonlySet<string> = new Set(['%IX', '%QX'])

function firmwareCount(prefix: string, slots: number): number {
  if (!BIT_MACRO_PREFIXES.has(prefix)) return slots
  return Math.ceil(slots / BITS_PER_BYTE) * BITS_PER_BYTE
}

/** The `//Process image` block, or `''` when the caller passed no sizes. */
export function generateProcessImageDefines(sizes: IoImageSizes | undefined): string {
  if (!sizes) return ''

  let block = '//Process image\n'
  for (const [prefix, macro] of PROCESS_IMAGE_MACROS) {
    block += `#define ${macro} ${firmwareCount(prefix, sizes[prefix] ?? 0)}\n`
  }
  return block
}

/** Slice of a `hals.json` board entry read here. */
export interface BoardHalsDefinesEntry {
  /** Per-board #defines.  Can be a single string (`"BOARD_ID=42"`)
   *  or an array of strings.  Each entry is emitted verbatim as
   *  `#define <entry>` so callers control the value-vs-flag form. */
  define?: string | string[]
}

export interface GenerateDefinesInput {
  /** The board entry from `hals.json` for the current target.
   *  `undefined` when the board has no entry (defensive — should
   *  not happen in a real build).  When present and carrying a
   *  `define` field, those become the "Board defines" section. */
  boardEntry?: BoardHalsDefinesEntry | undefined
  /** Pin mappings parsed from `devices/pin-mapping.json`.  The
   *  generator filters by `pinType` and emits one PINMASK per
   *  category (`DIN` / `AIN` / `DOUT` / `AOUT`) plus matching
   *  count defines (`NUM_DISCRETE_INPUT` etc.). */
  devicePinMapping: DevicePin[]
  /** MD5 hash of `program.st` bytes — embedded as `PROGRAM_MD5` so
   *  the runtime can detect a stale upload (a v4 runtime reports
   *  this back on `FC 0x45` and the debugger uses it to confirm
   *  the layout it's reading matches the program it last
   *  uploaded). */
  buildMD5Hash: string
  /** Runtime identifier from `hals.json` (`'simulator'` /
   *  `'arduino-cli'` / `'openplc-compiler'`).  Only `'simulator'`
   *  changes the output here — it adds the SIMULATOR_MODE +
   *  fixed-Modbus block, which the avr8js emulator's serial
   *  bridge keys off.  Real Arduino targets emit comms defines
   *  via VPP packages instead. */
  boardRuntime: string
  /** Persisted VPP Modbus screen state, sourced from
   *  `DeviceConfiguration.vendorScreenData` under the
   *  `modbus_rtu` / `modbus_tcp` keys.  When present and the
   *  runtime is anything other than `'simulator'`, the emitter
   *  swaps the comms-config block for `generateModbusDefines()`
   *  output (canonical `MBSERIAL_*` / `MBTCP_*` macros consumed
   *  by `resources/sources/Baremetal/ModbusSlave.cpp`).
   *  Simulator targets ignore this field — they always emit the
   *  fixed RTU-over-USART0 block.  Web passes `undefined` until
   *  VPP screens land on the web build. */
  vppModbusState?: VppModbusScreenState
  /** The project's Modbus server, when it has one. Says what is served; the
   *  screen state says what it is served over. */
  modbusServer?: ModbusServerCompileConfig
  /** Name of the board's default serial port (from the VPP manifest device's
   *  `defaultSerial`; `BoardInfo.defaultSerial`). Drives `DEBUG_IFACE` and the
   *  RTU "shares the debug serial" flag. Absent → `Serial`. */
  defaultSerial?: string
  /** Slots the project needs per IEC address area, from `computeIoImage`. */
  imageSizes?: IoImageSizes

  /** The board's `networkInterfaces`, forwarded to `generateModbusDefines`
   *  so a project that never picked a carrier compiles for the one the
   *  board has instead of assuming Ethernet. */
  networkInterfaces?: string[]
  /** The board's UARTs, fixed RS-485 pins and per-UART awareness, forwarded to `generateModbusDefines`
   *  for `MBSERIAL_TXPIN`. Absent → legacy board. */
  rs485Board?: Rs485Board
  /**
   * Bytes the program's retain blob occupies (`debugMap.retainBlobSize`); absent or 0 when the program retains
   * nothing.
   */
  retainBlobSize?: number
  /** The board's `pins.pull` spec. Present → `PINPULL_DIN` is emitted, one code per digital input
   *  in `PINMASK_DIN` order; absent → nothing, and the HAL keeps plain `INPUT`. */
  pinPull?: PinPullSpec
}

/**
 * Build the contents of `defines.h`.
 *
 * Output sections, in order:
 *   1. `// Board defines` — `boardEntry.define`; omitted entirely when
 *      the board declares none.
 *   2. `#define PROGRAM_MD5 "<md5>"` — always.
 *   3. `// Comms Configuration` (simulator-only) — fixed Modbus RTU
 *      over emulated USART0 so avr8js's serial bridge can drive
 *      Modbus traffic into the running emulator.
 *   4. `// IO Config` — PINMASK_{DIN,AIN,DOUT,AOUT} + NUM_* derived
 *      from `devicePinMapping`.
 *
 * The output is plain C preprocessor text terminated with newlines
 * matching the editor's emission exactly (so a byte-diff between
 * editor-produced and web-produced firmware comes out clean).
 */
export function generateDefinesContent(input: GenerateDefinesInput): string {
  const {
    boardEntry,
    devicePinMapping,
    buildMD5Hash,
    boardRuntime,
    vppModbusState,
    modbusServer,
    defaultSerial,
    networkInterfaces,
    rs485Board,
    retainBlobSize,
    imageSizes,
    pinPull,
  } = input

  let DEFINES_CONTENT = ''

  const boardDefines: string[] = []
  if (boardEntry && boardEntry.define) {
    if (Array.isArray(boardEntry.define)) {
      boardDefines.push(...boardEntry.define)
    } else if (typeof boardEntry.define === 'string') {
      boardDefines.push(boardEntry.define)
    }
  }
  if (boardDefines.length > 0) {
    DEFINES_CONTENT = '// Board defines\n'
    boardDefines.forEach((define) => {
      DEFINES_CONTENT += `#define ${define}\n`
    })
  }

  DEFINES_CONTENT += '\n\n'

  DEFINES_CONTENT += '//Program MD5\n'
  DEFINES_CONTENT += `#define PROGRAM_MD5 "${buildMD5Hash}"`
  DEFINES_CONTENT += `\n\n`

  if (boardRuntime === 'simulator') {
    DEFINES_CONTENT += '//Comms Configuration\n'
    DEFINES_CONTENT += '#define SIMULATOR_MODE\n'
    DEFINES_CONTENT += '#define MBSERIAL_IFACE Serial\n'
    DEFINES_CONTENT += '#define MBSERIAL_BAUD 115200\n'
    DEFINES_CONTENT += '#define MBSERIAL_SLAVE 1\n'
    DEFINES_CONTENT += '#define MBSERIAL\n'
    DEFINES_CONTENT += '#define MODBUS_ENABLED\n'
    DEFINES_CONTENT += `\n\n`
  } else if (boardRuntime !== 'openplc-compiler' && vppModbusState) {
    const modbusBlock = generateModbusDefines(
      vppModbusState,
      defaultSerial,
      modbusServer,
      networkInterfaces,
      rs485Board,
    )
    if (modbusBlock.length > 0) {
      DEFINES_CONTENT += modbusBlock
      DEFINES_CONTENT += '\n\n'
    }
  }

  if (boardRuntime !== 'simulator' && boardRuntime !== 'openplc-compiler') {
    DEFINES_CONTENT += '//Debugger\n'
    DEFINES_CONTENT += '#define DEBUGGER_ENABLED\n'
    DEFINES_CONTENT += `#define DEBUG_IFACE ${defaultSerial ?? 'Serial'}\n`
    DEFINES_CONTENT += `#define DEBUG_BAUD ${resolveDefaultPortBaud(vppModbusState ?? {})}\n`
    DEFINES_CONTENT += `#define DEBUG_SLAVE ${DEBUG_SLAVE}\n`
    DEFINES_CONTENT += `\n\n`
  }

  DEFINES_CONTENT += '//IO Config\n'
  const digitalInputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalInput')
  const analogInputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogInput')
  const digitalOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalOutput')
  const analogOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogOutput')

  DEFINES_CONTENT += `#define PINMASK_DIN ${digitalInputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_AIN ${analogInputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_DOUT ${digitalOutputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_AOUT ${analogOutputPins.map(({ pin }) => pin).join(', ')}\n`
  if (pinPull) {
    const codes = digitalInputPins.map((pin) => PIN_PULL_CODES[resolveEffectivePinPull(pinPull, pin)])
    DEFINES_CONTENT += `#define PINPULL_DIN ${codes.join(', ')}\n`
  }

  DEFINES_CONTENT += `#define NUM_DISCRETE_INPUT ${digitalInputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_ANALOG_INPUT ${analogInputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_DISCRETE_OUTPUT ${digitalOutputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_ANALOG_OUTPUT ${analogOutputPins.length}\n`
  DEFINES_CONTENT += `\n\n`

  if (retainBlobSize !== undefined && retainBlobSize > 0) {
    DEFINES_CONTENT += '\n//Retain\n'
    DEFINES_CONTENT += `#define OPLC_RETAIN_BLOB_SIZE ${retainBlobSize}\n`
  }

  const imageBlock = generateProcessImageDefines(imageSizes)
  if (imageBlock.length > 0) {
    DEFINES_CONTENT += `\n${imageBlock}`
  }

  return DEFINES_CONTENT
}
