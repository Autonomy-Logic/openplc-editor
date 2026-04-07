import { writeFile } from 'fs'

import { CreateXMLFile } from '../xml-manager'

jest.mock('fs', () => ({
  writeFile: jest.fn(),
}))

const mockedWriteFile = writeFile as unknown as jest.MockedFunction<
  (path: string, data: string, cb: (err: NodeJS.ErrnoException | null) => void) => void
>

describe('CreateXMLFile', () => {
  afterEach(() => jest.resetAllMocks())

  it('creates an XML file and returns success', () => {
    mockedWriteFile.mockImplementation((_path, _data, cb) => {
      cb(null)
    })

    const result = CreateXMLFile('/some/path', '<xml/>', 'myfile')
    expect(result).toEqual({ success: true, message: 'Xml file created successfully' })
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('myfile.xml'),
      '<xml/>',
      expect.any(Function),
    )
  })

  it('handles writeFile error in callback', () => {
    mockedWriteFile.mockImplementation((_path, _data, cb) => {
      cb(new Error('write error') as NodeJS.ErrnoException)
    })

    // The function returns synchronously before the callback fires
    const result = CreateXMLFile('/some/path', '<xml/>', 'myfile')
    expect(result).toEqual({ success: true, message: 'Xml file created successfully' })
  })
})
