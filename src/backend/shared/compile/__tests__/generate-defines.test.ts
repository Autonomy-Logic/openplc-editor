/**
 * Tests for the shared `defines.h` content authoring step.
 *
 * The byte-for-byte snapshot tests are load-bearing: the OpenPLC
 * runtime keys off `PROGRAM_MD5` for stale-program detection, and
 * the firmware HAL headers `#ifdef`-gate include directives on the
 * `USE_*_BLOCK` toggles emitted here.  Any drift in this output
 * would surface as either the runtime refusing the upload, or
 * undefined-symbol link errors at firmware compile time.
 *
 * Pinning the canonical editor output here means a future change to
 * any byte (formatting, line breaks, marker set) must be intentional
 * — these tests will catch it.
 */

import type { DevicePin } from '../../types/PLC/devices'
import { type BoardHalsDefinesEntry, generateDefinesContent } from '../steps/generate-defines'

function makePin(overrides: { pin: string | number; pinType: DevicePin['pinType']; address?: string }): DevicePin {
  return {
    pin: String(overrides.pin),
    pinType: overrides.pinType,
    address: overrides.address ?? '%IX0.0',
  }
}

const EMPTY_INPUTS = {
  boardEntry: undefined as BoardHalsDefinesEntry | undefined,
  devicePinMapping: [] as DevicePin[],
  stProgramFileContent: '',
  buildMD5Hash: 'abc123',
  boardRuntime: 'arduino-cli',
}

describe('generateDefinesContent — board defines section', () => {
  // `isLicensable: true` throughout this block: it is the only input that
  // empties the board-defines list, and these cases are about the
  // `boardEntry.define` half.  The licensing half has its own block below.
  const LICENSABLE = { ...EMPTY_INPUTS, isLicensable: true }

  it('omits the Board defines header when no boardEntry is provided', () => {
    const out = generateDefinesContent(LICENSABLE)
    expect(out).not.toContain('// Board defines')
  })

  it('omits the Board defines header when boardEntry has no define field', () => {
    const out = generateDefinesContent({ ...LICENSABLE, boardEntry: {} })
    expect(out).not.toContain('// Board defines')
  })

  it('emits a single define from a string boardEntry.define', () => {
    const out = generateDefinesContent({ ...LICENSABLE, boardEntry: { define: 'BOARD_X' } })
    expect(out).toContain('// Board defines\n#define BOARD_X\n')
  })

  it('emits multiple defines from an array boardEntry.define', () => {
    const out = generateDefinesContent({
      ...LICENSABLE,
      boardEntry: { define: ['BOARD_X', 'PIN_COUNT=8', 'HAS_ANALOG'] },
    })
    expect(out).toContain('// Board defines\n#define BOARD_X\n#define PIN_COUNT=8\n#define HAS_ANALOG\n')
  })

  it('omits the Board defines header when boardEntry.define is an empty array', () => {
    // An empty array used to emit a bare header with no defines under it
    // (the emitter gated the header on `define` being truthy, and `[]` is).
    // Collecting the defines into a list first means the header follows the
    // list, so this corner now emits nothing — reachable only on a
    // licensable board, of which there are none yet.
    const out = generateDefinesContent({ ...LICENSABLE, boardEntry: { define: [] } })
    expect(out).not.toContain('// Board defines')
    expect(out.startsWith('\n\n')).toBe(true)
  })
})

describe('generateDefinesContent — OPENPLC_NO_UNIQUE_ID', () => {
  // The flag keeps `ArduinoUniqueID` out of the build on any board that
  // cannot be licensed, which is what makes the library's `#error` on an
  // uncovered core (mbed — Opta, Portenta Machine Control, Edge Control) a
  // non-problem.  Its polarity is inverted on purpose, so the DEFAULT is
  // tested as hard as the exception.
  it('emits the flag when isLicensable is absent (a package that says nothing is free)', () => {
    const out = generateDefinesContent(EMPTY_INPUTS)
    expect(out).toContain('// Board defines\n#define OPENPLC_NO_UNIQUE_ID\n')
  })

  it('emits the flag when isLicensable is explicitly false', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, isLicensable: false })
    expect(out).toContain('#define OPENPLC_NO_UNIQUE_ID')
  })

  it('omits the flag only when isLicensable is true', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, isLicensable: true })
    expect(out).not.toContain('OPENPLC_NO_UNIQUE_ID')
  })

  it('emits the flag for the simulator, which is not licensable', () => {
    // The avr8js simulator has real AVR silicon behind it, so
    // ArduinoUniqueID would work there — but a simulated board cannot hold
    // a licence, so FC 0x48 reports no id like any other free target.
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'simulator' })
    expect(out).toContain('#define OPENPLC_NO_UNIQUE_ID')
  })

  it('appends the flag after the board`s own defines rather than replacing them', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardEntry: { define: ['BOARD_X', 'PIN_COUNT=8'] } })
    expect(out).toContain('// Board defines\n#define BOARD_X\n#define PIN_COUNT=8\n#define OPENPLC_NO_UNIQUE_ID\n')
  })
})

