import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT = FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h')))

if (FIRMWARE_ROOT === undefined) {
  throw new Error(`Firmware sources not found. Looked in:\n${FIRMWARE_ROOTS.join('\n')}`)
}

const BAREMETAL_DIR = join(FIRMWARE_ROOT, 'Baremetal')

const RTU_FILES = ['modbus_master_rtu.h', 'modbus_master_rtu.cpp']
const RS485_FILES = ['modbus_rs485.h', 'modbus_rs485.cpp']

/** C and C++ source with comments, string and character literals blanked, so only code is searched. */
const codeOf = (source: string): string =>
  source
    .replace(/\\\r?\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")

/** The code of a `Baremetal/` file, or of several files joined. */
const codeOfFiles = (names: string[]): string =>
  names.map((name) => codeOf(readFileSync(join(BAREMETAL_DIR, name), 'utf-8'))).join('\n')

/** The quoted headers a file includes, e.g. `modbus_crc.h`. */
const includesOf = (names: string[]): string[] =>
  names.flatMap((name) =>
    [...readFileSync(join(BAREMETAL_DIR, name), 'utf-8').matchAll(/^\s*#\s*include\s*"([^"]+)"/gm)].map(
      (match) => match[1],
    ),
  )

/** The headers of the layers above the RS-485 helper: the transports, the protocol, the handlers and the master. */
const UPPER_LAYER_HEADERS = [
  'ModbusSlave.h',
  'modbus_serial.h',
  'modbus_tcp.h',
  'modbus_pdu.h',
  'modbus_registers.h',
  'modbus_debug.h',
  'modbus_master.h',
  'modbus_master_tcp.h',
  'modbus_master_rtu.h',
]

/** The CONTROLLINO-specific RS-485 calls and pins of the Modbus server. */
const CONTROLLINO_RS485_NAMES = [
  'Controllino_RS485Init',
  'Controllino_RS485TxEnable',
  'Controllino_RS485RxEnable',
  'CUSTOM_RS485_DEFAULT_DE_PIN',
  'CUSTOM_RS485_DEFAULT_RE_PIN',
]

const names = (code: string, identifiers: string[]): string[] =>
  identifiers.filter((identifier) => new RegExp(`\\b${identifier}\\b`).test(code))

describe('Modbus RTU master firmware modules', () => {
  it.each([...RTU_FILES, ...RS485_FILES])('ships Baremetal/%s', (name) => {
    expect(existsSync(join(BAREMETAL_DIR, name))).toBe(true)
  })
})

describe('the RTU master never blocks the scan on transmit', () => {
  it.each([
    ['flush()', /\bflush\s*\(/],
    ['delayMicroseconds()', /\bdelayMicroseconds\s*\(/],
    ['delay()', /\bdelay\s*\(/],
  ])('modbus_master_rtu calls no %s', (_label, call) => {
    expect(codeOfFiles(RTU_FILES)).not.toMatch(call)
  })
})

describe("M3: the RTU master never touches the server's frame or receive buffers", () => {
  it('names no mb_frame, mb_frame_len or mb_rx_* buffer', () => {
    expect(codeOfFiles(RTU_FILES).match(/\bmb_(?:frame|frame_len|rx_\w+)\b/g) ?? []).toEqual([])
  })

  it('calls no calcCrc(), which reads mb_frame', () => {
    expect(codeOfFiles(RTU_FILES)).not.toMatch(/\bcalcCrc\s*\(\s*\)/)
  })

  it('takes its CRC from modbus_crc', () => {
    expect(includesOf(RTU_FILES)).toContain('modbus_crc.h')
  })
})

describe('V6: one RS-485 transmit helper for the server and the master', () => {
  it('the Modbus RTU server includes modbus_rs485.h', () => {
    expect(includesOf(['modbus_serial.h', 'modbus_serial.cpp'])).toContain('modbus_rs485.h')
  })

  it('the RTU master includes modbus_rs485.h', () => {
    expect(includesOf(RTU_FILES)).toContain('modbus_rs485.h')
  })

  it('modbus_rs485 is a base layer: it includes no transport, protocol, handler or master header', () => {
    expect(includesOf(RS485_FILES).filter((header) => UPPER_LAYER_HEADERS.includes(header))).toEqual([])
  })

  it('modbus_rs485 carries every CONTROLLINO RS-485 branch', () => {
    expect(names(codeOfFiles(RS485_FILES), CONTROLLINO_RS485_NAMES)).toEqual(CONTROLLINO_RS485_NAMES)
  })

  it('modbus_serial.cpp no longer drives a CONTROLLINO RS-485 chip itself', () => {
    expect(names(codeOfFiles(['modbus_serial.cpp']), CONTROLLINO_RS485_NAMES)).toEqual([])
  })
})
