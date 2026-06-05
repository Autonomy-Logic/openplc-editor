import { toNumber } from 'lodash'

let counter = 0
let lastTimestamp = 0

export const generateNumericUUID = () => {
  const timestamp = Date.now()

  if (timestamp !== lastTimestamp) {
    counter = 0
    lastTimestamp = timestamp
  } else {
    counter++
  }

  const shortenedTimestamp = timestamp.toString().slice(7, 13)
  const randomNumbers = Math.floor(Math.random() * 10000000)
  const uniqueId = toNumber(shortenedTimestamp) + randomNumbers + counter

  return `${uniqueId}`
}