describe('generateDefinesContent — PROGRAM_MD5', () => {
  it('always emits PROGRAM_MD5 with the supplied hash', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, buildMD5Hash: 'deadbeef' })
    expect(out).toContain('//Program MD5\n#define PROGRAM_MD5 "deadbeef"\n\n')
  })

  it('emits PROGRAM_MD5 even with an empty hash string', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, buildMD5Hash: '' })
    expect(out).toContain('#define PROGRAM_MD5 ""')
  })
})

describe('generateDefinesContent — simulator comms block', () => {
  it('emits the SIMULATOR_MODE block when boardRuntime === "simulator"', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'simulator' })
    expect(out).toContain('//Comms Configuration\n')
    expect(out).toContain('#define SIMULATOR_MODE\n')
    expect(out).toContain('#define MBSERIAL_IFACE Serial\n')
    expect(out).toContain('#define MBSERIAL_BAUD 115200\n')
    expect(out).toContain('#define MBSERIAL_SLAVE 1\n')
    expect(out).toContain('#define MBSERIAL\n')
    expect(out).toContain('#define MODBUS_ENABLED\n')
  })

  it('omits the SIMULATOR_MODE block for non-simulator runtimes', () => {
    const arduinoCli = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'arduino-cli' })
    const openplcCompiler = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'openplc-compiler' })
    expect(arduinoCli).not.toContain('SIMULATOR_MODE')
    expect(arduinoCli).not.toContain('Comms Configuration')
    expect(openplcCompiler).not.toContain('SIMULATOR_MODE')
    expect(openplcCompiler).not.toContain('Comms Configuration')
  })

  it('emits a Modbus defines block from vppModbusState on arduino-cli runtimes', () => {
    // arduino-cli is the runtime that drives `defines.h`-based Modbus
    // config; runtime-v3/v4 route via `conf/modbus_slave.json` and
    // skip this path. The state here exercises the rtu+tcp branches
    // in `generateModbusDefines` so we know the wiring is end-to-end.
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      vppModbusState: {
        modbus_rtu: {
          enabled: true,
          rtu_interface: 'Serial1',
          rtu_baud_rate: '115200',
          rtu_slave_id: 1,
        },
      },
    })
    expect(out).toContain('#define MBSERIAL_IFACE Serial1')
    expect(out).toContain('#define MBSERIAL_BAUD 115200')
    expect(out).toContain('#define MBSERIAL_SLAVE 1')
    expect(out).toContain('#define MODBUS_ENABLED')
  })

  it('skips the vppModbusState branch entirely for openplc-compiler', () => {
    // openplc-compiler emits no MODBUS macros even when a screen
    // payload is present — runtime-v3/v4 own that config via JSON.
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'openplc-compiler',
      vppModbusState: {
        modbus_rtu: { enabled: true, rtu_interface: 'Serial1', rtu_baud_rate: '115200', rtu_slave_id: 1 },
      },
    })
    expect(out).not.toContain('MBSERIAL_IFACE')
    expect(out).not.toContain('MODBUS_ENABLED')
  })

  it('omits the Modbus block when vppModbusState produces an empty payload', () => {
    // generateModbusDefines returns "" when both rtu and tcp are
    // disabled — the wrapper must not append the trailing blank
    // lines in that case (the visible behaviour is "the block is
    // simply absent", same as no vppModbusState supplied).
    const withEmptyState = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      vppModbusState: { modbus_rtu: { enabled: false }, modbus_tcp: { enabled: false } },
    })
    const withoutState = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'arduino-cli' })
    // Same output either way — empty state collapses to no block.
    expect(withEmptyState).toEqual(withoutState)
  })
})

