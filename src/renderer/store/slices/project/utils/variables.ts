import { PLCGlobalVariable, PLCVariable } from '@root/types/PLC/open-plc'

import { ProjectResponse } from '../types'

/**
 * This is a validation to check if the variable name already exists.
 **/
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}
const checkIfGlobalVariableExists = (variables: PLCGlobalVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
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
 * This is a validation to check if variable is correct.
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
 * This is a validation to check if the value of the location is unique.
 */
const checkIfLocationExists = (variables: PLCVariable[], location: string) => {
  return variables.some((variable) => variable.location === location)
}

/**
 * This is a validation to check if it is needed changing the name of a variable at creation.
 * If the variable existis change the variable name.
 **/
const createVariableValidation = (variables: PLCVariable[], variableName: string) => {
  if (checkIfVariableExists(variables, variableName)) {
    const regex = /_\d+$/
    const filteredVariables = variables.filter((variable: PLCVariable) =>
      variable.name.includes(variableName.replace(regex, '')),
    )
    const sortedVariables = filteredVariables.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      if (matchA && matchB) {
        return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
      }
      return 0
    })
    const biggestVariable = sortedVariables[sortedVariables.length - 1].name.match(regex)
    let number = biggestVariable ? parseInt(biggestVariable[0].slice(1)) : 0
    for (let i = sortedVariables.length - 1; i >= 1; i--) {
      const previousVariable = sortedVariables[i].name.match(regex)
      const previousNumber = previousVariable ? parseInt(previousVariable[0].slice(1)) : 0
      const currentVariable = sortedVariables[i - 1].name.match(regex)
      const currentNumber = currentVariable ? parseInt(currentVariable[0].slice(1)) : 0
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }
    const newVariableName = `${variableName.replace(regex, '')}_${number + 1}`
    return newVariableName
  }
  return variableName
}

/**
 * This is a validation to check the name of the variable at update.
 * If the variable name is invalid, create a response.
 * If the variable name already exists, create or change a response.
 **/
const updateVariableValidation = (variables: PLCVariable[], dataToBeUpdated: Partial<PLCVariable>) => {
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
  }

  return response
}
const createGlobalVariableValidation = (variables: PLCGlobalVariable[], variableName: string) => {
  if (checkIfGlobalVariableExists(variables, variableName)) {
    const regex = /_\d+$/
    const filteredVariables = variables.filter((variable: PLCVariable) =>
      variable.name.includes(variableName.replace(regex, '')),
    )
    const sortedVariables = filteredVariables.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      if (matchA && matchB) {
        return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
      }
      return 0
    })
    const biggestVariable = sortedVariables[sortedVariables.length - 1].name.match(regex)
    let number = biggestVariable ? parseInt(biggestVariable[0].slice(1)) : 0
    for (let i = sortedVariables.length - 1; i >= 1; i--) {
      const previousVariable = sortedVariables[i].name.match(regex)
      const previousNumber = previousVariable ? parseInt(previousVariable[0].slice(1)) : 0
      const currentVariable = sortedVariables[i - 1].name.match(regex)
      const currentNumber = currentVariable ? parseInt(currentVariable[0].slice(1)) : 0
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }
    const newVariableName = `${variableName.replace(regex, '')}_${number + 1}`
    return newVariableName
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
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
}
