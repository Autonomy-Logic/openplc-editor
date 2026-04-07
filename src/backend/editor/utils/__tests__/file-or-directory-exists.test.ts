import { existsSync } from 'fs'

import { fileOrDirectoryExists } from '../file-or-directory-exists'

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}))

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>

describe('fileOrDirectoryExists', () => {
  afterEach(() => jest.resetAllMocks())

  it('returns true when the path exists', () => {
    mockedExistsSync.mockReturnValue(true)
    expect(fileOrDirectoryExists('/some/path')).toBe(true)
  })

  it('returns false when the path does not exist', () => {
    mockedExistsSync.mockReturnValue(false)
    expect(fileOrDirectoryExists('/missing/path')).toBe(false)
  })

  it('returns false when existsSync throws', () => {
    mockedExistsSync.mockImplementation(() => {
      throw new Error('permission denied')
    })
    expect(fileOrDirectoryExists('/bad/path')).toBe(false)
  })
})