describe('generateDefinesContent — Debugger block (always-on debug)', () => {
  it('emits DEBUGGER_ENABLED for a baremetal arduino-cli target with no Modbus', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'arduino-cli' })
    expect(out).toContain('//Debugger\n#define DEBUGGER_ENABLED\n')
  })

  it('emits DEBUGGER_ENABLED when the Modbus screen is present but disabled', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      vppModbusState: { modbus_rtu: { enabled: false }, modbus_tcp: { enabled: false } },
    })
    expect(out).toContain('#define DEBUGGER_ENABLED')
  })

  it('emits DEBUGGER_ENABLED even when full Modbus is enabled (always-on serial debugger)', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      vppModbusState: {
        serial: { baud_rate: '9600' },
        modbus_rtu: { enabled: true, serial_port: 'Serial', rtu_slave_id: 1 },
      },
      defaultSerial: 'Serial',
    })
    expect(out).toContain('#define DEBUGGER_ENABLED')
    // RTU on the default serial → shares the debugger's port (single begin()).
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it('emits DEBUG_IFACE from defaultSerial and DEBUG_BAUD from the Serial section', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: { serial: { baud_rate: '9600' } },
    })
    expect(out).toContain('#define DEBUG_IFACE Serial')
    expect(out).toContain('#define DEBUG_BAUD 9600')
  })

  it('falls back to DEBUG_IFACE Serial and DEBUG_BAUD 115200 when unset', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'arduino-cli' })
    expect(out).toContain('#define DEBUG_IFACE Serial')
    expect(out).toContain('#define DEBUG_BAUD 115200')
  })

  // A PUBLISHED VPP has no `serial` section — only the legacy RTU fields. The
  // debugger and the RTU then share one port, so ONE rate must come out of this
  // file. Emitting 115200 while MBSERIAL_BAUD said 9600 built a firmware the
  // editor could not talk to, and the user was told "No Firmware Detected" about
  // a board that was running fine.
  it('aligns DEBUG_BAUD with MBSERIAL_BAUD for a published VPP (no `serial` section)', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: {
        modbus_rtu: { enabled: true, rtu_interface: 'Serial', rtu_baud_rate: '9600', rtu_slave_id: 1 },
      },
    })
    expect(out).toContain('#define MBSERIAL_BAUD 9600')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
    expect(out).toContain('#define DEBUG_BAUD 9600')
  })

  // The reported failure, end to end: Modbus off, 9600 saved on the screen. The
  // editor dials 9600 (spec params ignore `enabledWhen`), so a firmware built at
  // 115200 opened the port and answered nothing — "No Firmware Detected" on a
  // healthy board.
  it('aligns DEBUG_BAUD with the screen baud when Modbus is DISABLED', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: { modbus_rtu: { enabled: false, rtu_baud_rate: '9600' } },
    })
    expect(out).toContain('#define DEBUGGER_ENABLED')
    expect(out).toContain('#define DEBUG_BAUD 9600')
    // Modbus itself stays out of the build.
    expect(out).not.toContain('#define MODBUS_ENABLED')
  })

  it('keeps DEBUG_BAUD at the firmware default when the RTU has its own second port', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: {
        modbus_rtu: { enabled: true, rtu_interface: 'Serial1', rtu_baud_rate: '9600', rtu_slave_id: 1 },
      },
    })
    // Two distinct ports, two distinct rates — and the debugger keeps the default.
    expect(out).toContain('#define MBSERIAL_BAUD 9600')
    expect(out).toContain('#define MBSERIAL_ON_SECONDARY')
    expect(out).toContain('#define DEBUG_BAUD 115200')
  })

  it('emits DEBUG_SLAVE from the RTU screen so it matches the id the editor addresses', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: {
        modbus_rtu: { enabled: true, rtu_interface: 'Serial', rtu_baud_rate: '9600', rtu_slave_id: 3 },
      },
    })
    expect(out).toContain('#define MBSERIAL_SLAVE 3')
    expect(out).toContain('#define DEBUG_SLAVE 3')
  })

  // The slave-id twin of the DEBUG_BAUD regression above, and the harsher one:
  // Connect sweeps baud rates, but nothing sweeps slave ids. With Modbus off and
  // slave id 7 saved on the screen, the editor addresses 7 while a firmware left
  // on modbus_config.h's `#ifndef DEBUG_SLAVE 1` fallback frames on 1 — every
  // frame dropped at the id check, reported as "No Firmware Detected".
  it('aligns DEBUG_SLAVE with the screen slave id when Modbus is DISABLED', () => {
    const out = generateDefinesContent({
      ...EMPTY_INPUTS,
      boardRuntime: 'arduino-cli',
      defaultSerial: 'Serial',
      vppModbusState: { modbus_rtu: { enabled: false, rtu_slave_id: 7 } },
    })
    expect(out).toContain('#define DEBUG_SLAVE 7')
    expect(out).not.toContain('#define MODBUS_ENABLED')
  })

  it('falls back to DEBUG_SLAVE 1 when the project states no slave id', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'arduino-cli' })
    expect(out).toContain('#define DEBUG_SLAVE 1')
  })

  it('does NOT emit DEBUGGER_ENABLED for the simulator (it uses the full Modbus path)', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'simulator' })
    expect(out).not.toContain('DEBUGGER_ENABLED')
  })

  it('does NOT emit DEBUGGER_ENABLED for openplc-compiler runtimes', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, boardRuntime: 'openplc-compiler' })
    expect(out).not.toContain('DEBUGGER_ENABLED')
  })
})

