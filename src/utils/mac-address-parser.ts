export function macToByteMac(mac: string): string | null {
  // Remove separators and keep only hex digits
  const clean = mac.replace(/[:\-,]/g, '').toUpperCase()

  // If it's a separatorless format with 12 digits
  if (/^[0-9A-F]{12}$/.test(clean)) {
    // Split into pairs and build the byte format
    return (
      clean
        .match(/.{2}/g)
        ?.map((b) => `0x${b}`)
        .join(',') || null
    )
  }

  // If it's a format with separators
  const match = mac.match(/^([0-9A-Fa-f]{2})([:\-,])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$/)
  if (match) {
    const parts = mac.split(match[2]).map((p) => p.toUpperCase())
    if (parts.length === 6 && parts.every((p) => /^[0-9A-F]{2}$/.test(p))) {
      return parts.map((b) => `0x${b}`).join(',')
    }
  }

  // Not a valid MAC
  return null
}

export function byteMacToMac(byteMac: string): string | null {
  // Regex to validate the byte MAC format
  const match = byteMac.match(/^(0x[0-9A-Fa-f]{2},){5}0x[0-9A-Fa-f]{2}$/)
  if (!match) return null

  // Remove '0x' and split the bytes
  const parts = byteMac.split(',').map((b) => b.trim().replace(/^0x/i, '').toUpperCase())
  if (parts.length !== 6 || parts.some((p) => p.length !== 2 || !/^[0-9A-F]{2}$/.test(p))) {
    return null
  }
  // Join in the traditional MAC format
  return parts.join(':')
}
