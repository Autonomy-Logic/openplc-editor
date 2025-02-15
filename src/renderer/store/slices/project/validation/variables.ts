import { PLCGlobalVariable, PLCStructureVariable, PLCVariable } from '@root/types/PLC/open-plc'

import { ProjectResponse } from '../types'

/**
 * This is a validation to check if the variable name already exists.
 **/

const checkIfStructureVariableExists = (variables: PLCStructureVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name.toLowerCase() === name.toLowerCase())
}
const checkIfGlobalVariableExists = (variables: PLCGlobalVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}

/**
 * This is a validation to check if the value of the location is unique.
 */
const checkIfLocationExists = (variables: PLCVariable[], location: string) => {
  return variables.some((variable) => variable.location === location)
}

/**
 * This function extracts the number at the end of a string.
 */
export const extractNumberAtEnd = (str: string): { number: number; string: string; length: number } => {
  const match = str.match(/(\d+)$/)
  const number = match ? parseInt(match[0], 10) : -1
  return {
    number,
    string: match ? match[0] : '',
    length: match ? match[0].length : 0,
  }
}

/**
 * This is a validation to check if the variable name is correct.
 * CamelCase, PascalCase or SnakeCase and can not be empty.
 **/
const variableNameValidation = (variableName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(variableName)
}

/**
 * This is a validation to check if the enumerated variable name is correct.
 *
 * The validation have to obey this rules:
 * - CamelCase, PascalCase or SnakeCase
 * - Can not be empty
 * - Can not be a reserved word
 */
const enumeratedValidation = ({ value }: { value: string }) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  if (value === '') {
    return {
      ok: false,
      title: 'Invalid enumerated value',
      message: `The enumerated value can not be empty.`,
    }
  }

  if (!regex.test(value)) {
    return {
      ok: false,
      title: 'Invalid enumerated value',
      message: `The enumerated value "${value}" is invalid. Valid names: CamelCase, PascalCase or SnakeCase.`,
    }
  }
  return { ok: true }
}

/**
 * This is a validation to check if the array variable is correct.
 *
 * The validation have to obey this rules:
 * 1. There CANNOT be space between the numeric values and dots
 * 2. The second number MUST always be greater than the first
 * 3. Only integer numbers can be used (shouldn't accept floating numbers or strings of any type)
 *
 * It is exported to be used at array-modal.tsx file present at src/renderer/components/_molecules/variables-table/elements.
 */
const validateArrayValue = (value: string) => {
  const [left, right] = value.split('..').map(Number)
  return Number.isInteger(left) && Number.isInteger(right) && left < right
}
const arrayValidation = ({ value }: { value: string }) => {
  const regex = /^(\d+)\.\.(\d+)$/
  if (value === '') {
    return {
      ok: false,
      title: 'Invalid array value',
      message: `The array value can not be empty.`,
    }
  }
  if (!regex.test(value) || !validateArrayValue(value)) {
    return {
      ok: false,
      title: 'Invalid array value',
      message: `The array value "${value}" is invalid. Pattern: "LEFT_number..RIGHT_number" and RIGHT must be GREATER than LEFT. Example: 0..10.`,
    }
  }
  return { ok: true }
}

/**
 * This is a validation to check if the value of the location is valid.
 *
 * The validation have to obey this rules:
 * 1. For BOOL type:
 *    - The location must start with the prefix "%QX" or "%IX"
 *    - Following the prefix, the location must have a integer number starting with 0
 *    - Following the number, the location must have a dot "."
 *    - Following the dot, the location must have a integer number starting with 0 and ending with 7
 * 2. For INT type:
 *    - The location must start with the prefix "%QW" or "%IW"
 *    - Following the prefix, the location must have a integer number starting with 0
 * 3. For MEMORY type:
 *    - The location must start with the prefix "%MW", "%MD" or "%ML"
 *    - Following the prefix, the location must have a integer number starting with 0
 */
const variableLocationValidation = (variableLocation: string, variableType: string) => {
  switch (variableType.toUpperCase()) {
    case 'BOOL': {
      const boolRegex = /^%[QI]X\d+\.\d$/
      const boolMatch = boolRegex.test(variableLocation) && variableLocation.split('.')[1] <= '7'
      return boolMatch
    }
    case 'INT':
    case 'UINT':
    case 'WORD':
      return /^%[QIM]W\d+$/.test(variableLocation)
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD':
      return /^%MD\d+$/.test(variableLocation)
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return /^%ML\d+$/.test(variableLocation)
    default:
      return false
  }
}

