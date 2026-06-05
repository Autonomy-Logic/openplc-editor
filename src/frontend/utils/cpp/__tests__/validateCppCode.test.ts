import { validateCppCode } from '../validateCppCode'

describe('validateCppCode', () => {
  it('returns valid for code with both setup and loop', () => {
    const code = 'void setup() { } void loop() { }'
    const result = validateCppCode(code)
    expect(result).toEqual({ valid: true })
  })

  it('returns error when setup is missing', () => {
    const code = 'void loop() { }'
    const result = validateCppCode(code)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('C/C++ Function Block must declare a void setup() function')
  })

  it('returns error when loop is missing', () => {
    const code = 'void setup() { }'
    const result = validateCppCode(code)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('C/C++ Function Block must declare a void loop() function')
  })

  it('returns error when both setup and loop are missing', () => {
    const code = 'int main() { return 0; }'
    const result = validateCppCode(code)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('C/C++ Function Block must declare a void setup() function')
  })

  it('handles setup/loop with extra whitespace', () => {
    const code = 'void   setup  (  ) { } void   loop  (  ) { }'
    const result = validateCppCode(code)
    expect(result).toEqual({ valid: true })
  })

  it('returns error for empty string', () => {
    const result = validateCppCode('')
    expect(result.valid).toBe(false)
  })
})
