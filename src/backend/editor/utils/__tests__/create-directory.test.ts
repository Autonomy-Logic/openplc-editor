import { mkdirSync } from 'fs'

import { createDirectory } from '../create-directory'

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
}))

const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>

describe('createDirectory', () => {
  afterEach(() => jest.resetAllMocks())

  it('returns true when directory is created successfully', () => {
    mockedMkdirSync.mockReturnValue(undefined)
    expect(createDirectory('/new/dir')).toBe(true)
    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
  })

  it('returns false when mkdirSync throws', () => {
    mockedMkdirSync.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(createDirectory('/bad/dir')).toBe(false)
  })
})
