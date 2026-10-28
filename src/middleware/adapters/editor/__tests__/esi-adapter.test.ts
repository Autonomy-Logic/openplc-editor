/**
 * The desktop ESI adapter only moves calls over the bridge: the parser runs in
 * the main process and files live in the project folder. Behaviour is tested
 * in the shared `esi-repository-port.test.ts`.
 */

import { runEsiParseOp } from '@root/backend/shared/ethercat/esi-parse-ops'
import type { EsiStoredRecord } from '@root/middleware/shared/ports/esi-repository-mechanisms'

import { createEditorEsiAdapter } from '../esi-adapter'

type Bridge = typeof window.bridge

function installBridge(overrides: Partial<Bridge> = {}) {
  const rows: Array<EsiStoredRecord & { content: string }> = []
  const calls: string[] = []
  window.bridge = {
    esiParse: (request: Parameters<Bridge['esiParse']>[0]) => Promise.resolve(runEsiParseOp(request)),
    esiStoreList: (path: string) => {
      calls.push(`list ${path}`)
      return Promise.resolve({ ok: true, value: rows.map(({ content: _c, ...r }) => r) })
    },
    esiStoreUpload: (
      path: string,
      input: { filename: string; content: string; summary: EsiStoredRecord['summary'] },
    ) => {
      calls.push(`upload ${path}`)
      const row = {
        id: `id-${rows.length + 1}`,
        filename: input.filename,
        loadedAt: 'now',
        summary: input.summary,
        content: input.content,
      }
      rows.push(row)
      return Promise.resolve({ ok: true, value: { record: row, duplicate: false, retried: false } })
    },
    esiStoreSaveSummary: () => Promise.resolve({ ok: true, value: undefined }),
    esiStoreRemove: (path: string, id: string) => {
      calls.push(`remove ${path} ${id}`)
      return Promise.resolve({ ok: true, value: undefined })
    },
    esiStoreClear: (path: string) => {
      calls.push(`clear ${path}`)
      return Promise.resolve({ ok: true, value: undefined })
    },
    esiStoreReadXml: (_path: string, id: string) => {
      const row = rows.find((r) => r.id === id)
      return Promise.resolve(row ? { ok: true, value: row.content } : { ok: false, error: 'XML file not found' })
    },
    ...overrides,
  } as unknown as Bridge
  return { rows, calls }
}

const ESI = `<?xml version="1.0"?>
<EtherCATInfo><Vendor><Id>#x2</Id><Name>Beckhoff</Name></Vendor>
<Descriptions><Devices><Device><Type ProductCode="#x1" RevisionNo="#x1">EL1008</Type><Name>EL1008</Name></Device></Devices></Descriptions>
</EtherCATInfo>`

describe('createEditorEsiAdapter', () => {
  it('passes the project path to every store call and unwraps the answers', async () => {
    const { calls } = installBridge()
    const port = createEditorEsiAdapter(() => '/projects/demo')

    const upload = await port.parseAndSaveFile('el1008.xml', ESI)
    if (!upload.success || !upload.item) throw new Error(upload.success ? 'no item' : upload.error)
    const listed = await port.loadRepositoryLight()
    const device = await port.loadDeviceFull(upload.item.id, 0)
    await port.deleteRepositoryItem(upload.item.id)
    await port.clearRepository()

    expect(listed).toMatchObject({ success: true, items: [{ filename: 'el1008.xml', vendor: { name: 'Beckhoff' } }] })
    expect(device.success).toBe(true)
    expect(calls).toEqual([
      'upload /projects/demo',
      'list /projects/demo',
      `remove /projects/demo ${upload.item.id}`,
      'clear /projects/demo',
    ])
  })

  it('surfaces a store failure message from the main process', async () => {
    installBridge({ esiStoreList: () => Promise.resolve({ ok: false, error: 'permission denied' }) })

    expect(await createEditorEsiAdapter(() => '/p').loadRepositoryLight()).toEqual({
      success: false,
      error: 'permission denied',
    })
  })

  it('refuses to touch the store without an open project', async () => {
    installBridge()

    expect(await createEditorEsiAdapter(() => '').loadRepositoryLight()).toEqual({
      success: false,
      error: 'No project path available',
    })
  })

  it('reads XML and saves summaries through the bridge', async () => {
    const saved: string[] = []
    const { rows } = installBridge({
      esiStoreSaveSummary: (_p: string, id: string) => {
        saved.push(id)
        return Promise.resolve({ ok: true, value: undefined })
      },
    } as Partial<Bridge>)
    rows.push({ id: 'legacy', filename: 'el1008.xml', loadedAt: 'then', content: ESI })

    const listed = await createEditorEsiAdapter(() => '/p').loadRepositoryLight()

    expect(listed).toMatchObject({ success: true, items: [{ id: 'legacy' }] })
    expect(saved).toEqual(['legacy'])
  })
})
