import { parseDebugFile, parseDebugVariables } from '../debug-parser'

describe('parseDebugVariables', () => {
  it('parses a standard debug_vars array with multiple entries', () => {
    const content = `
debug_vars[] = {
  {&(RES0__INSTANCE0.MOTOR_SPEED), INT_ENUM},
  {&(RES0__INSTANCE0.SENSOR_ON), BOOL_ENUM},
  {&(CONFIG0__GLOBAL_FLAG), DINT_ENUM}
};
`
    const result = parseDebugVariables(content)
    expect(result).toEqual([
      { name: 'RES0__INSTANCE0.MOTOR_SPEED', type: 'INT_ENUM', index: 0 },
      { name: 'RES0__INSTANCE0.SENSOR_ON', type: 'BOOL_ENUM', index: 1 },
      { name: 'CONFIG0__GLOBAL_FLAG', type: 'DINT_ENUM', index: 2 },
    ])
  })

  it('returns empty array when debug_vars array is not found', () => {
    const content = 'int main() { return 0; }'
    const result = parseDebugVariables(content)
    expect(result).toEqual([])
  })

  it('handles entries with extra whitespace', () => {
    const content = `
debug_vars[]  =  {
  {  &(  VAR1  )  ,  REAL_ENUM  }
};
`
    const result = parseDebugVariables(content)
    expect(result).toEqual([{ name: 'VAR1', type: 'REAL_ENUM', index: 0 }])
  })

  it('returns empty array for empty debug_vars', () => {
    const content = 'debug_vars[] = {};'
    const result = parseDebugVariables(content)
    expect(result).toEqual([])
  })

  it('parses single entry', () => {
    const content = `debug_vars[] = {
  {&(RES0__INSTANCE0.X), BOOL_ENUM}
};`
    const result = parseDebugVariables(content)
    expect(result).toEqual([{ name: 'RES0__INSTANCE0.X', type: 'BOOL_ENUM', index: 0 }])
  })
})

describe('parseDebugFile', () => {
  it('returns variables and totalCount from VAR_COUNT define', () => {
    const content = `
#define VAR_COUNT 5
debug_vars[] = {
  {&(RES0__INSTANCE0.A), INT_ENUM},
  {&(RES0__INSTANCE0.B), BOOL_ENUM}
};
`
    const result = parseDebugFile(content)
    expect(result.variables).toHaveLength(2)
    expect(result.totalCount).toBe(5)
  })

  it('falls back to variables.length when VAR_COUNT is not defined', () => {
    const content = `
debug_vars[] = {
  {&(RES0__INSTANCE0.A), INT_ENUM},
  {&(RES0__INSTANCE0.B), BOOL_ENUM},
  {&(RES0__INSTANCE0.C), REAL_ENUM}
};
`
    const result = parseDebugFile(content)
    expect(result.variables).toHaveLength(3)
    expect(result.totalCount).toBe(3)
  })

  it('returns zero variables and zero totalCount for empty content', () => {
    const result = parseDebugFile('')
    expect(result.variables).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('parses VAR_COUNT as integer from string', () => {
    const content = `
#define VAR_COUNT 42
debug_vars[] = {
  {&(X), INT_ENUM}
};
`
    const result = parseDebugFile(content)
    expect(result.totalCount).toBe(42)
  })
})
