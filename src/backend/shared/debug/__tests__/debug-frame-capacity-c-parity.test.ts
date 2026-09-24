// The repo has no C test harness, so the CRC reservation in the debug responses is checked as source text.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The editor ships the firmware under resources/sources, the web under src/assets/firmware.
const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT = FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'Baremetal', 'modbus_types.h')))

if (FIRMWARE_ROOT === undefined) {
  throw new Error(`Baremetal firmware sources not found. Looked in:\n${FIRMWARE_ROOTS.join('\n')}`)
}

const readSource = (...parts: string[]): string => readFileSync(join(FIRMWARE_ROOT, ...parts), 'utf-8')

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const cDefine = (source: string, name: string): string => {
  const match = new RegExp(`#define\\s+${name}\\s+(.+)$`, 'm').exec(source)
  if (!match) throw new Error(`${name} is not defined`)
  return match[1].replace(/\/\*.*\*\//, '').trim()
}

const types = readSource('Baremetal', 'modbus_types.h')
const debug = stripComments(readSource('Baremetal', 'modbus_debug.cpp'))
const serial = stripComments(readSource('Baremetal', 'modbus_serial.cpp'))
const glue = readSource('arduino', 'arduino_runtime_glue.h')

describe('debug response capacity (modbus_types.h, modbus_debug.cpp, modbus_serial.cpp)', () => {
  it('reserves the 2-byte RTU CRC out of MAX_MB_FRAME', () => {
    expect(cDefine(types, 'MB_CRC_SIZE')).toBe('2')
    expect(cDefine(types, 'MB_RESPONSE_CAPACITY')).toBe('(MAX_MB_FRAME - MB_CRC_SIZE)')
  })

  it('still fits the header plus the widest value once the CRC is reserved', () => {
    const header = Number(cDefine(types, 'MB_DEBUG_GET_HEADER'))
    const wstringWire = Number(cDefine(glue, 'OPENPLC_DEBUG_WSTRING_WIRE'))
    const frame = /#else\s+#define MAX_MB_FRAME \(MB_DEBUG_GET_HEADER \+ OPENPLC_DEBUG_WSTRING_WIRE \+ (\d+)\)/.exec(
      types,
    )
    expect(frame).not.toBeNull()
    const maxFrame = header + wstringWire + Number(frame![1])
    expect(maxFrame - 2).toBeGreaterThanOrEqual(header + wstringWire)
  })

  it('bounds every debug response by MB_RESPONSE_CAPACITY, never by MAX_MB_FRAME', () => {
    const rawUses = debug.split('\n').filter((line) => line.includes('MAX_MB_FRAME'))
    // The only raw use left sizes an incoming DEBUG_SET payload, which carries no CRC of ours.
    expect(rawUses.map((line) => line.trim())).toEqual(['if (len > (MAX_MB_FRAME - 8))'])
    expect(debug).toContain('if ((11 + responseSize + varSize) > MB_RESPONSE_CAPACITY) break;')
    expect(debug).toContain('if ((response_idx + varSize) > MB_RESPONSE_CAPACITY) break;')
  })

  it('makes the serial send path refuse only what the builders can no longer produce', () => {
    expect(serial).toContain('if (mb_frame_len > MB_RESPONSE_CAPACITY) exceptionResponse(')
    expect(serial).not.toMatch(/mb_frame_len \+ 2 > MAX_MB_FRAME/)
  })
})