describe('generateDefinesContent — IO Config (pin masks)', () => {
  it('emits empty pin masks when devicePinMapping is empty', () => {
    const out = generateDefinesContent(EMPTY_INPUTS)
    expect(out).toContain('//IO Config\n')
    expect(out).toContain('#define PINMASK_DIN \n')
    expect(out).toContain('#define PINMASK_AIN \n')
    expect(out).toContain('#define PINMASK_DOUT \n')
    expect(out).toContain('#define PINMASK_AOUT \n')
    expect(out).toContain('#define NUM_DISCRETE_INPUT 0\n')
    expect(out).toContain('#define NUM_ANALOG_INPUT 0\n')
    expect(out).toContain('#define NUM_DISCRETE_OUTPUT 0\n')
    expect(out).toContain('#define NUM_ANALOG_OUTPUT 0\n')
  })

  it('groups pins by pinType into the matching PINMASK_* and NUM_* defines', () => {
    const pins: DevicePin[] = [
      makePin({ pin: 2, pinType: 'digitalInput' }),
      makePin({ pin: 3, pinType: 'digitalInput' }),
      makePin({ pin: 4, pinType: 'analogInput' }),
      makePin({ pin: 5, pinType: 'digitalOutput' }),
      makePin({ pin: 6, pinType: 'analogOutput' }),
      makePin({ pin: 7, pinType: 'analogOutput' }),
    ]
    const out = generateDefinesContent({ ...EMPTY_INPUTS, devicePinMapping: pins })
    expect(out).toContain('#define PINMASK_DIN 2, 3\n')
    expect(out).toContain('#define PINMASK_AIN 4\n')
    expect(out).toContain('#define PINMASK_DOUT 5\n')
    expect(out).toContain('#define PINMASK_AOUT 6, 7\n')
    expect(out).toContain('#define NUM_DISCRETE_INPUT 2\n')
    expect(out).toContain('#define NUM_ANALOG_INPUT 1\n')
    expect(out).toContain('#define NUM_DISCRETE_OUTPUT 1\n')
    expect(out).toContain('#define NUM_ANALOG_OUTPUT 2\n')
  })

  it('preserves input pin order in the PINMASK output (caller is responsible for sorting)', () => {
    // Editor's comment: "This approach assumes that the pins are sorted."
    // We don't sort here — verify the assumption is honoured by passing
    // unsorted pins and asserting unsorted output.
    const pins: DevicePin[] = [
      makePin({ pin: 8, pinType: 'digitalInput' }),
      makePin({ pin: 2, pinType: 'digitalInput' }),
      makePin({ pin: 5, pinType: 'digitalInput' }),
    ]
    const out = generateDefinesContent({ ...EMPTY_INPUTS, devicePinMapping: pins })
    expect(out).toContain('#define PINMASK_DIN 8, 2, 5\n')
  })
})

