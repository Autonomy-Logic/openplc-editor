import type { DevicePin } from '../../../middleware/shared/ports/types'
import {
  ADDRESS_ACTIONS,
  checkIfAddressExists,
  checkIfPinExists,
  checkIfPinIsValid,
  checkIfPinAliasExists,
  checkIfPinAliasIsValid,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  isAddressTheLowestInItsType,
  pinAliasValidation,
  pinValidation,
  removeAddressPrefix,
} from '../slices/device/validation/pins'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePin(overrides?: Partial<DevicePin>): DevicePin {
  return {
    pin: overrides?.pin ?? 'P0',
    pinType: overrides?.pinType ?? 'digitalInput',
    address: overrides?.address ?? '%IX0.0',
    alias: overrides?.alias ?? 'pin_0',
  }
}

// ---------------------------------------------------------------------------
// removeAddressPrefix
// ---------------------------------------------------------------------------

describe('removeAddressPrefix', () => {
  it('removes %IX prefix', () => {
    expect(removeAddressPrefix('%IX0.0')).toBe('0.0')
  })

  it('removes %QX prefix', () => {
    expect(removeAddressPrefix('%QX1.3')).toBe('1.3')
  })

  it('removes %IW prefix', () => {
    expect(removeAddressPrefix('%IW5')).toBe('5')
  })

  it('removes %QW prefix', () => {
    expect(removeAddressPrefix('%QW12')).toBe('12')
  })

  it('returns original string when no known prefix', () => {
    expect(removeAddressPrefix('NOPREFIX42')).toBe('NOPREFIX42')
  })
})

// ---------------------------------------------------------------------------
// extractPositionForAnalogAddress
// ---------------------------------------------------------------------------

