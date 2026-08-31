/**
 * Author the `defines.h` content for an OpenPLC build target.
 *
 * Editor-canonical behavior — every byte of the output matches what
 * the editor's `compiler-module.ts` `handleGenerateDefinitionsFile`
 * used to emit directly to disk.  Lifted into shared so both repos'
 * build pipelines author the same `defines.h` from the same inputs:
 * the OpenPLC runtime keys off `PROGRAM_MD5` to detect stale programs,
 * and the per-board `USE_*_BLOCK` defines gate which Arduino libraries
 * the firmware links against.  Drift here would manifest as either
 * the runtime refusing the program (MD5 mismatch) or undefined-symbol
 * link errors for blocks the program references.
 *
 * Pure function: no fs I/O, no DOM, no global state.  Caller writes
 * the returned string to `defines.h` at the platform-appropriate
 * location (editor: `build/<target>/src/defines.h`; web: bundled
 * into the in-memory file map sent to `/compile-arduino`).
 */

import type { DevicePin } from '../../types/PLC/devices'
import { generateModbusDefines, resolveDebugBaud, resolveDebugSlave, type VppModbusScreenState } from './modbus-defines'

export type { VppModbusScreenState } from './modbus-defines'

/**
 * Slice of a `hals.json` board entry we read here.  Defined inline
 * rather than reusing one of the existing repo-specific Hals types
 * so this module stays free of editor-only types (`HalsFile` lives
 * in `src/backend/editor/...`) and the web's slightly different
 * `BoardHalsCompileEntry`.  Both shapes carry the optional `define`
 * field; we only need that.
 */
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
  /** Concatenated ST program content (the output of the ST transpiler).
   *  Scanned with `String.prototype.includes` for the marker
   *  function-block names that toggle the Arduino-library
   *  `USE_*_BLOCK` defines.  The set of marker strings here is
   *  the canonical list — every change MUST match what the
   *  firmware's HAL headers `#ifdef`-gate on. */
  stProgramFileContent: string
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
  /** Name of the board's default serial port (from the VPP manifest device's
   *  `defaultSerial`; `BoardInfo.defaultSerial`). Drives `DEBUG_IFACE` and the
   *  RTU "shares the debug serial" flag. Absent → `Serial`. */
  defaultSerial?: string
  /** Bytes the program's retain blob occupies (`debugMap.retainBlobSize`);
   *  absent or 0 when the program retains nothing.
   *
   *  Emitted as `OPLC_RETAIN_BLOB_SIZE` so the firmware can `static_assert`
   *  it against its own buffer. Without it, a program retaining more than the
   *  board holds links, runs, and drops retain in silence — there is no
   *  console on a microcontroller to report it, so the check has to happen at
   *  build time or not at all. */
  retainBlobSize?: number
  /** Whether this target's board package declares `isLicensable`
   *  (`TargetCapabilities.isLicensable`).  Governs one define, and the
   *  polarity is deliberately inverted: a licensable board gets nothing,
   *  and EVERY OTHER board gets `OPENPLC_NO_UNIQUE_ID`.
   *
   *  A hardware unique id exists for exactly one purpose — binding a paid
   *  VPP licence to a board — so a free target has no use for one, and
   *  `ArduinoUniqueID` (which `#error`s on any core it doesn't cover, mbed
   *  included) should never enter the build for one.  Absent is read as
   *  `false`: a package that says nothing about licensing is a free
   *  package, and the safe default is the one that compiles everywhere.
   *
   *  `modbus_debug.cpp` reads the flag; with it set, `FC 0x48` answers
   *  `id_len = 0`, which `device-probe` and the licence flow already treat
   *  as "this board has no unique id". */
  isLicensable?: boolean
}

/**
 * Build the contents of `defines.h`.
 *
 * Output sections, in order:
 *   1. `// Board defines` — `boardEntry.define` plus
 *      `OPENPLC_NO_UNIQUE_ID` on every non-licensable target; omitted
 *      entirely only when both sources are empty.
 *   2. `#define PROGRAM_MD5 "<md5>"` — always.
 *   3. `// Comms Configuration` (simulator-only) — fixed Modbus RTU
 *      over emulated USART0 so avr8js's serial bridge can drive
 *      Modbus traffic into the running emulator.
 *   4. `// IO Config` — PINMASK_{DIN,AIN,DOUT,AOUT} + NUM_* derived
 *      from `devicePinMapping`.
 *   5. `// Arduino libraries` — `USE_*_BLOCK` toggles gated on FB
 *      names appearing in the ST source.
 *
 * The output is plain C preprocessor text terminated with newlines
 * matching the editor's emission exactly (so a byte-diff between
 * editor-produced and web-produced firmware comes out clean).
 */
