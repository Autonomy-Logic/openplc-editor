const convertToPath = (text: string[]) => {
  let path = ''
  text.forEach((item) => {
    path += `/${item}`
  })
  return path
}

export default convertToPath