describe('extractPositionForAnalogAddress', () => {
  it('extracts position from analog address with prefix', () => {
    expect(extractPositionForAnalogAddress('%IW7')).toBe(7)
  })

  it('extracts position from bare number string', () => {
    expect(extractPositionForAnalogAddress('42')).toBe(42)
  })

  it('returns -1 when no numeric match', () => {
    expect(extractPositionForAnalogAddress('abc')).toBe(-1)
  })

  it('returns -1 for empty string', () => {
    expect(extractPositionForAnalogAddress('')).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// extractPositionsForDigitalAddress
// ---------------------------------------------------------------------------

describe('extractPositionsForDigitalAddress', () => {
  it('extracts position and dotPosition from %IX address', () => {
    const result = extractPositionsForDigitalAddress('%IX3.5')
    expect(result).toEqual({ position: 3, dotPosition: 5 })
  })

  it('extracts position and dotPosition from %QX address', () => {
    const result = extractPositionsForDigitalAddress('%QX0.7')
    expect(result).toEqual({ position: 0, dotPosition: 7 })
  })

  it('handles multi-digit position', () => {
    const result = extractPositionsForDigitalAddress('%IX12.6')
    expect(result).toEqual({ position: 12, dotPosition: 6 })
  })

  it('handles position 0.0', () => {
    const result = extractPositionsForDigitalAddress('%IX0.0')
    expect(result).toEqual({ position: 0, dotPosition: 0 })
  })
})

// ---------------------------------------------------------------------------
// ADDRESS_ACTIONS
// ---------------------------------------------------------------------------

describe('ADDRESS_ACTIONS', () => {
  it('contains INCREMENT and DECREMENT', () => {
    expect(ADDRESS_ACTIONS).toEqual(['INCREMENT', 'DECREMENT'])
  })
})

// ---------------------------------------------------------------------------
// createNewAddress
// ---------------------------------------------------------------------------

describe('createNewAddress', () => {
  describe('digital input (%IX)', () => {
    it('returns first address when no number match', () => {
      expect(createNewAddress('INCREMENT', '%IX')).toBe('%IX0.0')
    })

    it('returns first address for DECREMENT when no number match', () => {
      expect(createNewAddress('DECREMENT', '%IX')).toBe('%IX0.0')
    })

    it('increments dot position', () => {
      expect(createNewAddress('INCREMENT', '%IX0.0')).toBe('%IX0.1')
    })

    it('wraps from .7 to next byte', () => {
      expect(createNewAddress('INCREMENT', '%IX0.7')).toBe('%IX1.0')
    })

    it('decrements dot position', () => {
      expect(createNewAddress('DECREMENT', '%IX0.3')).toBe('%IX0.2')
    })

    it('decrements from .0 wraps to previous byte .7', () => {
      expect(createNewAddress('DECREMENT', '%IX1.0')).toBe('%IX0.7')
    })

    it('throws when decrementing below 0.0', () => {
      expect(() => createNewAddress('DECREMENT', '%IX0.0')).toThrow('Cannot decrement below 0.0')
    })
  })

  describe('digital output (%QX)', () => {
    it('returns first address when no number match', () => {
      expect(createNewAddress('INCREMENT', '%QX')).toBe('%QX0.0')
    })

    it('returns first address for DECREMENT when no number match', () => {
      expect(createNewAddress('DECREMENT', '%QX')).toBe('%QX0.0')
    })

    it('increments dot position', () => {
      expect(createNewAddress('INCREMENT', '%QX2.5')).toBe('%QX2.6')
    })

    it('wraps from .7 to next byte', () => {
      expect(createNewAddress('INCREMENT', '%QX3.7')).toBe('%QX4.0')
    })

    it('decrements dot position', () => {
      expect(createNewAddress('DECREMENT', '%QX1.4')).toBe('%QX1.3')
    })

    it('decrements from .0 wraps to previous byte .7', () => {
      expect(createNewAddress('DECREMENT', '%QX2.0')).toBe('%QX1.7')
    })

    it('throws when decrementing below 0.0', () => {
      expect(() => createNewAddress('DECREMENT', '%QX0.0')).toThrow('Cannot decrement below 0.0')
    })
  })

  describe('analog input (%IW)', () => {
    it('returns first address when no number match', () => {
      expect(createNewAddress('INCREMENT', '%IW')).toBe('%IW0')
    })

    it('returns first address for DECREMENT when no number match', () => {
      expect(createNewAddress('DECREMENT', '%IW')).toBe('%IW0')
    })

    it('increments position', () => {
      expect(createNewAddress('INCREMENT', '%IW3')).toBe('%IW4')
    })

    it('decrements position', () => {
      expect(createNewAddress('DECREMENT', '%IW5')).toBe('%IW4')
    })

    it('throws when decrementing below 0', () => {
      expect(() => createNewAddress('DECREMENT', '%IW0')).toThrow('Cannot decrement below 0')
    })
  })

  describe('analog output (%QW)', () => {
    it('returns first address when no number match', () => {
      expect(createNewAddress('INCREMENT', '%QW')).toBe('%QW0')
    })

    it('returns first address for DECREMENT when no number match', () => {
      expect(createNewAddress('DECREMENT', '%QW')).toBe('%QW0')
    })

    it('increments position', () => {
      expect(createNewAddress('INCREMENT', '%QW10')).toBe('%QW11')
    })

    it('decrements position', () => {
      expect(createNewAddress('DECREMENT', '%QW2')).toBe('%QW1')
    })

    it('throws when decrementing below 0', () => {
      expect(() => createNewAddress('DECREMENT', '%QW0')).toThrow('Cannot decrement below 0')
    })
  })
})

// ---------------------------------------------------------------------------
// getHighestPinAddress
// ---------------------------------------------------------------------------

describe('getHighestPinAddress', () => {
  it('returns bare prefix for digitalInput when no pins of that type', () => {
    expect(getHighestPinAddress([], 'digitalInput')).toBe('%IX')
  })

  it('returns bare prefix for digitalOutput when no pins of that type', () => {
    expect(getHighestPinAddress([], 'digitalOutput')).toBe('%QX')
  })

  it('returns bare prefix for analogInput when no pins of that type', () => {
    expect(getHighestPinAddress([], 'analogInput')).toBe('%IW')
  })

  it('returns bare prefix for analogOutput when no pins of that type', () => {
    expect(getHighestPinAddress([], 'analogOutput')).toBe('%QW')
  })

  it('returns the single pin address for digitalInput', () => {
    const pins: DevicePin[] = [makePin({ pinType: 'digitalInput', address: '%IX1.3' })]
    expect(getHighestPinAddress(pins, 'digitalInput')).toBe('%IX1.3')
  })

  it('returns highest address among multiple digitalInput pins', () => {
    const pins: DevicePin[] = [
      makePin({ pinType: 'digitalInput', address: '%IX0.1' }),
      makePin({ pinType: 'digitalInput', address: '%IX2.5' }),
      makePin({ pinType: 'digitalInput', address: '%IX1.0' }),
    ]
    expect(getHighestPinAddress(pins, 'digitalInput')).toBe('%IX2.5')
  })

  it('returns highest address among multiple analogInput pins', () => {
    const pins: DevicePin[] = [
      makePin({ pinType: 'analogInput', address: '%IW3' }),
      makePin({ pinType: 'analogInput', address: '%IW7' }),
      makePin({ pinType: 'analogInput', address: '%IW1' }),
    ]
    expect(getHighestPinAddress(pins, 'analogInput')).toBe('%IW7')
  })

  it('returns highest address for digitalOutput', () => {
    const pins: DevicePin[] = [
      makePin({ pinType: 'digitalOutput', address: '%QX0.2' }),
      makePin({ pinType: 'digitalOutput', address: '%QX0.6' }),
    ]
    expect(getHighestPinAddress(pins, 'digitalOutput')).toBe('%QX0.6')
  })

  it('returns highest address for analogOutput', () => {
    const pins: DevicePin[] = [
      makePin({ pinType: 'analogOutput', address: '%QW0' }),
      makePin({ pinType: 'analogOutput', address: '%QW9' }),
      makePin({ pinType: 'analogOutput', address: '%QW4' }),
    ]
    expect(getHighestPinAddress(pins, 'analogOutput')).toBe('%QW9')
  })

  it('returns empty string fallback when pin has undefined address', () => {
    // Exercise the ?? '' fallback on line 123
    const pins = [{ pin: 'D0', pinType: 'digitalInput' as const, address: undefined as unknown as string }]
    expect(getHighestPinAddress(pins, 'digitalInput')).toBe('')
  })

  it('handles pins with identical address positions (comparator returns 0)', () => {
    // Two pins with the same numeric address value — exercises the return 0 branch
    const pins: DevicePin[] = [
      makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.3' }),
      makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.3' }),
    ]
    // Either one could be "highest" since they are equal; just verify it returns one of them
    expect(getHighestPinAddress(pins, 'digitalInput')).toBe('%IX0.3')
  })

  it('filters by pin type correctly (ignores other types)', () => {
    const pins: DevicePin[] = [
      makePin({ pinType: 'digitalInput', address: '%IX0.5' }),
      makePin({ pinType: 'analogInput', address: '%IW10' }),
    ]
    expect(getHighestPinAddress(pins, 'digitalInput')).toBe('%IX0.5')
    expect(getHighestPinAddress(pins, 'analogInput')).toBe('%IW10')
    expect(getHighestPinAddress(pins, 'digitalOutput')).toBe('%QX')
  })
})

// ---------------------------------------------------------------------------
// isAddressTheLowestInItsType
// ---------------------------------------------------------------------------

describe('isAddressTheLowestInItsType', () => {
  it('returns true for %IX0.0', () => {
    expect(isAddressTheLowestInItsType('%IX0.0')).toBe(true)
  })

  it('returns true for %QX0.0', () => {
    expect(isAddressTheLowestInItsType('%QX0.0')).toBe(true)
  })

  it('returns true for %IW0', () => {
    expect(isAddressTheLowestInItsType('%IW0')).toBe(true)
  })

  it('returns true for %QW0', () => {
    expect(isAddressTheLowestInItsType('%QW0')).toBe(true)
  })

  it('returns false for non-zero digital address', () => {
    expect(isAddressTheLowestInItsType('%IX1.3')).toBe(false)
  })

  it('returns false for non-zero analog address', () => {
    expect(isAddressTheLowestInItsType('%IW5')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkIfPinExists
// ---------------------------------------------------------------------------

describe('checkIfPinExists', () => {
  const pins: DevicePin[] = [makePin({ pin: 'A0' }), makePin({ pin: 'D3' })]

  it('returns true when pin exists', () => {
    expect(checkIfPinExists(pins, 'A0')).toBe(true)
  })

  it('returns false when pin does not exist', () => {
    expect(checkIfPinExists(pins, 'A5')).toBe(false)
  })

  it('returns false for empty pin map', () => {
    expect(checkIfPinExists([], 'A0')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pinValidation
// ---------------------------------------------------------------------------

describe('pinValidation', () => {
  it('accepts alphanumeric pin', () => {
    expect(pinValidation('A0')).toBe(true)
  })

  it('accepts pin with underscores', () => {
    expect(pinValidation('pin_1')).toBe(true)
  })

  it('accepts pin with dots', () => {
    expect(pinValidation('pin.1')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(pinValidation('')).toBe(false)
  })

  it('rejects pin with spaces', () => {
    expect(pinValidation('pin 1')).toBe(false)
  })

  it('rejects pin with special chars', () => {
    expect(pinValidation('pin@1')).toBe(false)
  })

  it('rejects pin with hyphen', () => {
    expect(pinValidation('pin-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkIfPinIsValid
// ---------------------------------------------------------------------------

describe('checkIfPinIsValid', () => {
  const pins: DevicePin[] = [makePin({ pin: 'A0' })]

  it('returns error when pin is empty (undefined)', () => {
    const result = checkIfPinIsValid(pins, undefined)
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin')
    expect(result.message).toBe('Pin cannot be empty.')
  })

  it('returns error when pin is empty string', () => {
    const result = checkIfPinIsValid(pins, '')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin')
    expect(result.message).toBe('Pin cannot be empty.')
  })

  it('returns error when pin has invalid characters', () => {
    const result = checkIfPinIsValid(pins, 'pin@1')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin')
    expect(result.message).toContain('letters, numbers, underscores, or dots')
  })

  it('returns error when pin already exists', () => {
    const result = checkIfPinIsValid(pins, 'A0')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Pin Already Exists')
    expect(result.message).toContain('Check the table row: 1')
  })

  it('returns valid when pin is unique and well-formed', () => {
    const result = checkIfPinIsValid(pins, 'B1')
    expect(result.ok).toBe(true)
    expect(result.title).toBe('Valid Pin')
    expect(result.message).toBe('Pin is valid.')
  })

  it('returns valid for empty pin map', () => {
    const result = checkIfPinIsValid([], 'A0')
    expect(result.ok).toBe(true)
  })

  it('returns Unknown when findIndex fails to locate the duplicate pin', () => {
    const spied = vi.spyOn(Array.prototype, 'findIndex').mockReturnValueOnce(-1)
    const result = checkIfPinIsValid(pins, 'A0')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown')
    spied.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// checkIfPinAliasExists
// ---------------------------------------------------------------------------

describe('checkIfPinAliasExists', () => {
  const pins: DevicePin[] = [makePin({ alias: 'Sensor1' })]

  it('returns true when name exists (case insensitive)', () => {
    expect(checkIfPinAliasExists(pins, 'sensor1')).toBe(true)
  })

  it('returns true when name matches exactly', () => {
    expect(checkIfPinAliasExists(pins, 'Sensor1')).toBe(true)
  })

  it('returns false when name does not exist', () => {
    expect(checkIfPinAliasExists(pins, 'Motor1')).toBe(false)
  })

  it('returns false for empty map', () => {
    expect(checkIfPinAliasExists([], 'Sensor1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pinAliasValidation
// ---------------------------------------------------------------------------

describe('pinAliasValidation', () => {
  it('accepts pure numeric string', () => {
    expect(pinAliasValidation('123')).toBe(true)
  })

  it('accepts alphabetic string', () => {
    expect(pinAliasValidation('Sensor')).toBe(true)
  })

  it('accepts alphanumeric with underscores', () => {
    expect(pinAliasValidation('Sensor_1')).toBe(true)
  })

  it('accepts alphanumeric suffix', () => {
    expect(pinAliasValidation('Pin1')).toBe(true)
  })

  it('accepts multi-segment underscore name', () => {
    expect(pinAliasValidation('input_temp_sensor')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(pinAliasValidation('')).toBe(false)
  })

  it('rejects string with spaces', () => {
    expect(pinAliasValidation('my sensor')).toBe(false)
  })

  it('rejects string with special chars', () => {
    expect(pinAliasValidation('pin@1')).toBe(false)
  })

  it('rejects string starting with underscore', () => {
    expect(pinAliasValidation('_pin')).toBe(false)
  })

  it('rejects string with dot', () => {
    expect(pinAliasValidation('pin.1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkIfPinAliasIsValid
// ---------------------------------------------------------------------------

describe('checkIfPinAliasIsValid', () => {
  const pins: DevicePin[] = [makePin({ alias: 'Motor1' })]

  it('returns error when name is undefined', () => {
    const result = checkIfPinAliasIsValid(pins, undefined)
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin Alias')
    expect(result.message).toBe('Pin alias cannot be empty.')
  })

  it('returns error when name is empty string', () => {
    const result = checkIfPinAliasIsValid(pins, '')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin Alias')
    expect(result.message).toBe('Pin alias cannot be empty.')
  })

  it('returns error when name has invalid characters', () => {
    const result = checkIfPinAliasIsValid(pins, 'invalid name')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid Pin Alias')
    expect(result.message).toContain('alphanumeric or use underscores')
  })

  it('returns error when name already exists', () => {
    const result = checkIfPinAliasIsValid(pins, 'motor1')
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Pin Alias Already Exists')
    expect(result.message).toContain('Check the table row: 1')
  })

  it('returns Unknown when findIndex fails to locate the duplicate name', () => {
    // Force findIndex to return -1 even though some() returned true
    const _originalFindIndex = Array.prototype.findIndex
    const spied = vi.spyOn(Array.prototype, 'findIndex').mockReturnValueOnce(-1)
    const result = checkIfPinAliasIsValid(pins, 'motor1')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown')
    spied.mockRestore()
    // Verify restoration
    expect([1, 2, 3].findIndex((x) => x === 2)).toBe(1)
  })

  it('returns valid for unique well-formed name', () => {
    const result = checkIfPinAliasIsValid(pins, 'Sensor2')
    expect(result.ok).toBe(true)
    expect(result.title).toBe('Valid Pin Alias')
    expect(result.message).toBe('Pin alias is valid.')
  })

  it('returns valid for empty pin map', () => {
    const result = checkIfPinAliasIsValid([], 'Motor1')
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkIfAddressExists
// ---------------------------------------------------------------------------

describe('checkIfAddressExists', () => {
  const pins: DevicePin[] = [makePin({ address: '%IX0.0' }), makePin({ address: '%QW3' })]

  it('returns true when address exists', () => {
    expect(checkIfAddressExists(pins, '%IX0.0')).toBe(true)
  })

  it('returns true for second existing address', () => {
    expect(checkIfAddressExists(pins, '%QW3')).toBe(true)
  })

  it('returns false when address does not exist', () => {
    expect(checkIfAddressExists(pins, '%IX1.0')).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(checkIfAddressExists([], '%IX0.0')).toBe(false)
  })
})
