import { PLCTask } from '@root/types/PLC/open-plc'

const checkIfTaskExists = (tasks: PLCTask[], name: string) => {
  return tasks.some((task) => task.name === name)
}

// const taskNameValidation = (taskName: string) => {
//   const regex =
//     /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
//   return regex.test(taskName)
// }

const createTaskValidation = (tasks: PLCTask[], name: string) => {
  if (checkIfTaskExists(tasks, name)) {
    const regex = /_\d+$/
    const filteredTasks = tasks.filter((task: PLCTask) => task.name.includes(name.replace(regex, '')))
    const sortedTasks = filteredTasks.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      if (matchA && matchB) {
        return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
      }
      return 0
    })
    const biggestTask = sortedTasks[sortedTasks.length - 1].name.match(regex)
    let number = biggestTask ? parseInt(biggestTask[0].slice(1)) : 0
    for (let i = sortedTasks.length - 1; i >= 1; i--) {
      const previousTask = sortedTasks[i].name.match(regex)
      const previousNumber = previousTask ? parseInt(previousTask[0].slice(1)) : 0
      const currentTask = sortedTasks[i - 1].name.match(regex)
      const currentNumber = currentTask ? parseInt(currentTask[0].slice(1)) : 0
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }
    const newTaskName = `${name.replace(regex, '')}_${number + 1}`
    return newTaskName
  }
  return name
}

export { checkIfTaskExists, createTaskValidation }
