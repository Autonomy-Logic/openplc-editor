import type { DevicePin } from '../types'

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

export { checkIfAddressExists, extractPositionForAnalogAddress, extractPositionsForDigitalAddress, pinAddressValidation }
