type ValidationResult = {
  valid: boolean
  error?: string
}

const validateCppCode = (code: string): ValidationResult => {
  const setupRegex = /void\s+setup\s*\(\s*\)/
  const hasSetup = setupRegex.test(code)

  if (!hasSetup) {
    return {
      valid: false,
      error: 'C/C++ Function Block must declare a void setup() function',
    }
  }

  const loopRegex = /void\s+loop\s*\(\s*\)/
  const hasLoop = loopRegex.test(code)

  if (!hasLoop) {
    return {
      valid: false,
      error: 'C/C++ Function Block must declare a void loop() function',
    }
  }

  return { valid: true }
}

export { validateCppCode, type ValidationResult }
