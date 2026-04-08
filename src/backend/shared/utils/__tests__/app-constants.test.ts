import { CONSTANTS } from '../app-constants/types'

describe('CONSTANTS', () => {
  it('has theme variants', () => {
    expect(CONSTANTS.theme.variants.LIGHT).toBe('light')
    expect(CONSTANTS.theme.variants.DARK).toBe('dark')
  })

  it('has route paths', () => {
    expect(CONSTANTS.paths.MAIN).toBe('/')
    expect(CONSTANTS.paths.PROJECT).toBe('project')
    expect(CONSTANTS.paths.EDITOR).toBe('editor')
    expect(CONSTANTS.paths.RES).toBe('resource')
  })

  it('has POU types', () => {
    expect(CONSTANTS.types.PROGRAM).toBe('program')
    expect(CONSTANTS.types.FUNCTION).toBe('function')
    expect(CONSTANTS.types.FUNCTION_BLOCK).toBe('functionBlock')
  })

  it('has language labels', () => {
    expect(CONSTANTS.languages).toEqual({
      IL: 'IL',
      ST: 'ST',
      LD: 'LD',
      FBD: 'FBD',
      SFC: 'SFC',
    })
  })
})
