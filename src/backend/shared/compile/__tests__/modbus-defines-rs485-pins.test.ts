import { generateModbusDefines } from '../steps/modbus-defines'

/**
 * `MBSERIAL_TXPIN` comes from `resolveRs485Pins`: the pin of the UART the
 * Modbus RTU server uses, and nothing when that UART has none. The FX3U HALs
 * test `#ifndef MBSERIAL_TXPIN`, so the define stays.
 */

type Rs485Board = NonNullable<Parameters<typeof generateModbusDefines>[4]>

const MEGA_UARTS = ['Serial', 'Serial1', 'Serial2', 'Serial3']
const MEGA: Rs485Board = { serialPorts: MEGA_UARTS, perUartAware: true }
const FX3U: Rs485Board = { serialPorts: ['Serial', 'Serial3'], rs485FixedPins: { Serial3: 'PA14' }, perUartAware: true }
const LEGACY: Rs485Board = { serialPorts: MEGA_UARTS, perUartAware: false }

const rtuOn = (serialPort?: string) => ({
  enabled: true,
  transports: ['rtu' as const],
  slaveId: 7,
  networkInterface: '0.0.0.0',
  port: 502,
  ...(serialPort ? { serialPort, baudRate: 19200 } : {}),
})

const legacyPin = (pin = '17') => ({ serial: { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: pin } })
const perUartPins = (pins: Record<string, string>) => ({ serial: { baud_rate: '115200', rs485_en_pins: pins } })

const txPinLines = (out: string): string[] => out.split('\n').filter((line) => line.includes('MBSERIAL_TXPIN'))

describe('MBSERIAL_TXPIN', () => {
  describe('legacy board', () => {
    it('produces the same block as before for a 4.3.x project', () => {
      const expected = [
        '//Comms Configuration',
        '#define MBSERIAL_IFACE Serial2',
        '#define MBSERIAL_BAUD 19200',
        '#define MBSERIAL_SLAVE 7',
        '#define MBSERIAL_ON_SECONDARY',
        '#define MBSERIAL_TXPIN 17',
        '#define MBSERIAL',
        '#define MODBUS_ENABLED',
        '',
      ].join('\n')

      expect(generateModbusDefines(legacyPin(), 'Serial', rtuOn('Serial2'), undefined, LEGACY)).toBe(expected)
      expect(generateModbusDefines(legacyPin(), 'Serial', rtuOn('Serial2'))).toBe(expected)
    })

    it('emits the pin on the default UART', () => {
      expect(txPinLines(generateModbusDefines(legacyPin(), 'Serial', rtuOn(), undefined, LEGACY))).toEqual([
        '#define MBSERIAL_TXPIN 17',
      ])
    })

    it.each(['-1', '2\n#define MBSERIAL_SLAVE 9'])('emits no pin for %j', (pin) => {
      const out = generateModbusDefines(legacyPin(pin), 'Serial', rtuOn('Serial1'), undefined, LEGACY)

      expect(txPinLines(out)).toEqual([])
      expect(out).not.toContain('#define MBSERIAL_SLAVE 9')
      expect(out).toContain('#define MBSERIAL_SLAVE 7')
    })
  })

  describe('per-UART aware board', () => {
    it("emits the per-UART pin of the RTU server's UART", () => {
      const out = generateModbusDefines(
        perUartPins({ Serial1: '22', Serial2: '23' }),
        'Serial',
        rtuOn('Serial2'),
        undefined,
        MEGA,
      )

      expect(txPinLines(out)).toEqual(['#define MBSERIAL_TXPIN 23'])
    })

    it("emits nothing when the RTU server's UART has no pin", () => {
      const out = generateModbusDefines(perUartPins({ Serial1: '22' }), 'Serial', rtuOn('Serial2'), undefined, MEGA)

      expect(txPinLines(out)).toEqual([])
      expect(out).toContain('#define MBSERIAL\n')
    })

    it("emits the package's fixed pin on the UART it fixes", () => {
      const out = generateModbusDefines(
        { serial: { baud_rate: '115200' } },
        'Serial',
        rtuOn('Serial3'),
        undefined,
        FX3U,
      )

      expect(txPinLines(out)).toEqual(['#define MBSERIAL_TXPIN PA14'])
    })

    it("follows a 4.3.x project's pin to the RTU server's UART until per-UART pins are written", () => {
      expect(txPinLines(generateModbusDefines(legacyPin(), 'Serial', rtuOn('Serial2'), undefined, MEGA))).toEqual([
        '#define MBSERIAL_TXPIN 17',
      ])
      expect(txPinLines(generateModbusDefines(legacyPin(), 'Serial', rtuOn(), undefined, MEGA))).toEqual([
        '#define MBSERIAL_TXPIN 17',
      ])
    })

    it('produces the same block for a 4.3.x project as on a legacy board', () => {
      expect(generateModbusDefines(legacyPin(), 'Serial', rtuOn('Serial2'), undefined, MEGA)).toBe(
        generateModbusDefines(legacyPin(), 'Serial', rtuOn('Serial2'), undefined, LEGACY),
      )
    })

    it('ignores the legacy pin once the per-UART pins are written', () => {
      const state = { serial: { enable_rs485_en_pin: true, rs485_en_pin: '17', rs485_en_pins: {} } }

      expect(txPinLines(generateModbusDefines(state, 'Serial', rtuOn(), undefined, MEGA))).toEqual([])
    })

    it('emits no pin for a per-UART value outside the pattern', () => {
      const out = generateModbusDefines(perUartPins({ Serial1: '-1' }), 'Serial', rtuOn('Serial1'), undefined, MEGA)

      expect(txPinLines(out)).toEqual([])
    })
  })
})
