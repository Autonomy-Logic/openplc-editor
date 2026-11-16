import { isValidRs485Pin, resolveRs485Pins, storedRs485Pins } from '..'

type SerialState = Parameters<typeof resolveRs485Pins>[0]
type Rs485Board = Parameters<typeof resolveRs485Pins>[1]

const MEGA_UARTS = ['Serial', 'Serial1', 'Serial2', 'Serial3']

/** A package whose Serial screen has the `uart-pin-map` field. */
const MEGA: Rs485Board = { serialPorts: MEGA_UARTS, perUartAware: true }

/** A package that fixes the pin of its RS-485 UART (FX3U WS3U-14Mx). */
const FX3U: Rs485Board = { serialPorts: ['Serial', 'Serial3'], rs485FixedPins: { Serial3: 'PA14' }, perUartAware: true }

/** A package with today's Serial screen: the single pin and its switch. */
const LEGACY: Rs485Board = { serialPorts: MEGA_UARTS, perUartAware: false }

/** The pin a project saved by 4.3.x carries. */
const legacyPin = (pin = '17'): SerialState => ({
  serial: { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: pin },
})

const perUartPins = (pins: Record<string, string>): SerialState => ({
  serial: { baud_rate: '115200', rs485_en_pins: pins },
})

/** Freezes every level so a write anywhere in the state throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

describe('resolveRs485Pins', () => {
  describe('per-UART aware board', () => {
    it("returns the package's fixed pins with nothing set on the screen", () => {
      expect(resolveRs485Pins({}, FX3U, null)).toEqual({ Serial3: 'PA14' })
    })

    it('returns each per-UART pin the user set', () => {
      expect(resolveRs485Pins(perUartPins({ Serial1: '22', Serial2: 'A5' }), MEGA, null)).toEqual({
        Serial1: '22',
        Serial2: 'A5',
      })
    })

    it('lets a fixed pin win over a per-UART value on the same UART', () => {
      expect(resolveRs485Pins(perUartPins({ Serial: '4', Serial3: '7' }), FX3U, null)).toEqual({
        Serial: '4',
        Serial3: 'PA14',
      })
    })

    it('puts the legacy pin on the default UART when the Modbus RTU server uses it', () => {
      expect(resolveRs485Pins(legacyPin(), MEGA, 'Serial')).toEqual({ Serial: '17' })
    })

    it('puts the legacy pin on a secondary UART when the Modbus RTU server uses it, never on the default UART', () => {
      const pins = resolveRs485Pins(legacyPin(), MEGA, 'Serial2')

      expect(pins).toEqual({ Serial2: '17' })
      expect(pins).not.toHaveProperty('Serial')
    })

    it('maps the legacy pin to no UART when there is no Modbus RTU server', () => {
      expect(resolveRs485Pins(legacyPin(), MEGA, null)).toEqual({})
    })

    it('leaves the legacy pair in the state untouched when there is no Modbus RTU server', () => {
      const state = deepFreeze(legacyPin())

      resolveRs485Pins(state, MEGA, null)

      expect(state).toEqual(legacyPin())
    })

    it('ignores the legacy pair once the per-UART pins are written', () => {
      const state: SerialState = {
        serial: { enable_rs485_en_pin: true, rs485_en_pin: '17', rs485_en_pins: { Serial1: '22' } },
      }

      expect(resolveRs485Pins(state, MEGA, 'Serial2')).toEqual({ Serial1: '22' })
    })

    it('ignores the legacy pair once the per-UART pins are written empty', () => {
      const state: SerialState = { serial: { enable_rs485_en_pin: true, rs485_en_pin: '17', rs485_en_pins: {} } }

      expect(resolveRs485Pins(state, MEGA, 'Serial')).toEqual({})
    })

    it('lets a fixed pin win over the legacy pin on the RTU server UART', () => {
      expect(resolveRs485Pins(legacyPin(), FX3U, 'Serial3')).toEqual({ Serial3: 'PA14' })
    })

    it('keeps the fixed pins beside a legacy pin migrated to another UART', () => {
      expect(resolveRs485Pins(legacyPin(), FX3U, 'Serial')).toEqual({ Serial: '17', Serial3: 'PA14' })
    })

    it('applies to a board that only declares fixed pins', () => {
      const fixedOnly: Rs485Board = {
        serialPorts: ['Serial', 'Serial1'],
        rs485FixedPins: { Serial1: '5' },
        perUartAware: true,
      }

      expect(resolveRs485Pins(legacyPin(), fixedOnly, 'Serial')).toEqual({ Serial: '17', Serial1: '5' })
    })
  })

  describe('legacy board', () => {
    it("puts the pin on the Modbus RTU server's UART, as today", () => {
      expect(resolveRs485Pins(legacyPin(), LEGACY, 'Serial1')).toEqual({ Serial1: '17' })
      expect(resolveRs485Pins(legacyPin(), LEGACY, 'Serial')).toEqual({ Serial: '17' })
    })

    it('returns nothing without a Modbus RTU server', () => {
      expect(resolveRs485Pins(legacyPin(), LEGACY, null)).toEqual({})
    })

    it('returns nothing when the switch is off, unset, or on with no pin', () => {
      expect(resolveRs485Pins({}, LEGACY, 'Serial')).toEqual({})
      expect(resolveRs485Pins({ serial: { rs485_en_pin: '17' } }, LEGACY, 'Serial')).toEqual({})
      expect(
        resolveRs485Pins({ serial: { enable_rs485_en_pin: false, rs485_en_pin: '17' } }, LEGACY, 'Serial'),
      ).toEqual({})
      expect(resolveRs485Pins({ serial: { enable_rs485_en_pin: true, rs485_en_pin: '' } }, LEGACY, 'Serial')).toEqual(
        {},
      )
    })
  })

  describe('pin pattern', () => {
    it.each(['2', '255', 'A0', 'PA14', 'AB123'])('returns the pin %j', (pin) => {
      expect(resolveRs485Pins(perUartPins({ Serial1: pin }), MEGA, null)).toEqual({ Serial1: pin })
    })

    it.each(['-1', '2\n#define MBSERIAL_SLAVE 9', 'pa14', 'ABC1', '1234', 'A', ' 22', '22 ', 'D-1'])(
      'drops the per-UART pin %j',
      (pin) => {
        expect(resolveRs485Pins(perUartPins({ Serial1: pin, Serial2: '22' }), MEGA, null)).toEqual({ Serial2: '22' })
      },
    )

    it.each(['-1', '2\n#define MBSERIAL_SLAVE 9'])('drops the legacy pin %j on a legacy board', (pin) => {
      expect(resolveRs485Pins(legacyPin(pin), LEGACY, 'Serial1')).toEqual({})
    })

    it.each(['-1', '2\n#define MBSERIAL_SLAVE 9'])('drops the legacy pin %j on a per-UART aware board', (pin) => {
      expect(resolveRs485Pins(legacyPin(pin), MEGA, 'Serial1')).toEqual({})
    })

    it('drops a fixed pin that does not match the pattern', () => {
      const badFixed: Rs485Board = {
        serialPorts: ['Serial', 'Serial3'],
        rs485FixedPins: { Serial3: 'P A' },
        perUartAware: true,
      }

      expect(resolveRs485Pins({}, badFixed, null)).toEqual({})
    })
  })

  describe('legacy pin trimming', () => {
    it.each(['22 ', ' 22'])('trims the legacy pin %j on a legacy board', (pin) => {
      expect(resolveRs485Pins(legacyPin(pin), LEGACY, 'Serial1')).toEqual({ Serial1: '22' })
    })

    it.each(['22 ', ' 22'])('trims the legacy pin %j on a per-UART aware board with no per-UART pins', (pin) => {
      expect(resolveRs485Pins(legacyPin(pin), MEGA, 'Serial1')).toEqual({ Serial1: '22' })
    })

    it('gives no pin for a legacy pin that is empty once trimmed', () => {
      expect(resolveRs485Pins(legacyPin('   '), LEGACY, 'Serial1')).toEqual({})
    })

    it('never trims a per-UART pin', () => {
      expect(resolveRs485Pins(perUartPins({ Serial1: '22 ' }), MEGA, 'Serial1')).toEqual({})
    })
  })
})

/** Serial screen state as a project file carries it, whatever types its values have. */
const fromProjectFile = (serial: Record<string, unknown>): SerialState => JSON.parse(JSON.stringify({ serial }))

