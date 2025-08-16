const FormatMacAddress = (rawMacAddress: string) => {
  const macParts = rawMacAddress.split(':')
  const formattedMac = macParts.map((part) => `0x${part.toUpperCase()}`).join(', ')
  return formattedMac
}
export { FormatMacAddress }
