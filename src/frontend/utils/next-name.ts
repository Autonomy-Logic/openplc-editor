/**
 * Generate the next unique name by incrementing a trailing number.
 *
 * Given a base name like "Task0" and existing names ["Task0", "Task1"],
 * strips the trailing digits ("Task"), finds the highest existing number
 * with that prefix (1), and returns "Task2".
 *
 * Used by task, instance, and other list editors that create items by copy.
 */
export const getNextName = (baseName: string, existingNames: string[]): string => {
  const baseWithoutNumber = baseName.replace(/\d+$/, '')
  const numbers = existingNames
    .filter((n) => n.toLowerCase().startsWith(baseWithoutNumber.toLowerCase()))
    .map((n) => {
      const suffix = n.slice(baseWithoutNumber.length)
      return /^\d+$/.test(suffix) ? parseInt(suffix, 10) : -1
    })
    .filter((n) => n >= 0)
  const maxNumber = numbers.length === 0 ? -1 : Math.max(...numbers)
  return `${baseWithoutNumber}${maxNumber + 1}`
}
