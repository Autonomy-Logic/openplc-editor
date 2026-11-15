import type { StlibSource, StlibSourcePort } from '../../../../middleware/shared/ports/stlib-source-port'
import { loadHmiPlcLibraries } from '../plc-libraries'

/** A stlib source over `files`, counting reads; a label missing from `files` fails to read. */
function source(listed: StlibSource[], files: Record<string, string>) {
  const reads: string[] = []
  const port: StlibSourcePort = {
    listStlibs: () => Promise.resolve(listed),
    readStlib: (label) => {
      reads.push(label)
      const text = files[label]
      return text === undefined ? Promise.reject(new Error(`no ${label}`)) : Promise.resolve(text)
    },
  }
  return { port, reads }
}

const lib = (name: string, version = '1.0.0'): StlibSource => ({ name, version, sourceLabel: `${name}.stlib` })

describe('HMI PLC libraries', () => {
  it('reads every listed library once, and again only when it changes', async () => {
    const listed = [lib('iec-standard-fb'), lib('oscat-basic')]
    const { port, reads } = source(listed, { 'iec-standard-fb.stlib': '{"a":1}', 'oscat-basic.stlib': '{"b":2}' })
    expect(await loadHmiPlcLibraries(port)).toEqual([
      { name: 'iec-standard-fb', archiveJson: '{"a":1}' },
      { name: 'oscat-basic', archiveJson: '{"b":2}' },
    ])
    await loadHmiPlcLibraries(port)
    expect(reads).toEqual(['iec-standard-fb.stlib', 'oscat-basic.stlib'])
    listed[1] = lib('oscat-basic', '1.1.0')
    await loadHmiPlcLibraries(port)
    expect(reads).toEqual(['iec-standard-fb.stlib', 'oscat-basic.stlib', 'oscat-basic.stlib'])
  })

  it('leaves out a library that cannot be read and tries it again next time', async () => {
    const files: Record<string, string> = { 'iec-standard-fb.stlib': '{}' }
    const { port, reads } = source([lib('iec-standard-fb'), lib('user')], files)
    expect((await loadHmiPlcLibraries(port)).map((l) => l.name)).toEqual(['iec-standard-fb'])
    files['user.stlib'] = '{"u":1}'
    expect((await loadHmiPlcLibraries(port)).map((l) => l.name)).toEqual(['iec-standard-fb', 'user'])
    expect(reads.filter((r) => r === 'user.stlib')).toHaveLength(2)
  })

  it('has no libraries without a stlib source', async () => {
    expect(await loadHmiPlcLibraries(undefined)).toEqual([])
  })
})
