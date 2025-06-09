import type { DevicePin } from '../../types'
import {
  checkIfAddressExists,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  isAddressTheLowestInItsType,
  removeAddressPrefix,
} from '../pins'

describe('pin validation utilities', () => {
  describe('checkIfAddressExists', () => {
    const pinMap: DevicePin[] = [
      { pin: 'P1', pinType: 'digitalInput', address: '%IX0.0', name: 'DI1' },
      { pin: 'P2', pinType: 'digitalOutput', address: '%QX0.1', name: 'DO1' },
      { pin: 'P3', pinType: 'analogInput', address: '%IW0', name: 'AI1' },
    ]

    it('should return true if address exists', () => {
      expect(checkIfAddressExists(pinMap, '%IX0.0')).toBe(true)
    })

    it('should return false if address does not exist', () => {
      expect(checkIfAddressExists(pinMap, '%QX0.2')).toBe(false)
    })

    it('should return false for an empty pinMap', () => {
      expect(checkIfAddressExists([], '%IX0.0')).toBe(false)
    })
  })

  describe('removeAddressPrefix', () => {
    it('should remove %IX prefix', () => {
      expect(removeAddressPrefix('%IX0.0')).toBe('0.0')
    })

    it('should remove %QX prefix', () => {
      expect(removeAddressPrefix('%QX1.2')).toBe('1.2')
    })

    it('should remove %IW prefix', () => {
      expect(removeAddressPrefix('%IW3')).toBe('3')
    })

    it('should remove %QW prefix', () => {
      expect(removeAddressPrefix('%QW4')).toBe('4')
    })

    it('should return the same string if no prefix is found', () => {
      expect(removeAddressPrefix('0.0')).toBe('0.0')
    })
  })

  describe('extractPositionForAnalogAddress', () => {
    it('should extract the number from an analog address', () => {
      expect(extractPositionForAnalogAddress('%IW123')).toBe(123)
      expect(extractPositionForAnalogAddress('%QW0')).toBe(0)
    })

    it('should return -1 if no number is found', () => {
      expect(extractPositionForAnalogAddress('%IW')).toBe(-1)
      expect(extractPositionForAnalogAddress('test')).toBe(-1)
    })
  })

  describe('extractPositionsForDigitalAddress', () => {
    it('should extract position and dotPosition from a digital address', () => {
      expect(extractPositionsForDigitalAddress('%IX0.0')).toEqual({ position: 0, dotPosition: 0 })
      expect(extractPositionsForDigitalAddress('%QX12.3')).toEqual({ position: 12, dotPosition: 3 })
    })

    it('should handle addresses without prefix correctly', () => {
      expect(extractPositionsForDigitalAddress('4.5')).toEqual({ position: 4, dotPosition: 5 })
    })
  })

  describe('createNewAddress', () => {
    describe('INCREMENT', () => {
      it('should increment digital input addresses', () => {
        expect(createNewAddress('INCREMENT', '%IX0.0')).toBe('%IX0.1')
        expect(createNewAddress('INCREMENT', '%IX0.7')).toBe('%IX1.0')
        expect(createNewAddress('INCREMENT', '%IX1.2')).toBe('%IX1.3')
      })

      it('should return initial digital input address if address is empty string like', () => {
        expect(createNewAddress('INCREMENT', '%IX')).toBe('%IX0.0')
      })

      it('should increment digital output addresses', () => {
        expect(createNewAddress('INCREMENT', '%QX0.0')).toBe('%QX0.1')
        expect(createNewAddress('INCREMENT', '%QX0.7')).toBe('%QX1.0')
        expect(createNewAddress('INCREMENT', '%QX1.2')).toBe('%QX1.3')
      })

      it('should return initial digital output address if address is empty string like', () => {
        expect(createNewAddress('INCREMENT', '%QX')).toBe('%QX0.0')
      })

      it('should increment analog input addresses', () => {
        expect(createNewAddress('INCREMENT', '%IW0')).toBe('%IW1')
        expect(createNewAddress('INCREMENT', '%IW5')).toBe('%IW6')
      })

      it('should return initial analog input address if address is empty string like', () => {
        expect(createNewAddress('INCREMENT', '%IW')).toBe('%IW0')
      })

      it('should increment analog output addresses', () => {
        expect(createNewAddress('INCREMENT', '%QW0')).toBe('%QW1')
        expect(createNewAddress('INCREMENT', '%QW5')).toBe('%QW6')
      })

      it('should return initial analog output address if address is empty string like', () => {
        expect(createNewAddress('INCREMENT', '%QW')).toBe('%QW0')
      })

      it('should default to %QW0 for empty string', () => {
        expect(createNewAddress('INCREMENT', '')).toBe('%QW0') // Default case in function
      })
    })

    describe('DECREMENT', () => {
      it('should decrement digital input addresses', () => {
        expect(createNewAddress('DECREMENT', '%IX0.1')).toBe('%IX0.0')
        expect(createNewAddress('DECREMENT', '%IX1.0')).toBe('%IX0.7')
        expect(createNewAddress('DECREMENT', '%IX1.2')).toBe('%IX1.1')
      })

      it('should throw error when decrementing %IX0.0', () => {
        expect(() => createNewAddress('DECREMENT', '%IX0.0')).toThrow('Cannot decrement below 0.0')
      })

      it('should decrement digital output addresses', () => {
        expect(createNewAddress('DECREMENT', '%QX0.1')).toBe('%QX0.0')
        expect(createNewAddress('DECREMENT', '%QX1.0')).toBe('%QX0.7')
        expect(createNewAddress('DECREMENT', '%QX1.2')).toBe('%QX1.1')
      })

      it('should throw error when decrementing %QX0.0', () => {
        expect(() => createNewAddress('DECREMENT', '%QX0.0')).toThrow('Cannot decrement below 0.0')
      })

      it('should decrement analog input addresses', () => {
        expect(createNewAddress('DECREMENT', '%IW1')).toBe('%IW0')
        expect(createNewAddress('DECREMENT', '%IW5')).toBe('%IW4')
      })

      it('should throw error when decrementing %IW0', () => {
        expect(() => createNewAddress('DECREMENT', '%IW0')).toThrow('Cannot decrement below 0')
      })

      it('should decrement analog output addresses', () => {
        expect(createNewAddress('DECREMENT', '%QW1')).toBe('%QW0')
        expect(createNewAddress('DECREMENT', '%QW5')).toBe('%QW4')
      })

      it('should throw error when decrementing %QW0', () => {
        expect(() => createNewAddress('DECREMENT', '%QW0')).toThrow('Cannot decrement below 0')
      })
    })
  })

  describe('getHighestPinAddress', () => {
    const pinMap: DevicePin[] = [
      { pin: 'P1', pinType: 'digitalInput', address: '%IX0.0', name: 'DI1' },
      { pin: 'P2', pinType: 'digitalInput', address: '%IX0.2', name: 'DI2' },
      { pin: 'P3', pinType: 'digitalInput', address: '%IX0.1', name: 'DI3' },
      { pin: 'P4', pinType: 'digitalOutput', address: '%QX1.0', name: 'DO1' },
      { pin: 'P5', pinType: 'digitalOutput', address: '%QX0.5', name: 'DO2' },
      { pin: 'P6', pinType: 'analogInput', address: '%IW0', name: 'AI1' },
      { pin: 'P7', pinType: 'analogInput', address: '%IW2', name: 'AI2' },
      { pin: 'P8', pinType: 'analogOutput', address: '%QW5', name: 'AO1' },
      { pin: 'P9', pinType: 'analogOutput', address: '%QW1', name: 'AO2' },
    ]

    it('should return the highest digital input address', () => {
      expect(getHighestPinAddress(pinMap, 'digitalInput')).toBe('%IX0.2')
    })

    it('should return the highest digital output address', () => {
      expect(getHighestPinAddress(pinMap, 'digitalOutput')).toBe('%QX1.0')
    })

    it('should return the highest analog input address', () => {
      expect(getHighestPinAddress(pinMap, 'analogInput')).toBe('%IW2')
    })

    it('should return the highest analog output address', () => {
      expect(getHighestPinAddress(pinMap, 'analogOutput')).toBe('%QW5')
    })

    it('should handle a single pin correctly', () => {
      const singleDigitalInput: DevicePin[] = [{ pin: 'P1', pinType: 'digitalInput', address: '%IX0.0', name: 'DI1' }]
      expect(getHighestPinAddress(singleDigitalInput, 'digitalInput')).toBe('%IX0.0')

      const singleAnalogOutput: DevicePin[] = [{ pin: 'P1', pinType: 'analogOutput', address: '%QW3', name: 'AO1' }]
      expect(getHighestPinAddress(singleAnalogOutput, 'analogOutput')).toBe('%QW3')
    })

    it('should correctly compare digital addresses with different main numbers', () => {
      const pins: DevicePin[] = [
        { pin: 'P1', pinType: 'digitalInput', address: '%IX0.7', name: 'DI1' },
        { pin: 'P2', pinType: 'digitalInput', address: '%IX1.0', name: 'DI2' },
        { pin: 'P3', pinType: 'digitalInput', address: '%IX0.1', name: 'DI3' },
      ]
      expect(getHighestPinAddress(pins, 'digitalInput')).toBe('%IX1.0')
    })

    it('should correctly compare digital addresses with same main numbers but different sub-numbers', () => {
      const pins: DevicePin[] = [
        { pin: 'P1', pinType: 'digitalOutput', address: '%QX2.3', name: 'DO1' },
        { pin: 'P2', pinType: 'digitalOutput', address: '%QX2.7', name: 'DO2' },
        { pin: 'P3', pinType: 'digitalOutput', address: '%QX2.1', name: 'DO3' },
      ]
      expect(getHighestPinAddress(pins, 'digitalOutput')).toBe('%QX2.7')
    })

    it('should correctly compare analog addresses', () => {
      const pins: DevicePin[] = [
        { pin: 'P1', pinType: 'analogInput', address: '%IW10', name: 'AI1' },
        { pin: 'P2', pinType: 'analogInput', address: '%IW2', name: 'AI2' },
        { pin: 'P3', pinType: 'analogInput', address: '%IW15', name: 'AI3' },
      ]
      expect(getHighestPinAddress(pins, 'analogInput')).toBe('%IW15')
    })

    describe('edge cases for getHighestPinAddress with removeAddressPrefix logic', () => {
      // The `removeAddressPrefix` function for digital addresses like '%IX0.0' becomes '0.0'.
      // Number('0.0') is 0. For '%IX1.0' it becomes '1.0', Number('1.0') is 1.
      // This means the comparison logic in `getHighestPinAddress` might behave unexpectedly
      // if not carefully handled, as it relies on `Number(removeAddressPrefix(address))`.
      // Let's test this specifically.

      it('should correctly sort digital addresses based on numeric conversion of stripped address', () => {
        const digitalPins: DevicePin[] = [
          { pin: 'P1', pinType: 'digitalInput', address: '%IX0.7' }, // Number('0.7') = 0.7
          { pin: 'P2', pinType: 'digitalInput', address: '%IX1.0' }, // Number('1.0') = 1
          { pin: 'P3', pinType: 'digitalInput', address: '%IX0.1' }, // Number('0.1') = 0.1
          { pin: 'P4', pinType: 'digitalInput', address: '%IX10.0' }, // Number('10.0') = 10
          { pin: 'P5', pinType: 'digitalInput', address: '%IX2.5' }, // Number('2.5') = 2.5
        ]
        // Expected order after sort (ascending by Number(removeAddressPrefix(pin.address))):
        // %IX0.1 (0.1)
        // %IX0.7 (0.7)
        // %IX1.0 (1)
        // %IX2.5 (2.5)
        // %IX10.0 (10)
        // So highest should be %IX10.0
        expect(getHighestPinAddress(digitalPins, 'digitalInput')).toBe('%IX10.0')
      })

      it('should handle cases where sub-address might make string sort different from numeric sort', () => {
        const digitalPins: DevicePin[] = [
          { pin: 'P1', pinType: 'digitalOutput', address: '%QX1.7' }, // Number('1.7') = 1.7
          { pin: 'P2', pinType: 'digitalOutput', address: '%QX2.0' }, // Number('2.0') = 2
          { pin: 'P3', pinType: 'digitalOutput', address: '%QX1.1' }, // Number('1.1') = 1.1
          // String sort might put "2.0" before "1.7" if not careful, but numeric is fine.
        ]
        expect(getHighestPinAddress(digitalPins, 'digitalOutput')).toBe('%QX2.0')
      })

      it('should handle analog addresses with varying number of digits', () => {
        const analogPins: DevicePin[] = [
          { pin: 'P1', pinType: 'analogInput', address: '%IW9' }, // Number('9') = 9
          { pin: 'P2', pinType: 'analogInput', address: '%IW10' }, // Number('10') = 10
          { pin: 'P3', pinType: 'analogInput', address: '%IW2' }, // Number('2') = 2
        ]
        expect(getHighestPinAddress(analogPins, 'analogInput')).toBe('%IW10')
      })
    })
  })

  describe('isAddressTheLowestInItsType', () => {
    it('should return true for %IX0.0', () => {
      expect(isAddressTheLowestInItsType('%IX0.0')).toBe(true)
    })

    it('should return true for %QX0.0', () => {
      expect(isAddressTheLowestInItsType('%QX0.0')).toBe(true)
    })

    it('should return true for %IW0', () => {
      expect(isAddressTheLowestInItsType('%IW0')).toBe(true)
    })

    it('should return true for %QW0', () => {
      expect(isAddressTheLowestInItsType('%QW0')).toBe(true)
    })

    it('should return false for %IX0.1', () => {
      expect(isAddressTheLowestInItsType('%IX0.1')).toBe(false)
    })

    it('should return false for %QX1.0', () => {
      expect(isAddressTheLowestInItsType('%QX1.0')).toBe(false)
    })

    it('should return false for %IW1', () => {
      expect(isAddressTheLowestInItsType('%IW1')).toBe(false)
    })

    it('should return false for %QW5', () => {
      expect(isAddressTheLowestInItsType('%QW5')).toBe(false)
    })

    it('should return true if address without prefix is "0"', () => {
      // This case might occur if a non-standard address is passed but removeAddressPrefix results in "0"
      expect(isAddressTheLowestInItsType('0')).toBe(true)
    })

    it('should return false if address without prefix is not "0"', () => {
      expect(isAddressTheLowestInItsType('1')).toBe(false)
      expect(isAddressTheLowestInItsType('0.1')).toBe(false) // Number('0.1') is 0.1, not 0
    })
  })
})
