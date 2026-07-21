/**
 * `getPlcopenImportFilePath` / `getPlcopenExportSavePath` — focused tests.
 *
 * Electron's `dialog` is mocked (no real native dialog in Jest); the
 * filesystem is real (per-test temp dir) so read/write failure paths
 * are exercised against actual I/O rather than stubbed error shapes.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const showOpenDialogMock = jest.fn()
const showSaveDialogMock = jest.fn()

jest.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialogMock(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialogMock(...args),
  },
}))

import { getPlcopenExportSavePath, getPlcopenImportFilePath } from '../path-picker'

describe('getPlcopenImportFilePath', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plcopen-import-'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads and returns the selected file content', async () => {
    const filePath = join(dir, 'program.xml')
    writeFileSync(filePath, '<project/>')
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [filePath] })

    const result = await getPlcopenImportFilePath({} as never)

    expect(showOpenDialogMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        title: 'Select a PLCopen XML file to import',
        properties: ['openFile'],
        filters: [{ name: 'PLCopen XML', extensions: ['xml'] }],
      }),
    )
    expect(result).toEqual({ success: true, content: '<project/>' })
  })

  it('returns a canceled error when the user dismisses the dialog', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await getPlcopenImportFilePath({} as never)

    expect(result).toEqual({
      success: false,
      error: { title: 'Operation canceled', description: 'Operation canceled by the user.' },
    })
  })

  it('returns a read error when the selected file cannot be read', async () => {
    const missingPath = join(dir, 'missing.xml')
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [missingPath] })

    const result = await getPlcopenImportFilePath({} as never)

    expect(result).toEqual({
      success: false,
      error: { title: 'Error reading file', description: 'Failed to read the selected PLCopen XML file.' },
    })
  })
})

describe('getPlcopenExportSavePath', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plcopen-export-'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the XML content to the chosen path', async () => {
    const filePath = join(dir, 'exported.xml')
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath })

    const result = await getPlcopenExportSavePath({} as never, 'exported.xml', '<project/>')

    expect(showSaveDialogMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        title: 'Export PLCopen XML',
        defaultPath: 'exported.xml',
        filters: [{ name: 'PLCopen XML', extensions: ['xml'] }],
      }),
    )
    expect(result).toEqual({ success: true })
    expect(readFileSync(filePath, 'utf-8')).toBe('<project/>')
  })

  it('returns a canceled error when the user dismisses the dialog', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await getPlcopenExportSavePath({} as never, 'exported.xml', '<project/>')

    expect(result).toEqual({
      success: false,
      error: { title: 'Operation canceled', description: 'Operation canceled by the user.' },
    })
  })

  it('returns a write error when the target path cannot be written', async () => {
    const badPath = join(dir, 'nonexistent-subdir', 'exported.xml')
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: badPath })

    const result = await getPlcopenExportSavePath({} as never, 'exported.xml', '<project/>')

    expect(result).toEqual({
      success: false,
      error: { title: 'Error writing file', description: 'Failed to write the PLCopen XML file.' },
    })
  })
})
