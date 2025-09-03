type ValidationResult = { valid: true } | { valid: false; message: string }

export function validateInitialValue(value: string, type: string): ValidationResult {
  const normalizedType = type.toLowerCase()

  if (isBooleanType(normalizedType)) {
    return validateBoolean(value)
  }

  if (isSignedIntegerType(normalizedType)) {
    return validateSignedInteger(value)
  }

  if (isUnsignedIntegerType(normalizedType)) {
    return validateUnsignedInteger(value)
  }

  if (isFloatType(normalizedType)) {
    return validateFloat(value)
  }

  if (isStringType(normalizedType)) {
    return validateString(value)
  }

  if (isDateOrTimeType(normalizedType)) {
    return validateDateOrTime(value, normalizedType)
  }

  // Add specific rules for additional custom types below
  return { valid: true }
}

// --- Type checks ---

function isBooleanType(type: string) {
  return type === 'bool'
}

function isSignedIntegerType(type: string) {
  return ['sint', 'int', 'dint', 'lint'].includes(type)
}

function isUnsignedIntegerType(type: string) {
  return ['usint', 'uint', 'udint', 'ulint', 'byte', 'word', 'dword', 'lword'].includes(type)
}

function isFloatType(type: string) {
  return ['real', 'lreal'].includes(type)
}

function isStringType(type: string) {
  return type === 'string'
}

function isDateOrTimeType(type: string) {
  return ['time', 'date', 'tod', 'dt'].includes(type)
}

// --- Validators ---

function validateBoolean(value: string): ValidationResult {
  return /^(true|false|0|1)$/i.test(value)
    ? { valid: true }
    : { valid: false, message: "Value must be 'true', 'false', 0 or 1" }
}

function validateSignedInteger(value: string): ValidationResult {
  return /^-?\d+$/.test(value) ? { valid: true } : { valid: false, message: 'Value must be a signed integer number' }
}

function validateUnsignedInteger(value: string): ValidationResult {
  return /^\d+$/.test(value) ? { valid: true } : { valid: false, message: 'Value must be an unsigned integer number' }
}

function validateFloat(value: string): ValidationResult {
  return value !== '' && !isNaN(Number(value))
    ? { valid: true }
    : { valid: false, message: 'Value must be a valid floating point number' }
}

function validateString(value: string): ValidationResult {
  const maxLength = 255 // Ajuste conforme seu sistema

  if (value.length > maxLength) {
    return { valid: false, message: `String exceeds maximum length of ${maxLength}` }
  }

  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return { valid: false, message: 'String contains invalid control characters' }
  }

  // Pode adicionar outras regras, ex: charset ASCII puro, se quiser
  return { valid: true }
}

function validateDateOrTime(value: string, type: string): ValidationResult {
  if (!value.trim()) {
    return { valid: false, message: 'Value cannot be empty' }
  }

  switch (type) {
    case 'date': {
      // Exemplo: D#2024-08-20
      const regex = /^(D#)?\d{4}-\d{2}-\d{2}$/i
      return regex.test(value) ? { valid: true } : { valid: false, message: "DATE format should be 'D#YYYY-MM-DD'" }
    }
    case 'time': {
      // Exemplo: T#5s, T#100ms, T#1h2m3s
      const regex = /^(T#)?(\d+h)?(\d+m)?(\d+s)?(\d+ms)?$/i
      return regex.test(value)
        ? { valid: true }
        : { valid: false, message: "TIME format should be like 'T#5s', 'T#1h2m', etc." }
    }
    case 'tod': {
      // Exemplo: TOD#12:34:56 ou 12:34:56
      const regex = /^(TOD#)?([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/i
      return regex.test(value) ? { valid: true } : { valid: false, message: "TOD format should be 'TOD#HH:MM:SS'" }
    }
    case 'dt': {
      // Exemplo: DT#2024-08-20-12:34:56
      const regex = /^(DT#)?\d{4}-\d{2}-\d{2}-([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/i
      return regex.test(value)
        ? { valid: true }
        : { valid: false, message: "DT format should be 'DT#YYYY-MM-DD-HH:MM:SS'" }
    }
    default:
      return { valid: true }
  }
}
