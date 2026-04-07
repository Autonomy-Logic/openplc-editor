import { writeFile } from 'fs'

import { CreateJSONFile } from '../json-manager'

jest.mock('fs', () => ({
  writeFile: jest.fn(),
}))

const mockedWriteFile = writeFile as unknown as jest.MockedFunction<
  (path: string, data: string | NodeJS.ArrayBufferView, cb: (err: NodeJS.ErrnoException | null) => void) => void
>

describe('CreateJSONFile', () => {
  afterEach(() => jest.resetAllMocks())

  it('creates a JSON file and returns ok: true', () => {
    mockedWriteFile.mockImplementation((_path, _data, cb) => {
      cb(null)
    })

    const result = CreateJSONFile('/some/path', '{"key":"value"}', 'myfile')
    expect(result).toEqual({ ok: true })
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('myfile.json'),
      '{"key":"value"}',
      expect.any(Function),
    )
  })

  it('throws when writeFile returns an error', () => {
    mockedWriteFile.mockImplementation((_path, _data, cb) => {
      cb(new Error('write error') as NodeJS.ErrnoException)
    })

    // The callback re-throws the error, so calling CreateJSONFile should throw
    expect(() => CreateJSONFile('/some/path', '{}', 'myfile')).toThrow('write error')
  })
})
