import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { DISALLOWED_LOCATION_CLASSES } from '../../../../utils/generate-iec-string-to-variables'
import {
  BOOL_LOCATION_REGEX,
  DWORD_LOCATION_REGEX,
  LWORD_LOCATION_REGEX,
  PLC_ADDRESS_PREFIX,
  WORD_LOCATION_REGEX,
} from '../../../../utils/PLC/address-constants/types'
import type { ProjectResponse } from '../types'

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
 * This is a validation to check if the variable name already exists.
 **/
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  const nameAlreadyInUse = variables.some((variable) => variable.name.toLowerCase() === name.toLowerCase())
  return nameAlreadyInUse
}
const checkIfGlobalVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}

/**
 * This is a validation to check if the value of the location is unique.
 *
 * `exclude` lets the update path skip the variable currently being
 * mutated — re-setting a variable's location to its current value
 * (e.g. to re-resolve a renamed alias) must not collide with itself.
 * Reference-equality is enough since `variables` is the live array
 * and the caller passes the same object reference.
 */
const checkIfLocationExists = (variables: PLCVariable[], location: string, exclude?: PLCVariable) => {
  return variables.some((variable) => variable !== exclude && variable.location === location)
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
 * Validate a variable's `location`. Single-field model: `location` is either
 * an alias name, a literal IEC address, or empty.
 *   - Empty → unlocated, valid.
 *   - A non-`%` value → an alias name; its concrete address (and therefore
 *     its type match) is resolved at compile time, so accept it here.
 *   - A literal `%…` → must match the variable's type's address class.
 */
const variableLocationValidation = (variableLocation: string, variableType: string) => {
  if (variableLocation === '' || !variableLocation.startsWith('%')) return true
  switch (variableType.toUpperCase()) {
    case 'BOOL': {
      const boolMatch = BOOL_LOCATION_REGEX.test(variableLocation) && variableLocation.split('.')[1] <= '7'
      return boolMatch
    }
    case 'INT':
    case 'UINT':
    case 'WORD':
      return WORD_LOCATION_REGEX.test(variableLocation)
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD':
      return DWORD_LOCATION_REGEX.test(variableLocation)
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return LWORD_LOCATION_REGEX.test(variableLocation)
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
      return 'Valid locations: %QD0, %ID0, %MD0 (change the number to the desired location)'
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return 'Valid locations: %QL0, %IL0, %ML0 (change the number to the desired location)'
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

    // Treat variables without numbers as having number -1 for sorting purposes
    // This ensures they come before numbered variables
    const sortNumberA = numberA === -1 ? -1 : numberA
    const sortNumberB = numberB === -1 ? -1 : numberB

    return sortNumberA - sortNumberB
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
/**
 * Increment an IEC 61131-3 address by one slot, respecting the
 * width of the variable's underlying type.  For BOOL addresses
 * (`%IX/%QX<byte>.<bit>`) the bit field wraps from .7 back to .0
 * with the byte index bumping by one; for word / dword / lword
 * forms the numeric index after the prefix increments by one.
 *
 * Returns `null` when the type isn't recognised — the caller stops
 * the auto-increment loop and falls back to whatever location it
 * currently holds, so an unknown future IEC type can't produce an
 * infinite loop here.
 */
const incrementLocationByOne = (location: string, typeValue: string): string | null => {
  switch (typeValue.toUpperCase()) {
    case 'BOOL': {
      const stringWithNoPrefix = location
        .replace(PLC_ADDRESS_PREFIX.BOOL_OUTPUT, '')
        .replace(PLC_ADDRESS_PREFIX.BOOL_INPUT, '')
      const position = parseInt(stringWithNoPrefix.split('.')[0])
      const dotPosition = parseInt(stringWithNoPrefix.split('.')[1])
      const prefix = location.startsWith(PLC_ADDRESS_PREFIX.BOOL_OUTPUT)
        ? PLC_ADDRESS_PREFIX.BOOL_OUTPUT
        : PLC_ADDRESS_PREFIX.BOOL_INPUT
      return `${prefix}${dotPosition === 7 ? position + 1 : position}.${dotPosition === 7 ? 0 : dotPosition + 1}`
    }
    case 'INT':
    case 'UINT':
    case 'WORD': {
      const stringWithNoPrefix = location
        .replace(PLC_ADDRESS_PREFIX.WORD_OUTPUT, '')
        .replace(PLC_ADDRESS_PREFIX.WORD_INPUT, '')
        .replace(PLC_ADDRESS_PREFIX.WORD_MEMORY, '')
      const position = parseInt(stringWithNoPrefix)
      const prefix = location.startsWith(PLC_ADDRESS_PREFIX.WORD_OUTPUT)
        ? PLC_ADDRESS_PREFIX.WORD_OUTPUT
        : location.startsWith(PLC_ADDRESS_PREFIX.WORD_INPUT)
          ? PLC_ADDRESS_PREFIX.WORD_INPUT
          : PLC_ADDRESS_PREFIX.WORD_MEMORY
      return `${prefix}${position + 1}`
    }
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD': {
      const stringWithNoPrefix = location
        .replace(PLC_ADDRESS_PREFIX.DWORD_OUTPUT, '')
        .replace(PLC_ADDRESS_PREFIX.DWORD_INPUT, '')
        .replace(PLC_ADDRESS_PREFIX.DWORD_MEMORY, '')
      const position = parseInt(stringWithNoPrefix)
      const prefix = location.startsWith(PLC_ADDRESS_PREFIX.DWORD_OUTPUT)
        ? PLC_ADDRESS_PREFIX.DWORD_OUTPUT
        : location.startsWith(PLC_ADDRESS_PREFIX.DWORD_INPUT)
          ? PLC_ADDRESS_PREFIX.DWORD_INPUT
          : PLC_ADDRESS_PREFIX.DWORD_MEMORY
      return `${prefix}${position + 1}`
    }
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD': {
      const stringWithNoPrefix = location
        .replace(PLC_ADDRESS_PREFIX.LWORD_OUTPUT, '')
        .replace(PLC_ADDRESS_PREFIX.LWORD_INPUT, '')
        .replace(PLC_ADDRESS_PREFIX.LWORD_MEMORY, '')
      const position = parseInt(stringWithNoPrefix)
      const prefix = location.startsWith(PLC_ADDRESS_PREFIX.LWORD_OUTPUT)
        ? PLC_ADDRESS_PREFIX.LWORD_OUTPUT
        : location.startsWith(PLC_ADDRESS_PREFIX.LWORD_INPUT)
          ? PLC_ADDRESS_PREFIX.LWORD_INPUT
          : PLC_ADDRESS_PREFIX.LWORD_MEMORY
      return `${prefix}${position + 1}`
    }
    default:
      return null
  }
}

/** Safety bound on the auto-increment loop in `createVariableValidation`.
 *  Picked well above any realistic project size (8 bits × N bytes =
 *  N×8 BOOLs; this lets us scan ~1000 bytes / words / dwords / lwords
 *  before we give up).  The loop normally terminates after at most
 *  a handful of iterations — the bound only matters if the table is
 *  pathologically dense or an unknown IEC type slipped past
 *  `incrementLocationByOne`'s switch. */
const MAX_AUTO_INCREMENT_ITERATIONS = 8192

const createVariableValidation = (
  variables: PLCVariable[],
  variable: PLCVariable,
): { name: string; location: string } => {
  const { name: variableName } = variable
  // Interface-class variables cannot carry a physical location — the ST
  // parser rejects such declarations when the project is reopened
  // (GitHub issue #904). Strip the location instead of rejecting so
  // creation flows that clone an existing row as a template still succeed.
  const variableLocation = DISALLOWED_LOCATION_CLASSES.includes(variable.class) ? '' : variable.location
  const response = { name: variableName, location: variableLocation }

  if (checkIfVariableExists(variables, variableName)) {
    const { name: variableNameWithoutNumber, number } = checkVariableName(variables, variableName)
    response.name = `${variableNameWithoutNumber}${number}`
  }

  if (checkIfLocationExists(variables, variableLocation) && variableLocation !== '') {
    // Scan forward through the address space until we find a slot
    // that no other variable in this table holds.  Single-increment
    // wasn't enough: when the user kept clicking "+" through a row
    // of contiguous variables, the increment would eventually land
    // ON another already-bound row and silently produce a duplicate-
    // location collision that only the compiler caught (forum
    // thread, v4.2.0 follow-up).  An `inUse` set keeps the inner
    // check O(1) so the loop is linear in the number of variables.
    const inUse = new Set(variables.map((v) => v.location))
    let candidate = variableLocation
    let iterations = 0
    while (inUse.has(candidate) && iterations < MAX_AUTO_INCREMENT_ITERATIONS) {
      const next = incrementLocationByOne(candidate, variable.type.value)
      if (!next || next === candidate) break // unknown type / no progress — bail
      candidate = next
      iterations += 1
    }
    response.location = candidate
  }
  return response
}

/**
 * This is a validation to check the name of the variable at update.
 * If the variable name is invalid, create a response.
 * If the variable name already exists, create or change a response.
 **/
const updateVariableValidation = (
  variables: PLCVariable[],
  dataToBeUpdated: Partial<PLCVariable>,
  variableToUpdate: PLCVariable,
) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.class) {
    // Switching to an interface class makes an existing physical location
    // invalid IEC — the saved declaration would fail to parse on reopen
    // (GitHub issue #904) — so clear the location in the same update.
    // Enforced here (not only in the table UI) so every caller keeps the
    // invariant.
    response.data = DISALLOWED_LOCATION_CLASSES.includes(dataToBeUpdated.class)
      ? { class: dataToBeUpdated.class, location: '' }
      : { class: dataToBeUpdated.class }
  }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      response = {
        ok: false,
        title: 'Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfVariableExists(variables, name)) {
      response = {
        ok: false,
        title: 'Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }

    if (!variableNameValidation(name)) {
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

    // A physical location is only valid on `local` (VAR) and `global`
    // (VAR_GLOBAL) declarations — mirrors the parser rule that makes a
    // located interface-class variable un-parseable on project reopen
    // (GitHub issue #904).
    const effectiveClass = dataToBeUpdated.class ?? variableToUpdate.class
    if (effectiveClass && DISALLOWED_LOCATION_CLASSES.includes(effectiveClass)) {
      response = {
        ok: false,
        title: 'Location is not allowed.',
        message: `Variables of class "${effectiveClass.toUpperCase()}" cannot have a physical location ("AT"). Use class LOCAL for located variables.`,
      }
      return response
    }

    // Exclude the variable being updated so re-setting its own
    // location (e.g. re-picking the same address to refresh a
    // renamed alias) doesn't trip the uniqueness check on itself.
    if (checkIfLocationExists(variables, location, variableToUpdate)) {
      response = {
        ok: false,
        title: 'Location already exists',
        message: 'Please make sure that the location is unique.',
      }
      return response
    }

    if (!variableLocationValidation(location, variableToUpdate.type.value)) {
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

const updateGlobalVariableValidation = (variables: PLCVariable[], dataToBeUpdated: Partial<PLCVariable>) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      response = {
        ok: false,
        title: 'Global Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfGlobalVariableExists(variables, name)) {
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
  createVariableValidation,
  enumeratedValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
}
