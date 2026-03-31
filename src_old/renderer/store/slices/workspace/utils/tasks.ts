import { PLCTask } from '@root/types/PLC/open-plc'

import { WorkspaceResponse } from '../types'

const checkIfTaskExists = (tasks: PLCTask[], name: string) => {
  return tasks.some((task) => task.name.toLowerCase() === name.toLowerCase())
}

const taskNameValidation = (taskName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(taskName)
}

const extractNumberAtEnd = (str: string): { number: number; length: number } => {
  const match = str.match(/(\d+)$/)
  const number = match ? parseInt(match[0], 10) : -1
  return {
    number,
    length: match ? match[0].length : 0,
  }
}

const createTaskValidation = (tasks: PLCTask[], name: string) => {
  if (!checkIfTaskExists(tasks, name)) {
    return name
  }

  // Extract base name without trailing number
  const baseName = name.substring(0, name.length - extractNumberAtEnd(name).length)

  // Filter tasks that start with the base name
  const filteredTasks = tasks.filter((task: PLCTask) => task.name.toLowerCase().startsWith(baseName.toLowerCase()))

  // Sort by the number at the end
  const sortedTasks = filteredTasks.sort((a, b) => {
    const numberA = extractNumberAtEnd(a.name).number
    const numberB = extractNumberAtEnd(b.name).number
    const sortNumberA = numberA === -1 ? -1 : numberA
    const sortNumberB = numberB === -1 ? -1 : numberB
    return sortNumberA - sortNumberB
  })

  // Get the highest number and increment
  const biggestNumber =
    sortedTasks.length > 0 ? extractNumberAtEnd(sortedTasks[sortedTasks.length - 1].name).number : -1

  return `${baseName}${biggestNumber + 1}`
}

const updateTaskValidation = (tasks: PLCTask[], dataToBeUpdated: Partial<PLCTask>) => {
  let response: WorkspaceResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      console.error('Task name is empty')
      response = {
        ok: false,
        title: 'Task name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfTaskExists(tasks, name)) {
      console.error(`Task "${name}" already exists`)
      response = {
        ok: false,
        title: 'Task already exists.',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }
    if (!taskNameValidation(name)) {
      console.error(`Task "${name}" name is invalid`)
      response = {
        ok: false,
        title: 'Task name is invalid.',
        message: `Please make sure that the name is valid. Valid names: CamelCase, PascalCase or SnakeCase.`,
      }
      return response
    }
  }

  return response
}

export { checkIfTaskExists, createTaskValidation, updateTaskValidation }
