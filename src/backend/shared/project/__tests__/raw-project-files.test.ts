import { type RawProjectContent, rawLoadedFilesFromRaw, writeFilesFromRaw } from '../raw-project-files'

const raw: RawProjectContent = {
  projectPath: '/p',
  projectJson: '{}',
  deviceConfig: '{"c":1}',
  pinMapping: '[]',
  libraryManifest: '',
  pouFiles: [{ relativePath: 'pous/programs/Main.st', content: 'P' }],
  serverFiles: [{ relativePath: 'devices/servers/S.json', content: 'S' }],
  remoteDeviceFiles: [{ relativePath: 'devices/remote/R.json', content: 'R' }],
  dataTypeFiles: [{ relativePath: 'datatypes/T.dt', content: 'T' }],
  hmiFiles: [
    { relativePath: 'hmi/Main.st', content: 'H' },
    { relativePath: 'hmi/settings.json', content: '{}' },
  ],
}

describe('raw project files', () => {
  it('writes a project as read, every category included and nothing deleted', () => {
    expect(writeFilesFromRaw(raw)).toEqual({ ...raw, libraryManifest: undefined, deletions: [] })
    expect(writeFilesFromRaw({ ...raw, libraryManifest: '{"name":"l"}' }).libraryManifest).toBe('{"name":"l"}')
  })

  it('maps every file read to its bytes', () => {
    expect(rawLoadedFilesFromRaw(raw)).toEqual({
      'project.json': '{}',
      'devices/configuration.json': '{"c":1}',
      'devices/pin-mapping.json': '[]',
      'pous/programs/Main.st': 'P',
      'devices/servers/S.json': 'S',
      'devices/remote/R.json': 'R',
      'datatypes/T.dt': 'T',
      'hmi/Main.st': 'H',
      'hmi/settings.json': '{}',
    })
  })
})