describe('generateDefinesContent — Arduino library toggles', () => {
  function withMarker(marker: string) {
    return generateDefinesContent({ ...EMPTY_INPUTS, stProgramFileContent: `PROGRAM main\n${marker}\nEND_PROGRAM` })
  }

  it('toggles USE_DS18B20_BLOCK for any of the five DS18B20 FB markers', () => {
    expect(withMarker('DS18B20;')).toContain('#define USE_DS18B20_BLOCK\n')
    expect(withMarker('DS18B20_2_OUT;')).toContain('#define USE_DS18B20_BLOCK\n')
    expect(withMarker('DS18B20_3_OUT;')).toContain('#define USE_DS18B20_BLOCK\n')
    expect(withMarker('DS18B20_4_OUT;')).toContain('#define USE_DS18B20_BLOCK\n')
    expect(withMarker('DS18B20_5_OUT;')).toContain('#define USE_DS18B20_BLOCK\n')
  })

  it('toggles USE_P1AM_BLOCKS on P1AM_INIT;', () => {
    expect(withMarker('P1AM_INIT;')).toContain('#define USE_P1AM_BLOCKS\n')
  })

  it('toggles USE_CLOUD_BLOCKS on CLOUD_BEGIN;', () => {
    expect(withMarker('CLOUD_BEGIN;')).toContain('#define USE_CLOUD_BLOCKS\n')
  })

  it('toggles USE_MQTT_BLOCKS for either MQTT_CONNECT; or MQTT_CONNECT_AUTH;', () => {
    expect(withMarker('MQTT_CONNECT;')).toContain('#define USE_MQTT_BLOCKS\n')
    expect(withMarker('MQTT_CONNECT_AUTH;')).toContain('#define USE_MQTT_BLOCKS\n')
  })

  it('toggles USE_ARDUINOCAN_BLOCK for any of the four ARDUINOCAN markers', () => {
    expect(withMarker('ARDUINOCAN_CONF;')).toContain('#define USE_ARDUINOCAN_BLOCK\n')
    expect(withMarker('ARDUINOCAN_WRITE;')).toContain('#define USE_ARDUINOCAN_BLOCK\n')
    expect(withMarker('ARDUINOCAN_WRITE_WORD;')).toContain('#define USE_ARDUINOCAN_BLOCK\n')
    expect(withMarker('ARDUINOCAN_READ;')).toContain('#define USE_ARDUINOCAN_BLOCK\n')
  })

  it('toggles USE_STM32CAN_BLOCK for any of the three STM32CAN markers', () => {
    expect(withMarker('STM32CAN_CONF;')).toContain('#define USE_STM32CAN_BLOCK\n')
    expect(withMarker('STM32CAN_WRITE;')).toContain('#define USE_STM32CAN_BLOCK\n')
    expect(withMarker('STM32CAN_READ;')).toContain('#define USE_STM32CAN_BLOCK\n')
  })

  it('toggles USE_SM_BLOCKS for any of the ten SM_* markers', () => {
    const markers = [
      'SM_8RELAY;',
      'SM_16RELAY;',
      'SM_8DIN;',
      'SM_16DIN;',
      'SM_4REL4IN;',
      'SM_INDUSTRIAL;',
      'SM_RTD;',
      'SM_BAS;',
      'SM_HOME;',
      'SM_8MOSFET;',
    ]
    for (const m of markers) {
      expect(withMarker(m)).toContain('#define USE_SM_BLOCKS\n')
    }
  })

  it('omits all USE_*_BLOCK defines when no markers are present', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, stProgramFileContent: 'PROGRAM main\nEND_PROGRAM' })
    expect(out).not.toContain('USE_DS18B20_BLOCK')
    expect(out).not.toContain('USE_P1AM_BLOCKS')
    expect(out).not.toContain('USE_CLOUD_BLOCKS')
    expect(out).not.toContain('USE_MQTT_BLOCKS')
    expect(out).not.toContain('USE_ARDUINOCAN_BLOCK')
    expect(out).not.toContain('USE_STM32CAN_BLOCK')
    expect(out).not.toContain('USE_SM_BLOCKS')
  })

  it('emits multiple library toggles when several markers co-occur', () => {
    const st = 'P1AM_INIT;\nMQTT_CONNECT;\nDS18B20_3_OUT;\nSM_8RELAY;'
    const out = generateDefinesContent({ ...EMPTY_INPUTS, stProgramFileContent: st })
    expect(out).toContain('#define USE_DS18B20_BLOCK\n')
    expect(out).toContain('#define USE_P1AM_BLOCKS\n')
    expect(out).toContain('#define USE_MQTT_BLOCKS\n')
    expect(out).toContain('#define USE_SM_BLOCKS\n')
    expect(out).not.toContain('USE_CLOUD_BLOCKS')
    expect(out).not.toContain('USE_ARDUINOCAN_BLOCK')
    expect(out).not.toContain('USE_STM32CAN_BLOCK')
  })

  it('uses substring matching, not whole-word — markers within larger tokens still trigger', () => {
    // Editor uses `String.prototype.includes`, so e.g. `XDS18B20;` is
    // technically also a hit because it contains `DS18B20;`.  This is
    // the editor's behavior; pin it so a future change to whole-word
    // matching surfaces as a test failure.
    const out = generateDefinesContent({ ...EMPTY_INPUTS, stProgramFileContent: 'XDS18B20;' })
    expect(out).toContain('#define USE_DS18B20_BLOCK\n')
  })
})