const variableLocationValidationErrorMessage = (variableType: string) => {
  switch (variableType.toUpperCase()) {
    case 'BOOL':
      return 'Valid locations: %QX0.0..7, %IX0.0..7 (change the number to the desired location)'
    case 'INT':
    case 'UINT':
    case 'WORD':
      return 'Valid locations: %QW0, %IW0, %MW0 (change the number to the desired location)'
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD':
      return 'Valid locations: %MD0 (change the number to the desired location)'
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return 'Valid locations: %ML0 (change the number to the desired location)'
    default:
      return ''
  }
}

/**
 * Check if the variable name exists and if it is needed to change the name of the variable.
 * Returns an object containing:
 * - ok: boolean (true if the variable exists, false otherwise)
 * - name: string (the new name of the variable)
 * - number: number (the biggest number at the end of the variable name)
 */

const checkVariableName = (variables: PLCVariable[], variableName: string) => {
  // Check if there is a variable with the same name when removing the number at the end
  const variableNameWithoutNumber = variableName.substring(
    0,
    variableName.length - extractNumberAtEnd(variableName).length,
  )
  const filteredVariables = variables.filter((variable: PLCVariable) =>
    variable.name.toLowerCase().includes(variableNameWithoutNumber.toLowerCase()),
  )

  // If there is a variable with the same name, sort the variables by the number at the end and get the biggest number
  const sortedVariables = filteredVariables.sort((a, b) => {
    const numberA = extractNumberAtEnd(a.name).number
    const numberB = extractNumberAtEnd(b.name).number
    if (numberA && numberB) {
      return numberA - numberB
    }
    return 0
  })

  // Get the biggest number at the end of the variable name
  // If there is no number at the end of the variable name, return -1 (because the number at the end of the variable name is 0)
  const biggestVariable =
    sortedVariables.length > 0 ? extractNumberAtEnd(sortedVariables[sortedVariables.length - 1].name) : { number: -1 }

  return {
    ok: filteredVariables.length > 0,
    name: variableNameWithoutNumber,
    number: biggestVariable.number + 1,
  }
}

/**
 * This is a validation to check if it is needed changing the name of a variable at creation.
 * If the variable exists change the variable name.
 **/
const createVariableValidation = (
  variables: PLCVariable[],
  variable: PLCVariable,
): { name: string; location: string } => {
  const { name: variableName, location: variableLocation } = variable
  const response = { name: variableName, location: variableLocation }

  if (checkIfVariableExists(variables, variableName)) {
    const { name: variableNameWithoutNumber, number } = checkVariableName(variables, variableName)
    response.name = `${variableNameWithoutNumber}${number}`
  }

  if (checkIfLocationExists(variables, variableLocation)) {
    if (variableLocation === '') return response

    const variableFound = variables.find((variable) => variable.location === variableLocation)
    if (!variableFound) return response

    switch (variable.type.value.toUpperCase()) {
      case 'BOOL': {
        const stringWithNoPrefix = variableFound.location.replace('%QX', '').replace('%IX', '')
        const position = parseInt(stringWithNoPrefix.split('.')[0])
        const dotPosition = parseInt(stringWithNoPrefix.split('.')[1])

        if (variableFound?.location.startsWith('%QX')) {
          response.location = `%QX${dotPosition === 7 ? position + 1 : position}.${dotPosition === 7 ? 0 : dotPosition + 1}`
        } else {
          response.location = `%IX${dotPosition === 7 ? position + 1 : position}.${dotPosition === 7 ? 0 : dotPosition + 1}`
        }
        break
      }

      case 'INT':
      case 'UINT':
      case 'WORD': {
        const stringWithNoPrefix = variableFound.location.replace('%QW', '').replace('%IW', '').replace('%MW', '')
        const position = parseInt(stringWithNoPrefix)
        if (variableFound?.location.startsWith('%QW')) {
          response.location = `%QW${position + 1}`
        } else if (variableFound?.location.startsWith('%IW')) {
          response.location = `%IW${position + 1}`
        } else {
          response.location = `%MW${position + 1}`
        }
        break
      }

      case 'DINT':
      case 'UDINT':
      case 'REAL':
      case 'DWORD': {
        const stringWithNoPrefix = variableFound.location.replace('%MD', '')
        const position = parseInt(stringWithNoPrefix)
        response.location = `%MD${position + 1}`
        break
      }

      case 'LINT':
      case 'ULINT':
      case 'LREAL':
      case 'LWORD': {
        const stringWithNoPrefix = variableFound.location.replace('%ML', '')
        const position = parseInt(stringWithNoPrefix)
        response.location = `%ML${position + 1}`
        break
      }

      default:
        break
    }
  }
  return response
}

