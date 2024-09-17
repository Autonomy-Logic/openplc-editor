import { PLCInstance } from '@root/types/PLC/open-plc'

const checkIfInstanceExists = (instances: PLCInstance[], name: string) => {
  return instances.some((instance) => instance.name === name)
}

const instanceNameValidation = (instanceName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(instanceName)
}

const createInstanceValidation = (instances: PLCInstance[], name: string) => {
  if (checkIfInstanceExists(instances, name)) {
    const regex = /_\d+$/
    const filteredInstances = instances.filter((instance: PLCInstance) =>
      instance.name.includes(name.replace(regex, '')),
    )
    const sortedInstances = filteredInstances.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      if (matchA && matchB) {
        return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
      }
      return 0
    })
    const biggestInstance = sortedInstances[sortedInstances.length - 1].name.match(regex)
    let number = biggestInstance ? parseInt(biggestInstance[0].slice(1)) : 0
    for (let i = sortedInstances.length - 1; i >= 1; i--) {
      const previousInstance = sortedInstances[i].name.match(regex)
      const previousNumber = previousInstance ? parseInt(previousInstance[0].slice(1)) : 0
      const currentInstance = sortedInstances[i - 1].name.match(regex)
      const currentNumber = currentInstance ? parseInt(currentInstance[0].slice(1)) : 0
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }
    const newInstanceName = `${name.replace(regex, '')}_${number + 1}`
    return newInstanceName
  }
  return name
}



export { checkIfInstanceExists, createInstanceValidation,instanceNameValidation }
