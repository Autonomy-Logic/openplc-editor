import type { DevicePin, PinType } from '../../../../../middleware/shared/ports/types'
import { PLC_ADDRESS_PREFIX } from '../../../../utils/PLC/address-constants/types'

// ---------------------------------------------------------------------------
// Address manipulation
// ---------------------------------------------------------------------------

const removeAddressPrefix = (address: string) => {
  return address
    .replace(PLC_ADDRESS_PREFIX.BOOL_INPUT, '')
    .replace(PLC_ADDRESS_PREFIX.BOOL_OUTPUT, '')
    .replace(PLC_ADDRESS_PREFIX.WORD_INPUT, '')
    .replace(PLC_ADDRESS_PREFIX.WORD_OUTPUT, '')
}

const extractPositionForAnalogAddress = (address: string) => {
  const match = address.match(/(\d+)$/)
  return match ? parseInt(match[0], 10) : -1
}

const extractPositionsForDigitalAddress = (address: string) => {
  const stringWithNoPrefix = address
    .replace(PLC_ADDRESS_PREFIX.BOOL_INPUT, '')
    .replace(PLC_ADDRESS_PREFIX.BOOL_OUTPUT, '')
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

  if (position === 0) {
    throw new Error('Cannot decrement below 0')
  }
  return `${prefix}${position - 1}`
}

const createNewAddress = (action: (typeof ADDRESS_ACTIONS)[number], address: string) => {
  const isFirstAddress = address.match(/(\d+)$/)

  if (address.includes(PLC_ADDRESS_PREFIX.BOOL_INPUT)) {
    if (isFirstAddress === null) {
      return `${PLC_ADDRESS_PREFIX.BOOL_INPUT}0.0`
    }
    return handleDigitalAddress(PLC_ADDRESS_PREFIX.BOOL_INPUT, action, address)
  } else if (address.includes(PLC_ADDRESS_PREFIX.BOOL_OUTPUT)) {
    if (isFirstAddress === null) {
      return `${PLC_ADDRESS_PREFIX.BOOL_OUTPUT}0.0`
    }
    return handleDigitalAddress(PLC_ADDRESS_PREFIX.BOOL_OUTPUT, action, address)
  } else if (address.includes(PLC_ADDRESS_PREFIX.WORD_INPUT)) {
    if (isFirstAddress === null) {
      return `${PLC_ADDRESS_PREFIX.WORD_INPUT}0`
    }
    return handleAnalogAddress(PLC_ADDRESS_PREFIX.WORD_INPUT, action, address)
  }

  if (isFirstAddress === null) {
    return `${PLC_ADDRESS_PREFIX.WORD_OUTPUT}0`
  }
  return handleAnalogAddress(PLC_ADDRESS_PREFIX.WORD_OUTPUT, action, address)
}

const getHighestPinAddress = (pinMap: DevicePin[], pinType: PinType) => {
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
      const ordered = pinMap.filter((pin) => pin.pinType === 'digitalInput').sort(compareAddressPosition)
      if (ordered.length === 0) return PLC_ADDRESS_PREFIX.BOOL_INPUT
      pinWithHighestAddress = ordered[ordered.length - 1]
      break
    }
    case 'digitalOutput': {
      const ordered = pinMap.filter((pin) => pin.pinType === 'digitalOutput').sort(compareAddressPosition)
      if (ordered.length === 0) return PLC_ADDRESS_PREFIX.BOOL_OUTPUT
      pinWithHighestAddress = ordered[ordered.length - 1]
      break
    }
    case 'analogInput': {
      const ordered = pinMap.filter((pin) => pin.pinType === 'analogInput').sort(compareAddressPosition)
      if (ordered.length === 0) return PLC_ADDRESS_PREFIX.WORD_INPUT
      pinWithHighestAddress = ordered[ordered.length - 1]
      break
    }
    case 'analogOutput': {
      const ordered = pinMap.filter((pin) => pin.pinType === 'analogOutput').sort(compareAddressPosition)
      if (ordered.length === 0) return PLC_ADDRESS_PREFIX.WORD_OUTPUT
      pinWithHighestAddress = ordered[ordered.length - 1]
      break
    }
  }

  return pinWithHighestAddress.address ?? ''
}

const isAddressTheLowestInItsType = (address: string) => {
  return Number(removeAddressPrefix(address)) === 0
}

// ---------------------------------------------------------------------------
// Alias validation
// ---------------------------------------------------------------------------

const checkIfPinAliasExists = (pinMap: DevicePin[], alias: string) => {
  return pinMap.some((pin) => pin.alias?.toLowerCase() === alias?.toLowerCase())
}

const pinAliasValidation = (alias: string) => {
  const regex = /^(?:\d+|[A-Za-z]+(?:_\d+|_[A-Za-z]+)*|[A-Za-z]+\d*(?:_[A-Za-z]+\d*)*)$/
  return regex.test(alias)
}

const checkIfPinAliasIsValid = (pinMap: DevicePin[], alias: string | undefined) => {
  if (!alias) {
    return { ok: false, title: 'Invalid Pin Alias', message: 'Pin alias cannot be empty.' }
  }
  if (!pinAliasValidation(alias)) {
    return { ok: false, title: 'Invalid Pin Alias', message: 'Pin alias must be alphanumeric or use underscores.' }
  }
  if (checkIfPinAliasExists(pinMap, alias)) {
    const existingPin = pinMap.findIndex((pin) => pin.alias?.toLowerCase() === alias.toLowerCase())
    return {
      ok: false,
      title: 'Pin Alias Already Exists',
      message: 'Pin alias must be unique. Check the table row: ' + (existingPin !== -1 ? existingPin + 1 : 'Unknown'),
    }
  }
  return { ok: true, title: 'Valid Pin Alias', message: 'Pin alias is valid.' }
}

// ---------------------------------------------------------------------------
// Pin field validation
// ---------------------------------------------------------------------------

const checkIfPinExists = (pinMap: DevicePin[], name: string) => {
  return pinMap.some((pin) => pin.pin === name)
}

const pinValidation = (name: string) => {
  const regex = /^[A-Za-z0-9_.]+$/
  return regex.test(name)
}

const checkIfPinIsValid = (pinMap: DevicePin[], name: string | undefined) => {
  if (!name) {
    return { ok: false, title: 'Invalid Pin', message: 'Pin cannot be empty.' }
  }
  if (!pinValidation(name)) {
    return {
      ok: false,
      title: 'Invalid Pin',
      message: 'Pin must contain only letters, numbers, underscores, or dots.',
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
  return { ok: true, title: 'Valid Pin', message: 'Pin is valid.' }
}

const checkIfAddressExists = (pinMap: DevicePin[], address: string) => {
  return pinMap.some((pin) => pin.address === address)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  ADDRESS_ACTIONS,
  checkIfAddressExists,
  checkIfPinAliasExists,
  checkIfPinAliasIsValid,
  checkIfPinExists,
  checkIfPinIsValid,
  createNewAddress,
  extractPositionForAnalogAddress,
  extractPositionsForDigitalAddress,
  getHighestPinAddress,
  isAddressTheLowestInItsType,
  pinAliasValidation,
  pinValidation,
  removeAddressPrefix,
}
