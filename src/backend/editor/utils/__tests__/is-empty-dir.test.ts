import { promises } from 'fs'

import { isEmptyDir } from '../is-empty-dir'

jest.mock('fs', () => ({
  promises: {
    opendir: jest.fn(),
  },
}))

const mockedOpendir = promises.opendir as jest.MockedFunction<typeof promises.opendir>

describe('isEmptyDir', () => {
  afterEach(() => jest.resetAllMocks())

  it('returns true when directory is empty (entry is null)', async () => {
    const mockDir = {
      read: jest.fn().mockResolvedValue(null),
      close: jest.fn().mockResolvedValue(undefined),
    }
    mockedOpendir.mockResolvedValue(mockDir as never)

    expect(await isEmptyDir('/empty/dir')).toBe(true)
    expect(mockDir.read).toHaveBeenCalled()
    expect(mockDir.close).toHaveBeenCalled()
  })

  it('returns false when directory has entries', async () => {
    const mockDir = {
      read: jest.fn().mockResolvedValue({ name: 'file.txt' }),
      close: jest.fn().mockResolvedValue(undefined),
    }
    mockedOpendir.mockResolvedValue(mockDir as never)

    expect(await isEmptyDir('/non-empty/dir')).toBe(false)
  })

  it('returns false when opendir throws', async () => {
    mockedOpendir.mockRejectedValue(new Error('not a directory'))

    expect(await isEmptyDir('/not/a/dir')).toBe(false)
  })
})
