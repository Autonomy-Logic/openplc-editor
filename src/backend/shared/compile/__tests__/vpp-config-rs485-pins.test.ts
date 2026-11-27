import { generateVppConfigContent } from '../steps/generate-vpp-config'

const PREAMBLE = [
  '// vpp_config.h — auto-generated, do not edit by hand.',
  '//',
  '// Carries the user-authored configuration-screen data for this',
  '// build target as C preprocessor #defines. The HAL driver',
  '// `#include`s this file and reads whatever subset it needs;',
  '// unused defines are harmless.',
  '',
  '#ifndef VPP_CONFIG_H',
  '#define VPP_CONFIG_H',
  '',
]

const header = (body: string[]): string => [...PREAMBLE, ...body, '', '#endif // VPP_CONFIG_H', ''].join('\n')

const pinLines = (out: string): string[] => out.split('\n').filter((line) => line.includes('RS485'))

describe('vpp_config.h RS-485 pins', () => {
  it('produces the same header as before for a Serial screen the user did not change', () => {
    const out = generateVppConfigContent({
      vendorScreenData: { serial: { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '17' } },
    })

    expect(out).toBe(
      header([
        '#define VPP_SERIAL_BAUD_RATE "115200"',
        '#define VPP_SERIAL_ENABLE_RS485_EN_PIN 1',
        '#define VPP_SERIAL_RS485_EN_PIN "17"',
      ]),
    )
  })

  it('emits one define per UART once the per-UART pins are written, and no legacy leaf', () => {
    const out = generateVppConfigContent({
      vendorScreenData: { serial: { baud_rate: '115200', rs485_en_pins: { Serial1: '22', Serial3: 'PA14' } } },
    })

    expect(pinLines(out)).toEqual([
      '#define VPP_SERIAL_RS485_EN_PINS_SERIAL1 "22"',
      '#define VPP_SERIAL_RS485_EN_PINS_SERIAL3 "PA14"',
    ])
  })

  it('emits the UARTs in the same order whatever order they were written in', () => {
    const forward = generateVppConfigContent({
      vendorScreenData: { serial: { rs485_en_pins: { Serial1: '22', Serial2: '23', Serial3: '24' } } },
    })
    const backward = generateVppConfigContent({
      vendorScreenData: { serial: { rs485_en_pins: { Serial3: '24', Serial2: '23', Serial1: '22' } } },
    })

    expect(backward).toBe(forward)
    expect(pinLines(forward)).toEqual([
      '#define VPP_SERIAL_RS485_EN_PINS_SERIAL1 "22"',
      '#define VPP_SERIAL_RS485_EN_PINS_SERIAL2 "23"',
      '#define VPP_SERIAL_RS485_EN_PINS_SERIAL3 "24"',
    ])
  })

  it.each(['-1', '2\n#define MBSERIAL_SLAVE 9', 'pa14', ' 22'])('emits no define for the per-UART pin %j', (pin) => {
    const out = generateVppConfigContent({
      vendorScreenData: { serial: { rs485_en_pins: { Serial1: pin, Serial2: '23' } } },
    })

    expect(pinLines(out)).toEqual(['#define VPP_SERIAL_RS485_EN_PINS_SERIAL2 "23"'])
  })

  it("emits a 4.3.x project's padded pin trimmed", () => {
    const out = generateVppConfigContent({
      vendorScreenData: { serial: { enable_rs485_en_pin: true, rs485_en_pin: '22 ' } },
    })

    expect(pinLines(out)).toEqual(['#define VPP_SERIAL_ENABLE_RS485_EN_PIN 1', '#define VPP_SERIAL_RS485_EN_PIN "22"'])
  })

  it('emits no define for a per-UART pin with a trailing space', () => {
    const out = generateVppConfigContent({
      vendorScreenData: { serial: { rs485_en_pins: { Serial1: '22 ', Serial2: '23' } } },
    })

    expect(pinLines(out)).toEqual(['#define VPP_SERIAL_RS485_EN_PINS_SERIAL2 "23"'])
  })
})