export function generateDefinesContent(input: GenerateDefinesInput): string {
  const {
    boardEntry,
    devicePinMapping,
    stProgramFileContent,
    buildMD5Hash,
    boardRuntime,
    vppModbusState,
    defaultSerial,
    retainBlobSize,
    isLicensable,
  } = input

  let DEFINES_CONTENT = ''

  // 1. Board defines.  Two sources, both landing under the one
  //    `// Board defines` header:
  //      - `hals.json`'s per-board `define` field (single-string and
  //        array forms both supported, emitted verbatim);
  //      - `OPENPLC_NO_UNIQUE_ID`, emitted for every target that is NOT
  //        licensable — see the `isLicensable` field doc for why the
  //        default is the flag rather than its absence.
  //    An empty list means no header at all (the next section starts
  //    directly), which is the pre-licensing behaviour for a board with
  //    no `define` field.
  const boardDefines: string[] = []
  if (boardEntry && boardEntry.define) {
    if (Array.isArray(boardEntry.define)) {
      boardDefines.push(...boardEntry.define)
    } else if (typeof boardEntry.define === 'string') {
      boardDefines.push(boardEntry.define)
    }
  }
  if (isLicensable !== true) {
    boardDefines.push('OPENPLC_NO_UNIQUE_ID')
  }
  if (boardDefines.length > 0) {
    DEFINES_CONTENT = '// Board defines\n'
    boardDefines.forEach((define) => {
      DEFINES_CONTENT += `#define ${define}\n`
    })
  }

  // 2. Trailing blank-line pair after the board-defines section
  //    (or at the top of the file when board defines were absent —
  //    intentional so the PROGRAM_MD5 block always lands two blank
  //    lines below whatever preceded it, matching editor).
  DEFINES_CONTENT += '\n\n'

  // 3. Program MD5 — load-bearing for the runtime's stale-program
  //    detection.  Always emitted.
  DEFINES_CONTENT += '//Program MD5\n'
  DEFINES_CONTENT += `#define PROGRAM_MD5 "${buildMD5Hash}"`
  DEFINES_CONTENT += `\n\n`

  // 4. Comms Configuration.  Two sources, mutually exclusive:
  //      - Simulator: fixed RTU-over-USART0 macros the avr8js
  //        emulator's serial bridge keys off.  Always emitted on
  //        simulator targets regardless of vppModbusState.
  //      - Arduino-family baremetal: emitted from the persisted
  //        VPP Modbus screen state via `generateModbusDefines()`.
  //        The historical `communicationConfigurationSchema`
  //        pipeline (removed in c379c7a9c) used to source this
  //        from `DeviceConfiguration.communicationConfiguration`;
  //        the VPP screen replaces it.  Empty/disabled screens
  //        emit nothing — `ModbusSlave.cpp` then sees no
  //        MODBUS_ENABLED define and stays quiescent.
  //    Runtime-v4 / runtime-v3 targets route Modbus config through
  //    `conf/modbus_slave.json` in the upload bundle and emit no
  //    macros here.
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
    const modbusBlock = generateModbusDefines(vppModbusState, defaultSerial)
    if (modbusBlock.length > 0) {
      DEFINES_CONTENT += modbusBlock
      DEFINES_CONTENT += '\n\n'
    }
  }

  // 4b. Debugger — always-on serial debugger for baremetal Arduino targets.
  //     The default serial port is ALWAYS initialised (DEBUG_IFACE @ DEBUG_BAUD)
  //     so the debug function codes (0x41-0x48) respond over serial regardless
  //     of whether Modbus is configured — without allocating operation buffers.
  //     When Modbus RTU runs on that same default port, generateModbusDefines
  //     emits MBSERIAL_SHARES_DEBUG_SERIAL so the firmware begins the port once.
  //     Simulator uses its fixed MODBUS_ENABLED block above; openplc-compiler
  //     runtimes don't use this firmware at all.
  if (boardRuntime !== 'simulator' && boardRuntime !== 'openplc-compiler') {
    DEFINES_CONTENT += '//Debugger\n'
    DEFINES_CONTENT += '#define DEBUGGER_ENABLED\n'
    DEFINES_CONTENT += `#define DEBUG_IFACE ${defaultSerial ?? 'Serial'}\n`
    // Not `serial.baud_rate ?? 115200`: a package published without a `serial`
    // section still configures a baud — on the RTU section — and when the RTU
    // shares the default port that IS this port's speed. Ignoring it compiled a
    // firmware listening at 115200 while the editor dialled the RTU's baud, and
    // the board answered nothing ("No Firmware Detected" on a healthy board).
    DEFINES_CONTENT += `#define DEBUG_BAUD ${resolveDebugBaud(vppModbusState ?? {}, defaultSerial)}\n`
    // Same two-sided agreement as the baud, and the same symptom when it breaks:
    // the firmware drops every frame whose slave id doesn't match, and that check
    // is the only validation debug function codes get. The editor addresses the
    // RTU screen's slave id whether or not the RTU is enabled, so emit it rather
    // than leaving modbus_config.h's `#ifndef DEBUG_SLAVE 1` fallback to disagree
    // with a project that configured anything else.
    DEFINES_CONTENT += `#define DEBUG_SLAVE ${resolveDebugSlave(vppModbusState ?? {})}\n`
    DEFINES_CONTENT += `\n\n`
  }

  // 5. IO Config — derived from devicePinMapping.  Pin order is
  //    the iteration order of the input array; callers are
  //    expected to have sorted by address.
  DEFINES_CONTENT += '//IO Config\n'
  const digitalInputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalInput')
  const analogInputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogInput')
  const digitalOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalOutput')
  const analogOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogOutput')

  DEFINES_CONTENT += `#define PINMASK_DIN ${digitalInputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_AIN ${analogInputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_DOUT ${digitalOutputPins.map(({ pin }) => pin).join(', ')}\n`
  DEFINES_CONTENT += `#define PINMASK_AOUT ${analogOutputPins.map(({ pin }) => pin).join(', ')}\n`

  DEFINES_CONTENT += `#define NUM_DISCRETE_INPUT ${digitalInputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_ANALOG_INPUT ${analogInputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_DISCRETE_OUTPUT ${digitalOutputPins.length}\n`
  DEFINES_CONTENT += `#define NUM_ANALOG_OUTPUT ${analogOutputPins.length}\n`
  DEFINES_CONTENT += `\n\n`

  // 6. Arduino libraries — toggled on FB names appearing in the ST.
  //    The marker-string set here is the canonical list; the
  //    firmware HAL headers `#ifdef`-gate `#include` directives off
  //    these names, so adding a marker here without a matching
  //    HAL change is harmless, but adding a HAL gate without the
  //    matching marker here silently breaks link.
  DEFINES_CONTENT += '//Arduino libraries\n'

  if (
    stProgramFileContent.includes('DS18B20;') ||
    stProgramFileContent.includes('DS18B20_2_OUT;') ||
    stProgramFileContent.includes('DS18B20_3_OUT;') ||
    stProgramFileContent.includes('DS18B20_4_OUT;') ||
    stProgramFileContent.includes('DS18B20_5_OUT;')
  ) {
    DEFINES_CONTENT += '#define USE_DS18B20_BLOCK\n'
  }

  if (stProgramFileContent.includes('P1AM_INIT;')) DEFINES_CONTENT += '#define USE_P1AM_BLOCKS\n'

  if (stProgramFileContent.includes('CLOUD_BEGIN;')) DEFINES_CONTENT += '#define USE_CLOUD_BLOCKS\n'

  if (stProgramFileContent.includes('MQTT_CONNECT;') || stProgramFileContent.includes('MQTT_CONNECT_AUTH;'))
    DEFINES_CONTENT += '#define USE_MQTT_BLOCKS\n'

  if (
    stProgramFileContent.includes('ARDUINOCAN_CONF;') ||
    stProgramFileContent.includes('ARDUINOCAN_WRITE;') ||
    stProgramFileContent.includes('ARDUINOCAN_WRITE_WORD;') ||
    stProgramFileContent.includes('ARDUINOCAN_READ;')
  ) {
    DEFINES_CONTENT += '#define USE_ARDUINOCAN_BLOCK\n'
  }

  if (
    stProgramFileContent.includes('STM32CAN_CONF;') ||
    stProgramFileContent.includes('STM32CAN_WRITE;') ||
    stProgramFileContent.includes('STM32CAN_READ;')
  ) {
    DEFINES_CONTENT += '#define USE_STM32CAN_BLOCK\n'
  }

  if (
    stProgramFileContent.includes('SM_8RELAY;') ||
    stProgramFileContent.includes('SM_16RELAY;') ||
    stProgramFileContent.includes('SM_8DIN;') ||
    stProgramFileContent.includes('SM_16DIN;') ||
    stProgramFileContent.includes('SM_4REL4IN;') ||
    stProgramFileContent.includes('SM_INDUSTRIAL;') ||
    stProgramFileContent.includes('SM_RTD;') ||
    stProgramFileContent.includes('SM_BAS;') ||
    stProgramFileContent.includes('SM_HOME;') ||
    stProgramFileContent.includes('SM_8MOSFET;')
  ) {
    DEFINES_CONTENT += '#define USE_SM_BLOCKS\n'
  }

  // 6. Retain blob size.  Emitted only when the program retains something,
  //    so boards that never touch retain see no change at all.  The firmware
  //    static_asserts this against RETAIN_BUFFER_MAX: a program that outgrows
  //    the buffer must fail the build rather than silently start behaving as
  //    NON_RETAIN on a machine somebody has already installed.
  if (retainBlobSize !== undefined && retainBlobSize > 0) {
    DEFINES_CONTENT += '\n//Retain\n'
    DEFINES_CONTENT += `#define OPLC_RETAIN_BLOB_SIZE ${retainBlobSize}\n`
  }

  return DEFINES_CONTENT
}
