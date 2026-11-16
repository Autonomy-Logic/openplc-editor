/**
 * The desktop ESI adapter only moves calls over the bridge: the parser runs in
 * the main process and files are read and written in the project folder.
 */

import { runEsiParseOp } from '@root/backend/shared/ethercat/esi-parse-ops'

import { createEditorEsiAdapter } from '../esi-adapter'

type Bridge = typeof window.bridge

const ESI = `<?xml version="1.0"?>
<EtherCATInfo><Vendor><Id>#x2</Id><Name>Beckhoff</Name></Vendor>
<Descriptions><Devices><Device><Type ProductCode="#x1" RevisionNo="#x1">EL1008</Type><Name>EL1008</Name></Device></Devices></Descriptions>
</EtherCATInfo>`

function installBridge(overrides: Partial<Bridge> = {}) {
  const files = new Map<string, string>()
  const calls: string[] = []
  window.bridge = {
    esiParse: (request: Parameters<Bridge['esiParse']>[0]) => Promise.resolve(runEsiParseOp(request)),
    esiFileRead: (path: string, name: string) => {
      calls.push(`read ${path} ${name}`)
      return Promise.resolve({ ok: true, value: files.get(name) ?? null })
    },
    esiFileWrite: (path: string, name: string, text: string) => {
      calls.push(`write ${path} ${name}`)
      files.set(name, text)
      return Promise.resolve({ ok: true, value: undefined })
    },
    esiFileRemove: (path: string, name: string) => {
      calls.push(`remove ${path} ${name}`)
      files.delete(name)
      return Promise.resolve({ ok: true, value: undefined })
    },
    esiFileList: (path: string) => {
      calls.push(`list ${path}`)
      return Promise.resolve({ ok: true, value: [...files.keys()] })
    },
    ...overrides,
  } as unknown as Bridge
  return { files, calls }
}

describe('createEditorEsiAdapter', () => {
  it('keeps the repository in the project folder through the bridge', async () => {
    const { files, calls } = installBridge()
    const port = createEditorEsiAdapter(() => '/projects/demo')

    const upload = await port.parseAndSaveFile('el1008.xml', ESI)
    if (!upload.success || !upload.item) throw new Error(upload.success ? 'no item' : upload.error)

    expect(files.get(`${upload.item.id}.xml`)).toBe(ESI)
    expect(await port.loadRepositoryLight()).toMatchObject({ success: true, items: [{ filename: 'el1008.xml' }] })
    expect((await port.loadDeviceFull(upload.item.id, 0)).success).toBe(true)
    expect(await port.clearRepository()).toEqual({ success: true })
    expect(calls.every((c) => c.includes('/projects/demo'))).toBe(true)
  })

  it('surfaces a file failure message from the main process', async () => {
    installBridge({ esiFileRead: () => Promise.resolve({ ok: false, error: 'permission denied' }) })

    expect(await createEditorEsiAdapter(() => '/p').loadRepositoryLight()).toEqual({
      success: false,
      error: 'permission denied',
    })
  })

  it('refuses to touch the folder without an open project', async () => {
    installBridge()

    expect(await createEditorEsiAdapter(() => '').loadRepositoryLight()).toEqual({
      success: false,
      error: 'No project path available',
    })
  })

  it('drops cached data when the project changes', async () => {
    installBridge()
    let switchProject = () => {}
    const port = createEditorEsiAdapter(
      () => '/p',
      (listener) => {
        switchProject = listener
        return () => {}
      },
    )
    const upload = await port.parseAndSaveFile('el1008.xml', ESI)
    if (!upload.success || !upload.item) throw new Error('upload failed')
    let reads = 0
    const read = window.bridge.esiFileRead
    window.bridge.esiFileRead = (path, name) => {
      if (name.endsWith('.xml')) reads++
      return read(path, name)
    }

    await port.loadDeviceFull(upload.item.id, 0)
    await port.loadDeviceFull(upload.item.id, 0)
    switchProject()
    await port.loadDeviceFull(upload.item.id, 0)

    expect(reads).toBe(2)
  })
})