const storedPins = (pins: Record<string, unknown>): SerialState =>
  fromProjectFile({ baud_rate: '115200', rs485_en_pins: pins })

describe('storedRs485Pins', () => {
  describe('per-UART aware board', () => {
    it.each([['-1'], ['22 '], ['d5'], [22]])('keeps the stored pin %j on its UART', (pin) => {
      expect(storedRs485Pins(storedPins({ Serial2: pin }), MEGA, null)).toEqual({ Serial2: pin })
    })

    it('keeps a valid stored pin on its UART', () => {
      expect(storedRs485Pins(storedPins({ Serial2: '22' }), MEGA, null)).toEqual({ Serial2: '22' })
    })

    it.each([[null], [true], [{ pin: '22' }]])('keeps a stored value of any JSON type (%j) as stored', (pin) => {
      expect(storedRs485Pins(storedPins({ Serial1: pin }), MEGA, null)).toEqual({ Serial1: pin })
    })

    it('gives no entry for an empty pin, which means no pin', () => {
      expect(storedRs485Pins(storedPins({ Serial1: '', Serial2: '-1' }), MEGA, null)).toEqual({ Serial2: '-1' })
    })

    it('lets a fixed pin win over a stored entry on the same UART', () => {
      expect(storedRs485Pins(storedPins({ Serial: '4', Serial3: '-1' }), FX3U, null)).toEqual({
        Serial: '4',
        Serial3: 'PA14',
      })
    })

    it('returns a fixed pin as declared, even one outside the pattern', () => {
      const badFixed: Rs485Board = {
        serialPorts: ['Serial', 'Serial3'],
        rs485FixedPins: { Serial3: 'P A' },
        perUartAware: true,
      }

      expect(storedRs485Pins({}, badFixed, null)).toEqual({ Serial3: 'P A' })
    })

    it("puts the trimmed legacy pin on the RTU server's UART when no per-UART map is stored", () => {
      expect(storedRs485Pins(legacyPin(' -1 '), MEGA, 'Serial2')).toEqual({ Serial2: '-1' })
    })

    it("puts the legacy pin on the RTU server's UART when the stored map is not a plain object", () => {
      const state = fromProjectFile({ enable_rs485_en_pin: true, rs485_en_pin: 'd5', rs485_en_pins: ['22'] })

      expect(storedRs485Pins(state, MEGA, 'Serial2')).toEqual({ Serial2: 'd5' })
    })

    it('lets a fixed pin win over the legacy pin on the RTU server UART', () => {
      expect(storedRs485Pins(legacyPin('-1'), FX3U, 'Serial3')).toEqual({ Serial3: 'PA14' })
    })

    it('keeps the fixed pins beside a legacy pin on another UART', () => {
      expect(storedRs485Pins(legacyPin('-1'), FX3U, 'Serial')).toEqual({ Serial: '-1', Serial3: 'PA14' })
    })

    it('maps the legacy pin to no UART when there is no Modbus RTU server', () => {
      expect(storedRs485Pins(legacyPin('-1'), MEGA, null)).toEqual({})
    })

    it('ignores the legacy pair once the per-UART pins are written', () => {
      const state = fromProjectFile({ enable_rs485_en_pin: true, rs485_en_pin: '-1', rs485_en_pins: {} })

      expect(storedRs485Pins(state, MEGA, 'Serial2')).toEqual({})
    })
  })

  describe('legacy board', () => {
    it("puts the trimmed legacy pin on the Modbus RTU server's UART", () => {
      expect(storedRs485Pins(legacyPin('-1 '), LEGACY, 'Serial1')).toEqual({ Serial1: '-1' })
    })

    it('returns nothing without a Modbus RTU server', () => {
      expect(storedRs485Pins(legacyPin('-1'), LEGACY, null)).toEqual({})
    })

    it('returns nothing when the switch is off or unset, or the pin is not a string or empty once trimmed', () => {
      expect(storedRs485Pins({}, LEGACY, 'Serial1')).toEqual({})
      expect(storedRs485Pins(fromProjectFile({ rs485_en_pin: '-1' }), LEGACY, 'Serial1')).toEqual({})
      expect(
        storedRs485Pins(fromProjectFile({ enable_rs485_en_pin: false, rs485_en_pin: '-1' }), LEGACY, 'Serial1'),
      ).toEqual({})
      expect(
        storedRs485Pins(fromProjectFile({ enable_rs485_en_pin: true, rs485_en_pin: 22 }), LEGACY, 'Serial1'),
      ).toEqual({})
      expect(storedRs485Pins(legacyPin('   '), LEGACY, 'Serial1')).toEqual({})
    })

    it('ignores a per-UART map on a legacy board', () => {
      expect(storedRs485Pins(storedPins({ Serial1: '-1' }), LEGACY, 'Serial1')).toEqual({})
    })
  })

  it('never modifies the state', () => {
    const state = deepFreeze(
      fromProjectFile({ enable_rs485_en_pin: true, rs485_en_pin: '17', rs485_en_pins: { Serial1: '-1', Serial2: '' } }),
    )
    const before = JSON.parse(JSON.stringify(state))

    storedRs485Pins(state, FX3U, 'Serial')

    expect(state).toEqual(before)
  })

  describe('agrees with resolveRs485Pins once the pattern filter is applied', () => {
    const FIXTURES: Array<[string, SerialState, Rs485Board, string | null]> = [
      ['invalid per-UART pins', storedPins({ Serial1: '-1', Serial2: '22 ', Serial3: 'd5' }), MEGA, null],
      ['a numeric per-UART pin beside a valid one', storedPins({ Serial1: 22, Serial2: '22' }), MEGA, 'Serial2'],
      ['an empty per-UART pin', storedPins({ Serial1: '', Serial2: 'A0' }), MEGA, null],
      ['a fixed pin over a stored entry', storedPins({ Serial: '4', Serial3: '-1' }), FX3U, null],
      ['a fixed pin outside the pattern', {}, { ...FX3U, rs485FixedPins: { Serial3: 'P A' } }, null],
      ['the legacy pin on a per-UART board', legacyPin(' 22 '), MEGA, 'Serial2'],
      ['an invalid legacy pin on a per-UART board', legacyPin('-1'), MEGA, 'Serial2'],
      ['the legacy pin beside fixed pins', legacyPin('17'), FX3U, 'Serial'],
      ['the legacy pin on a legacy board', legacyPin('22 '), LEGACY, 'Serial1'],
      ['an invalid legacy pin on a legacy board', legacyPin('-1'), LEGACY, 'Serial1'],
      ['the legacy pin without a server', legacyPin('17'), LEGACY, null],
      [
        'an empty map beside the legacy pair',
        fromProjectFile({ enable_rs485_en_pin: true, rs485_en_pin: '17', rs485_en_pins: {} }),
        MEGA,
        'Serial',
      ],
    ]

    it.each(FIXTURES)('with %s', (_name, state, board, uart) => {
      const valid = Object.fromEntries(
        Object.entries(storedRs485Pins(state, board, uart)).filter(([, pin]) => isValidRs485Pin(pin)),
      )

      expect(resolveRs485Pins(state, board, uart)).toEqual(valid)
    })
  })
})
