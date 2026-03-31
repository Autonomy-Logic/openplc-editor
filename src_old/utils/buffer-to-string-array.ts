/**
 * A function that receive a Buffer type variable as argument and returns an Array containing the decoded Buffer as strings.
 * @param bufferToDecode - Buffer
 * @return string[]
 */
const BufferToStringArray = (bufferToDecode: Buffer) => {
  const text = new TextDecoder().decode(bufferToDecode)
  return text.split(/\r?\n/)
}

export { BufferToStringArray }
