export const generatePouCopyUniqueName = (label: string, existingNames: string[]) => {
  const baseName = label.replace(/ copy(?: \d+)?$/, '')
  let newName = `${baseName} copy`

  if (existingNames.includes(newName)) {
    let counter = 2
    while (existingNames.includes(`${baseName} copy ${counter}`)) {
      counter++
    }
    newName = `${baseName} copy ${counter}`
  }

  return newName
}
