import { dialog } from 'electron'

import { getProjectPath } from '../path-picker'

jest.mock('electron', () => ({
  BrowserWindow: jest.fn(),
  dialog: {
    showOpenDialog: jest.fn(),
  },
}))

jest.mock('../is-empty-dir', () => ({
  isEmptyDir: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isEmptyDir } = require('../is-empty-dir') as { isEmptyDir: jest.MockedFunction<(path: string) => Promise<boolean>> }
const mockedShowOpenDialog = dialog.showOpenDialog as jest.MockedFunction<typeof dialog.showOpenDialog>

describe('getProjectPath', () => {
  afterEach(() => jest.resetAllMocks())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockWindow = {} as any

  it('returns canceled result when user cancels dialog', async () => {
    mockedShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await getProjectPath(mockWindow)
    expect(result).toEqual({
      success: false,
      error: {
        title: 'Operation canceled',
        description: 'Operation canceled by the user.',
      },
    })
  })

  it('returns error when directory is not empty', async () => {
    mockedShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/some/dir'] })
    isEmptyDir.mockResolvedValue(false)

    const result = await getProjectPath(mockWindow)
    expect(result).toEqual({
      success: false,
      error: {
        title: 'Directory is not empty',
        description: 'The selected directory is not empty. Please choose an empty directory for a new project.',
      },
    })
  })

  it('returns success with path when directory is empty', async () => {
    mockedShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/empty/dir'] })
    isEmptyDir.mockResolvedValue(true)

    const result = await getProjectPath(mockWindow)
    expect(result).toEqual({
      success: true,
      path: '/empty/dir',
    })
  })
})
