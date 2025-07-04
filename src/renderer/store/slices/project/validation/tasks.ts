import { PLCTask } from '@root/types/PLC/open-plc'

import { ProjectResponse } from '../types'

const checkIfTaskExists = (tasks: PLCTask[], name: string) => {
  return tasks.some((task) => task.name === name)
}

const taskNameValidation = (taskName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(taskName)
}

const createTaskValidation = (tasks: PLCTask[], name: string) => {
  const regex = /\d+$/

  if (checkIfTaskExists(tasks, name)) {
    const baseName = name.replace(regex, '')

    const filteredTasks = tasks.filter((task) => task.name.startsWith(baseName))

    const sortedTasks = filteredTasks.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      const numA = matchA ? parseInt(matchA[0]) : -1
      const numB = matchB ? parseInt(matchB[0]) : -1
      return numA - numB
    })

    const biggestMatch = sortedTasks[sortedTasks.length - 1]?.name.match(regex)
    let number = biggestMatch ? parseInt(biggestMatch[0]) : -1

    for (let i = sortedTasks.length - 1; i >= 1; i--) {
      const previousTask = sortedTasks[i].name.match(regex)
      const currentTask = sortedTasks[i - 1].name.match(regex)
      const previousNumber = previousTask ? parseInt(previousTask[0]) : -1
      const currentNumber = currentTask ? parseInt(currentTask[0]) : -1
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }

    return `${baseName}${number + 1}`
  }

  return name
}

const updateTaskValidation = (tasks: PLCTask[], dataToBeUpdated: Partial<PLCTask>) => {
  let response: ProjectResponse = { ok: true }

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
