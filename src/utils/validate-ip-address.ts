type ValidationResult = { valid: boolean; message?: string }

export function validateIpAddress(ipAddress: string): ValidationResult {
  if (!ipAddress || ipAddress.trim() === '') {
    return { valid: false, message: 'IP address is required' }
  }

  const trimmed = ipAddress.trim()

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4Regex.test(trimmed)) {
    const parts = trimmed.split('.')
    const allValid = parts.every((part) => {
      const num = parseInt(part, 10)
      return num >= 0 && num <= 255
    })
    if (allValid) {
      return { valid: true }
    }
  }

  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  if (hostnameRegex.test(trimmed)) {
    return { valid: true }
  }

  return { valid: false, message: 'Invalid IP address or hostname format' }
}