/**
 * This is a validation to check the name of the variable at update.
 * If the variable name is invalid, create a response.
 * If the variable name already exists, create or change a response.
 **/

const updateStructureVariableValidation = (
  variables: PLCStructureVariable[],
  dataToBeUpdated: Partial<PLCStructureVariable>,
) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      console.error('Variable name is empty')
      response = {
        ok: false,
        title: 'Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfStructureVariableExists(variables, name)) {
      console.error(`Variable "${name}" already exists`)
      response = {
        ok: false,
        title: 'Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }

    if (!variableNameValidation(name)) {
      console.error(`Variable "${name}" name is invalid`)
      response = {
        ok: false,
        title: 'Variable name is invalid.',
        message: 'Please make sure that the name is valid.',
      }
      return response
    }
  }
}

const updateVariableValidation = (
  variables: PLCVariable[],
  dataToBeUpdated: Partial<PLCVariable>,
  variableToUpdate: PLCVariable,
) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      console.error('Variable name is empty')
      response = {
        ok: false,
        title: 'Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfVariableExists(variables, name)) {
      console.error(`Variable "${name}" already exists`)
      response = {
        ok: false,
        title: 'Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }

    if (!variableNameValidation(name)) {
      console.error(`Variable "${name}" name is invalid`)
      response = {
        ok: false,
        title: 'Variable name is invalid.',
        message: `Please make sure that the name is valid. Valid names: CamelCase, PascalCase or SnakeCase.`,
      }
      return response
    }
  }

  if (dataToBeUpdated.location) {
    const { location } = dataToBeUpdated
    if (checkIfLocationExists(variables, location)) {
      console.error(`Location "${location}" already exists`)
      response = {
        ok: false,
        title: 'Location already exists',
        message: 'Please make sure that the location is unique.',
      }
      return response
    }

    if (!variableLocationValidation(location, variableToUpdate.type.value)) {
      console.error(`Location "${location}" is invalid`)
      response = {
        ok: false,
        title: 'Location is invalid.',
        message: `Please make sure that the location is valid.\n${variableLocationValidationErrorMessage(variableToUpdate.type.value)}`,
      }
      return response
    }
  }

  if (dataToBeUpdated.type) {
    if (!variableLocationValidation(variableToUpdate.location, dataToBeUpdated.type.value)) {
      response.data = { ...(response.data ? response.data : {}), location: '' }
    }
    if (dataToBeUpdated.type.definition === 'derived') {
      response.data = { ...(response.data ? response.data : {}), location: '', initialValue: '', class: 'local' }
    }
  }

  return response
}
const createGlobalVariableValidation = (variables: PLCGlobalVariable[], variableName: string) => {
  if (checkIfGlobalVariableExists(variables, variableName)) {
    const { name: variableNameWithoutNumber, number } = checkVariableName(variables, variableName)
    return `${variableNameWithoutNumber}${number}`
  }
  return variableName
}

const updateGlobalVariableValidation = (
  variables: PLCGlobalVariable[],
  dataToBeUpdated: Partial<PLCGlobalVariable>,
) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      console.error('Global Variable name is empty')
      response = {
        ok: false,
        title: 'Global Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfGlobalVariableExists(variables, name)) {
      console.error(`Global Variable "${name}" already exists`)
      response = {
        ok: false,
        title: 'Global Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }
  }

  return response
}

export {
  arrayValidation,
  checkVariableName,
  createGlobalVariableValidation,
  createVariableValidation,
  enumeratedValidation,
  updateGlobalVariableValidation,
  updateStructureVariableValidation,
  updateVariableValidation,
}
