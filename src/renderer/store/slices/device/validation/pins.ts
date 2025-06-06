import type { DevicePin } from '../types'

type PinTypes = 'digitalInput' | 'digitalOutput' | 'analogInput' | 'analogOutput'

const addressPrefixRegex = {
  digital: /^%[QI]X\d+\.\d$/,
  analog: /^%[QI]W\d+$/,
}

/**
 * This is a validation to check if the value of the address is unique.
 */
const checkIfAddressExists = (pinMap: DevicePin[], address: string) => {
  return pinMap.some((pin) => pin.address === address)
}

const removeAddressPrefix = (address: string) => {
  return address.replace('%IX', '').replace('%QX', '').replace('%IW', '').replace('%QW', '')
}

/**
 * This function extracts the number at the end of a string.
 */
const extractPositionForAnalogAddress = (address: string) => {
  const match = address.match(/(\d+)$/)
  const number = match ? parseInt(match[0], 10) : -1
  return number
}
const extractPositionsForDigitalAddress = (address: string) => {
  const stringWithNoPrefix = address.replace('%IX', '').replace('%QX', '')
  const position = parseInt(stringWithNoPrefix.split('.')[0])
  const dotPosition = parseInt(stringWithNoPrefix.split('.')[1])
  return { position, dotPosition }
}

const ADDRESS_ACTIONS = ['INCREMENT', 'DECREMENT'] as const

const createNewAddress = (action: (typeof ADDRESS_ACTIONS)[number], address: string) => {
  const isFirstAddress = address.match(/(\d+)$/)

  if (address.includes('%IX')) {
    if (isFirstAddress === null) {
      return '%IX0.0'
    }

    const { position, dotPosition } = extractPositionsForDigitalAddress(address)

    if (action === 'INCREMENT') {
      if (dotPosition === 7) {
        return `%IX${position + 1}.0`
      }
      return `%IX${position}.${dotPosition + 1}`
    }

    if (dotPosition === 0) {
      return `%IX${position - 1}.7`
    }

    return `%IX${position}.${dotPosition - 1}`
  } else if (address.includes('%QX')) {
    if (isFirstAddress === null) {
      return '%QX0.0'
    }

    const { position, dotPosition } = extractPositionsForDigitalAddress(address)

    if (action === 'INCREMENT') {
      if (dotPosition === 7) {
        return `%QX${position + 1}.0`
      } else {
        return `%QX${position}.${dotPosition + 1}`
      }
    }

    if (dotPosition === 0) {
      return `%QX${position - 1}.7`
    }

    return `%QX${position}.${dotPosition - 1}`
  } else if (address.includes('%IW')) {
    if (isFirstAddress === null) {
      return '%IW0'
    }

    const position = extractPositionForAnalogAddress(address)

    if (action === 'INCREMENT') {
      return `%IW${position + 1}`
    }

    return `%IW${position - 1}`
  }

  if (isFirstAddress === null) {
    return '%QW0'
  }

  const position = extractPositionForAnalogAddress(address)

  if (action === 'INCREMENT') {
    return `%QW${position + 1}`
  }

  return `%QW${position - 1}`
}

// FIX: The code is being catch in the correct case, but only the compare logic for digitalInput address is being run.
const getHighestPinAddress = (pinMap: DevicePin[], pinType: PinTypes) => {
  let pinWithHighestAddress: DevicePin = { pin: '', pinType: 'digitalInput', address: '' }
  switch (pinType) {
    case 'digitalInput': {
      pinWithHighestAddress = pinMap.reduce((accumulator, currentValue) => {
        let result = accumulator
        if (accumulator.pinType === 'digitalInput' && currentValue.pinType === 'digitalInput') {
          const accumulatorPosition = Number(removeAddressPrefix(accumulator.address))
          console.log('🚀 ~ digitalInput - pinMap.reduce ~ accumulatorPosition:', accumulatorPosition)
          const currentValuePosition = Number(removeAddressPrefix(currentValue.address))
          console.log('🚀 ~ digitalInput - pinMap.reduce ~ currentValuePosition:', currentValuePosition)
          if (accumulatorPosition > currentValuePosition) {
            return result
          } else {
            result = currentValue
          }
        }
        return result
      })
      return pinWithHighestAddress.address
    }
    case 'digitalOutput': {
      pinWithHighestAddress = pinMap.reduce((accumulator, currentValue) => {
        let result = accumulator
        if (accumulator.pinType === 'digitalOutput' && currentValue.pinType === 'digitalOutput') {
          const accumulatorPosition = Number(removeAddressPrefix(accumulator.address))
          console.log('🚀 ~ digitalOutput - pinMap.reduce ~ accumulatorPosition:', accumulatorPosition)
          const currentValuePosition = Number(removeAddressPrefix(currentValue.address))
          console.log('🚀 ~ digitalOutput - pinMap.reduce ~ currentValuePosition:', currentValuePosition)
          if (accumulatorPosition > currentValuePosition) {
            return result
          } else {
            result = currentValue
          }
        }
        return result
      })
      return pinWithHighestAddress.address
    }
    case 'analogInput': {
      pinWithHighestAddress = pinMap.reduce((accumulator, currentValue) => {
        let result = accumulator
        if (accumulator.pinType === 'analogInput' && currentValue.pinType === 'analogInput') {
          const accumulatorPosition = Number(removeAddressPrefix(accumulator.address))
          console.log('🚀 ~ analogInput - pinMap.reduce ~ accumulatorPosition:', accumulatorPosition)
          const currentValuePosition = Number(removeAddressPrefix(currentValue.address))
          console.log('🚀 ~ analogInput - pinMap.reduce ~ currentValuePosition:', currentValuePosition)
          if (accumulatorPosition > currentValuePosition) {
            return result
          } else {
            result = currentValue
          }
        }
        return result
      })
      return pinWithHighestAddress.address
    }
    case 'analogOutput': {
      pinWithHighestAddress = pinMap.reduce((accumulator, currentValue) => {
        let result = accumulator
        if (accumulator.pinType === 'analogOutput' && currentValue.pinType === 'analogOutput') {
          const accumulatorPosition = Number(removeAddressPrefix(accumulator.address))
          console.log('🚀 ~ analogOutput - pinMap.reduce ~ accumulatorPosition:', accumulatorPosition)
          const currentValuePosition = Number(removeAddressPrefix(currentValue.address))
          console.log('🚀 ~ analogOutput - pinMap.reduce ~ currentValuePosition:', currentValuePosition)
          if (accumulatorPosition > currentValuePosition) {
            return result
          } else {
            result = currentValue
          }
        }
        return result
      })
      return pinWithHighestAddress.address
    }
  }
}
/**
 * This is a validation to check if the value of the pin address is valid.
 *
 * The validation have to obey this rules:
 * 1. For digital types:
 *    - The address must start with the prefix "%QX" or "%IX"
 *    - Following the prefix, the address must have a integer number starting with 0
 *    - Following the number, the address must have a dot "."
 *    - Following the dot, the address must have a integer number starting with 0 and ending with 7
 * 2. For analog types:
 *    - The address must start with the prefix "%QW" or "%IW"
 *    - Following the prefix, the address must have a integer number starting with 0
 */
const pinAddressValidation = (pinAddress: string, pinType: string) => {
  switch (pinType) {
    case 'digital':
      return addressPrefixRegex.digital.test(pinAddress) && pinAddress.split('.')[1] <= '7'
      break
    case 'analog':
      return addressPrefixRegex.analog.test(pinAddress)
      break
    default:
      return false
  }
}

export {
  ADDRESS_ACTIONS,
  checkIfAddressExists,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  pinAddressValidation,
}
