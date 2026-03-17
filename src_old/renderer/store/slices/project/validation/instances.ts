import { PLCInstance } from '@root/types/PLC/open-plc'

import { ProjectResponse } from '../types'
const checkIfInstanceExists = (instances: PLCInstance[], name: string) => {
  return instances.some((instance) => instance.name === name)
}

const instanceNameValidation = (instanceName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(instanceName)
}

const createInstanceValidation = (instances: PLCInstance[], name: string) => {
  const regex = /\d+$/

  if (checkIfInstanceExists(instances, name)) {
    const baseName = name.replace(regex, '')

    const filteredInstances = instances.filter((instance) => instance.name.startsWith(baseName))

    const sortedInstances = filteredInstances.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      const numA = matchA ? parseInt(matchA[0]) : -1
      const numB = matchB ? parseInt(matchB[0]) : -1
      return numA - numB
    })

    const biggestMatch = sortedInstances[sortedInstances.length - 1].name.match(regex)
    let number = biggestMatch ? parseInt(biggestMatch[0]) : -1

    for (let i = sortedInstances.length - 1; i >= 1; i--) {
      const previousInstance = sortedInstances[i].name.match(regex)
      const currentInstance = sortedInstances[i - 1].name.match(regex)
      const previousNumber = previousInstance ? parseInt(previousInstance[0]) : -1
      const currentNumber = currentInstance ? parseInt(currentInstance[0]) : -1
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }

    return `${baseName}${number + 1}`
  }

  return name
}

const updateInstanceValidation = (instances: PLCInstance[], dataToBeUpdated: Partial<PLCInstance>) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      console.error('Instance name is empty')
      response = {
        ok: false,
        title: 'Instance name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfInstanceExists(instances, name)) {
      console.error(`Instance "${name}" already exists`)
      response = {
        ok: false,
        title: 'Instance already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }

    if (!instanceNameValidation(name)) {
      console.error(`Instance "${name}" name is invalid`)
      response = {
        ok: false,
        title: 'Instance name is invalid.',
        message: 'Please make sure that the name is valid.',
      }
      return response
    }
  }

  return response
}

export { checkIfInstanceExists, createInstanceValidation, instanceNameValidation, updateInstanceValidation }
