import { PLCVariable } from '@root/types/PLC/test'

import { WorkspaceResponse } from '../types'

/**
 * This is a validation to check if the variable name already exists.
 **/
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}
/**
 * This is a validation to check if the variable name is correct.
 **/
const variableNameValidation = (variableName: string | undefined) => {
  const regex = /^([A-Za-z_]+(_[A-Za-z0-9])*)$/
  return variableName === undefined ? false : regex.test(variableName)
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
const updateVariableValidation = (variables: PLCVariable[], name: string | undefined) => {
  let response: WorkspaceResponse = { ok: true }
  if (!variableNameValidation(name)) {
    console.error(`Variable "${name}" name is invalid`)
    response = {
      ok: false,
      title: 'Variable name is invalid.',
      message: `Please make sure that the name is valid. Valid names: CamelCase, PascalCase or SnakeCase and can not be empty.`,
    }
  }
  if (checkIfVariableExists(variables, name as string)) {
    console.error(`Variable "${name}" already exists`)
    response = {
      ok: false,
      title: response.title ? `${response.title.replace('.', ' ')} and already exists.` : 'Variable already exists',
      message: response.message
        ? `${response.message.split('.')[0]} and the name is unique. ${response.message.split('.')[1]}`
        : 'Please make sure that the name is unique.',
    }
  }
  return response
}

export { createVariableValidation, updateVariableValidation }
