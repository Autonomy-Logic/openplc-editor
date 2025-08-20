export const generatePouCopyUniqueName = (label: string, existingNames: string[]) => {
  const baseName = label.replace(/_copy(?:_\d+)?$/, '')
  let newName = `${baseName}_copy`

  if (existingNames.includes(newName)) {
    let counter = 2
    while (existingNames.includes(`${baseName}_copy_${counter}`)) {
      counter++
    }
    newName = `${baseName}_copy_${counter}`
  }

  return newName
}
