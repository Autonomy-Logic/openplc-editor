import { toNumber } from 'lodash'

export const generateNumericUUID = () => {
  const timestamp = Date.now() // Get current timestamp
  const shortnedTimestamp = timestamp.toString().slice(7, 13) // Shorten the timestamp
  const randomNumbers = Math.floor(Math.random() * 10000000) // Generate a random number
  return `${toNumber(shortnedTimestamp) + randomNumbers}`
}