describe('generateDefinesContent — retain blob size', () => {
  it('emits OPLC_RETAIN_BLOB_SIZE when the program retains something', () => {
    const out = generateDefinesContent({ ...EMPTY_INPUTS, retainBlobSize: 148 })
    expect(out).toContain('//Retain')
    expect(out).toContain('#define OPLC_RETAIN_BLOB_SIZE 148')
  })

  it('emits nothing when the program retains nothing', () => {
    // Boards that never touch retain must see byte-identical defines.h to
    // before this existed, or every one of them rebuilds for no reason.
    expect(generateDefinesContent({ ...EMPTY_INPUTS })).not.toContain('OPLC_RETAIN_BLOB_SIZE')
    expect(generateDefinesContent({ ...EMPTY_INPUTS, retainBlobSize: 0 })).not.toContain('OPLC_RETAIN_BLOB_SIZE')
  })
})

describe('generateDefinesContent — full output snapshot', () => {
  it('produces the canonical defines.h for a typical simulator project', () => {
    const out = generateDefinesContent({
      boardEntry: { define: ['__AVR_ATmega2560__'] },
      devicePinMapping: [
        makePin({ pin: 2, pinType: 'digitalInput' }),
        makePin({ pin: 3, pinType: 'digitalInput' }),
        makePin({ pin: 13, pinType: 'digitalOutput' }),
      ],
      stProgramFileContent: 'PROGRAM main\nVAR\nEND_VAR\nEND_PROGRAM',
      buildMD5Hash: '0123456789abcdef0123456789abcdef',
      boardRuntime: 'simulator',
    })

    expect(out).toBe(
      [
        '// Board defines',
        '#define __AVR_ATmega2560__',
        '#define OPENPLC_NO_UNIQUE_ID',
        '',
        '',
        '//Program MD5',
        '#define PROGRAM_MD5 "0123456789abcdef0123456789abcdef"',
        '',
        '//Comms Configuration',
        '#define SIMULATOR_MODE',
        '#define MBSERIAL_IFACE Serial',
        '#define MBSERIAL_BAUD 115200',
        '#define MBSERIAL_SLAVE 1',
        '#define MBSERIAL',
        '#define MODBUS_ENABLED',
        '',
        '',
        '//IO Config',
        '#define PINMASK_DIN 2, 3',
        '#define PINMASK_AIN ',
        '#define PINMASK_DOUT 13',
        '#define PINMASK_AOUT ',
        '#define NUM_DISCRETE_INPUT 2',
        '#define NUM_ANALOG_INPUT 0',
        '#define NUM_DISCRETE_OUTPUT 1',
        '#define NUM_ANALOG_OUTPUT 0',
        '',
        '',
        '//Arduino libraries',
        '',
      ].join('\n'),
    )
  })

  it('produces the canonical defines.h for a non-simulator project with library toggles', () => {
    const out = generateDefinesContent({
      boardEntry: { define: 'PIN_LED=13' },
      devicePinMapping: [makePin({ pin: 4, pinType: 'analogInput' })],
      stProgramFileContent: 'CLOUD_BEGIN; MQTT_CONNECT_AUTH;',
      buildMD5Hash: 'ff'.repeat(16),
      boardRuntime: 'arduino-cli',
    })

    expect(out).toBe(
      [
        '// Board defines',
        '#define PIN_LED=13',
        '#define OPENPLC_NO_UNIQUE_ID',
        '',
        '',
        '//Program MD5',
        '#define PROGRAM_MD5 "ffffffffffffffffffffffffffffffff"',
        '',
        '//Debugger',
        '#define DEBUGGER_ENABLED',
        '#define DEBUG_IFACE Serial',
        '#define DEBUG_BAUD 115200',
        '#define DEBUG_SLAVE 1',
        '',
        '',
        '//IO Config',
        '#define PINMASK_DIN ',
        '#define PINMASK_AIN 4',
        '#define PINMASK_DOUT ',
        '#define PINMASK_AOUT ',
        '#define NUM_DISCRETE_INPUT 0',
        '#define NUM_ANALOG_INPUT 1',
        '#define NUM_DISCRETE_OUTPUT 0',
        '#define NUM_ANALOG_OUTPUT 0',
        '',
        '',
        '//Arduino libraries',
        '#define USE_CLOUD_BLOCKS',
        '#define USE_MQTT_BLOCKS',
        '',
      ].join('\n'),
    )
  })
})
