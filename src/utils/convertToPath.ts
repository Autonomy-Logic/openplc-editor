/**
 * Converts an array of strings into a forward-slash-separated path.
 *
 * @param {string[]} text - The array of strings to convert to a path.
 * @returns {string} The forward-slash-separated path.
 */
const convertToPath = (text: string[]) => {
  /**
   * Initializes an empty string to store the path.
   *
   * @type {string}
   */
  let path = ''
  /**
   * Iterates through each item in the input array and concatenates it with a forward slash.
   *
   * @param {string} item - The current item in the array.
   */
  text.forEach((item) => {
    path += `/${item}`
  })
  /**
   * Returns the final concatenated path.
   *
   * @type {string}
   */
  return path
}

export default convertToPath
