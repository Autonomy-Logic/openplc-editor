import type { PLCVariable } from '../../../../../middleware/shared/ports/types'

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

const checkVariableNameUnit = (variables: PLCVariable[], variableName: string) => {
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

export { arrayValidation, checkVariableNameUnit, enumeratedValidation }
