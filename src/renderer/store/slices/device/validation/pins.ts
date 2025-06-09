import type { DevicePin, PinTypes } from '../types'

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

const handleDigitalAddress = (prefix: string, action: (typeof ADDRESS_ACTIONS)[number], address: string) => {
  const { position, dotPosition } = extractPositionsForDigitalAddress(address)
  if (action === 'INCREMENT') {
    if (dotPosition === 7) {
      return `${prefix}${position + 1}.0`
    }
    return `${prefix}${position}.${dotPosition + 1}`
  }

  /**
   * DECREMENT
   * TODO: We shouldn't throw an error if it's the first address, instead we gonna remove the pin from the state.
   * This will be implemented in a future feature.
   */
  if (position === 0 && dotPosition === 0) {
    throw new Error('Cannot decrement below 0.0')
  }
  if (dotPosition === 0) {
    return `${prefix}${position - 1}.7`
  }
  return `${prefix}${position}.${dotPosition - 1}`
}

const handleAnalogAddress = (prefix: string, action: (typeof ADDRESS_ACTIONS)[number], address: string) => {
  const position = extractPositionForAnalogAddress(address)

  if (action === 'INCREMENT') {
    return `${prefix}${position + 1}`
  }

  /**
   * DECREMENT
   * TODO: We shouldn't throw an error if it's the first address, instead we gonna remove the pin from the state.
   * This will be implemented in a future feature.
   */
  if (position === 0) {
    throw new Error('Cannot decrement below 0')
  }
  return `${prefix}${position - 1}`
}

const createNewAddress = (action: (typeof ADDRESS_ACTIONS)[number], address: string) => {
  const isFirstAddress = address.match(/(\d+)$/)

  if (address.includes('%IX')) {
    if (isFirstAddress === null) {
      return '%IX0.0'
    }

    return handleDigitalAddress('%IX', action, address)
  } else if (address.includes('%QX')) {
    if (isFirstAddress === null) {
      return '%QX0.0'
    }

    return handleDigitalAddress('%QX', action, address)
  } else if (address.includes('%IW')) {
    if (isFirstAddress === null) {
      return '%IW0'
    }
    return handleAnalogAddress('%IW', action, address)
  }

  if (isFirstAddress === null) {
    return '%QW0'
  }
  return handleAnalogAddress('%QW', action, address)
}

const getHighestPinAddress = (pinMap: DevicePin[], pinType: PinTypes) => {
  let pinWithHighestAddress: Partial<DevicePin> = {}
  const compareAddressPosition = (firstPin: DevicePin, secondPin: DevicePin) => {
    const firstAddressPosition = Number(removeAddressPrefix(firstPin.address))
    const secondAddressPosition = Number(removeAddressPrefix(secondPin.address))
    if (firstAddressPosition > secondAddressPosition) {
      return 1
    }
    if (firstAddressPosition < secondAddressPosition) {
      return -1
    }
    return 0
  }

  switch (pinType) {
    case 'digitalInput': {
      const orderDigitalInputPins = pinMap.filter((pin) => pin.pinType === 'digitalInput').sort(compareAddressPosition)
      pinWithHighestAddress = orderDigitalInputPins[orderDigitalInputPins.length - 1]
      break
    }
    case 'digitalOutput': {
      const orderDigitalOutputPins = pinMap
        .filter((pin) => pin.pinType === 'digitalOutput')
        .sort(compareAddressPosition)
      pinWithHighestAddress = orderDigitalOutputPins[orderDigitalOutputPins.length - 1]
      break
    }
    case 'analogInput': {
      const orderAnalogInputPins = pinMap.filter((pin) => pin.pinType === 'analogInput').sort(compareAddressPosition)
      pinWithHighestAddress = orderAnalogInputPins[orderAnalogInputPins.length - 1]
      break
    }
    case 'analogOutput': {
      const orderAnalogOutputPins = pinMap.filter((pin) => pin.pinType === 'analogOutput').sort(compareAddressPosition)
      pinWithHighestAddress = orderAnalogOutputPins[orderAnalogOutputPins.length - 1]
      break
    }
  }

  return pinWithHighestAddress.address ?? ''
}
/**
 * This function is used to verify if the pin that will be manipulated is the lowest in its type.
 * If it is the lowest we don't need to perform any other operation to reassign new addresses.
 * @param address
 * @returns boolean
 */
const isAddressTheLowestInItsType = (address: string) => {
  const pinAddressPosition = Number(removeAddressPrefix(address))
  if (pinAddressPosition === 0) return true
  return false
}

export {
  ADDRESS_ACTIONS,
  checkIfAddressExists,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  isAddressTheLowestInItsType,
  removeAddressPrefix
}
