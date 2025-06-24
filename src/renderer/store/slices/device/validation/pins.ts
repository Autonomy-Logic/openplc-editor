/**
 * ============================================================
 * This file contains functions to validate and manipulate device pin addresses.
 * ============================================================
 */

import { DevicePin, PinTypes } from '@root/types/PLC/devices'

/**
 * ============================================================
 * Functions to validate and manipulate device pin addresses
 * ============================================================
 */

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
      if (orderDigitalInputPins.length === 0) {
        return '%IX'
      }
      pinWithHighestAddress = orderDigitalInputPins[orderDigitalInputPins.length - 1]
      break
    }
    case 'digitalOutput': {
      const orderDigitalOutputPins = pinMap
        .filter((pin) => pin.pinType === 'digitalOutput')
        .sort(compareAddressPosition)
      if (orderDigitalOutputPins.length === 0) {
        return '%QX'
      }
      pinWithHighestAddress = orderDigitalOutputPins[orderDigitalOutputPins.length - 1]
      break
    }
    case 'analogInput': {
      const orderAnalogInputPins = pinMap.filter((pin) => pin.pinType === 'analogInput').sort(compareAddressPosition)
      if (orderAnalogInputPins.length === 0) {
        return '%IW'
      }
      pinWithHighestAddress = orderAnalogInputPins[orderAnalogInputPins.length - 1]
      break
    }
    case 'analogOutput': {
      const orderAnalogOutputPins = pinMap.filter((pin) => pin.pinType === 'analogOutput').sort(compareAddressPosition)
      if (orderAnalogOutputPins.length === 0) {
        return '%QW'
      }
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

/**
 * ============================================================
 * Name validation functions
 * ============================================================
 */
const checkIfPinNameExists = (pinMap: DevicePin[], name: string) => {
  return pinMap.some((pin) => pin.name?.toLowerCase() === name?.toLowerCase())
}

const pinNameValidation = (name: string) => {
  const regex = /^(?:\d+|[A-Za-z]+(?:_\d+|_[A-Za-z]+)*|[A-Za-z]+\d*(?:_[A-Za-z]+\d*)*)$/
  return regex.test(name)
}

const checkIfPinNameIsValid = (pinMap: DevicePin[], name: string | undefined) => {
  if (!name) {
    return {
      ok: false,
      title: 'Invalid Pin Name',
      message: 'Pin name cannot be empty.',
    }
  }
  if (!pinNameValidation(name)) {
    return {
      ok: false,
      title: 'Invalid Pin Name',
      message: 'Pin name must be alphanumeric or use underscores.',
    }
  }
  if (checkIfPinNameExists(pinMap, name)) {
    const existingPin = pinMap.findIndex((pin) => pin.name?.toLowerCase() === name.toLowerCase())
    return {
      ok: false,
      title: 'Pin Name Already Exists',
      message: 'Pin name must be unique. Check the table row: ' + (existingPin !== -1 ? existingPin + 1 : 'Unknown'),
    }
  }

  return {
    ok: true,
    title: 'Valid Pin Name',
    message: 'Pin name is valid.',
  }
}

/**
 * ============================================================
 * Pin validation functions
 * ============================================================
 */
const checkIfPinExists = (pinMap: DevicePin[], name: string) => {
  return pinMap.some((pin) => pin.pin === name)
}

const pinValidation = (name: string) => {
  const regex = /^(?:\d+|[A-Za-z]+(?:_\d+|_[A-Za-z]+)*|[A-ZaZ]+\d*(?:_[A-Za-z]+\d*)*)$/
  return regex.test(name)
}

const checkIfPinIsValid = (pinMap: DevicePin[], name: string | undefined) => {
  if (!name) {
    return {
      ok: false,
      title: 'Invalid Pin',
      message: 'Pin cannot be empty.',
    }
  }

  if (!pinValidation(name)) {
    return {
      ok: false,
      title: 'Invalid Pin',
      message: 'Pin must be alphanumeric or use underscores.',
    }
  }

  if (checkIfPinExists(pinMap, name)) {
    const existingPin = pinMap.findIndex((pin) => pin.pin === name)
    return {
      ok: false,
      title: 'Pin Already Exists',
      message: 'Pin must be unique. Check the table row: ' + (existingPin !== -1 ? existingPin + 1 : 'Unknown'),
    }
  }

  return {
    ok: true,
    title: 'Valid Pin',
    message: 'Pin is valid.',
  }
}

/**
 * ============================================================
 * Exported functions
 * ============================================================
 */

export {
  ADDRESS_ACTIONS,
  checkIfAddressExists,
  checkIfPinExists,
  checkIfPinIsValid,
  checkIfPinNameExists,
  checkIfPinNameIsValid,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  isAddressTheLowestInItsType,
  pinNameValidation,
  pinValidation,
  removeAddressPrefix,
}
