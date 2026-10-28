/**
 * The shared ESI repository port, run on the real parser and an in-memory store.
 *
 * Every platform builds its EsiPort with `createEsiRepositoryPort`, so these
 * tests cover desktop and web alike. Regression for DOPE-755: the desktop
 * rebuilt repository rows field by field and dropped `modules`, which left Add
 * Module empty and every scanned module without an ESI.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  EsiParserMechanism,
  ESIRepositorySummary,
  EsiStoredRecord,
  EsiStoreMechanism,
} from '@root/middleware/shared/ports/esi-repository-mechanisms'
import { createEsiRepositoryPort } from '@root/middleware/shared/utils/ethercat/esi-repository'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

import { runEsiParseOp } from '../esi-parse-ops'
import { parseESILight } from '../esi-parser-main'

const read = (name: string): string =>
  decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'esi-real', name))))

const AXL_COUPLER = read('phoenix-axl-f-bk-ec.xml')
const AXL_MODULES = read('phoenix-axl-f-io-modules.xml')

const parser: EsiParserMechanism = { run: (request) => Promise.resolve(runEsiParseOp(request)) }

/** A store that only stores, the way every platform store must behave. */
function memoryStore(options: { retried?: boolean } = {}) {
  const rows: Array<EsiStoredRecord & { content: string }> = []
  const saved: string[] = []
  let nextId = 0
  const store: EsiStoreMechanism = {
    list: () => Promise.resolve(rows.map(({ content: _content, ...record }) => record)),
    upload: ({ filename, content, summary }) => {
      const match = rows.find((row) => row.content === content)
      if (match) return Promise.resolve({ record: match, duplicate: true, retried: options.retried ?? false })
      const row = { id: `id-${++nextId}`, filename, loadedAt: '2026-10-28T00:00:00.000Z', summary, content }
      rows.push(row)
      return Promise.resolve({ record: row, duplicate: false, retried: false })
    },
    saveSummary: (id, summary) => {
      saved.push(id)
      const row = rows.find((r) => r.id === id)
      if (row) row.summary = summary
      return Promise.resolve()
    },
    remove: (id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      )
      return Promise.resolve()
    },
    clear: () => {
      rows.length = 0
      return Promise.resolve()
    },
    readXml: (id) => {
      const row = rows.find((r) => r.id === id)
      return row ? Promise.resolve(row.content) : Promise.reject(new Error('XML file not found'))
    },
  }
  return { store, rows, saved }
}

describe('shared ESI repository port', () => {
  it('keeps the modules of a module ESI on the repository row', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })

    const result = await port.parseAndSaveFile('AXL_F_BK_EC_IO_Modules_321.xml', AXL_MODULES)

    if (!result.success || !result.item) throw new Error('upload failed')
    expect(result.item.modules?.length ?? 0).toBeGreaterThan(0)
  })

  it('stores every field the light parse returns, so a new parser field reaches every platform', async () => {
    const { store, rows } = memoryStore()
    const port = createEsiRepositoryPort({ parser, store })

    await port.parseAndSaveFile('AXL_F_BK_EC_321.xml', AXL_COUPLER)

    const { success: _success, error: _error, ...expected } = parseESILight(AXL_COUPLER, 'AXL_F_BK_EC_321.xml')
    expect(rows[0].summary).toEqual(expected as ESIRepositorySummary)
    const listed = await port.loadRepositoryLight()
    if (!listed.success) throw new Error(listed.error)
    expect(listed.items[0]).toEqual({
      ...expected,
      id: rows[0].id,
      filename: 'AXL_F_BK_EC_321.xml',
      loadedAt: rows[0].loadedAt,
    })
  })

  it('treats identical content as a duplicate whatever the filename', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })

    await port.parseAndSaveFile('a.xml', AXL_COUPLER)
    const again = await port.parseAndSaveFile('renamed.xml', AXL_COUPLER)

    expect(again).toEqual({ success: true, duplicate: true, dedupAfterRetry: false })
  })

  it('surfaces a duplicate found after a transport retry as a recovered add', async () => {
    const { store } = memoryStore({ retried: true })
    const port = createEsiRepositoryPort({ parser, store })

    await port.parseAndSaveFile('a.xml', AXL_COUPLER)
    const recovered = await port.parseAndSaveFile('a.xml', AXL_COUPLER)

    expect(recovered).toMatchObject({ success: true, dedupAfterRetry: true, item: { filename: 'a.xml' } })
  })

  it('re-parses rows an older Editor stored without a complete summary, and saves the result', async () => {
    const { store, rows, saved } = memoryStore()
    rows.push({
      id: 'legacy',
      filename: 'AXL_F_BK_EC_IO_Modules_321.xml',
      loadedAt: '2026-01-01T00:00:00.000Z',
      content: AXL_MODULES,
    })
    const port = createEsiRepositoryPort({ parser, store })

    const listed = await port.loadRepositoryLight()

    if (!listed.success) throw new Error(listed.error)
    expect(listed.needsMigration).toBe(false)
    expect(listed.items[0].modules?.length ?? 0).toBeGreaterThan(0)
    expect(saved).toEqual(['legacy'])
  })

  it('rejects a file that is not an ESI without storing anything', async () => {
    const { store, rows } = memoryStore()
    const port = createEsiRepositoryPort({ parser, store })

    const result = await port.parseAndSaveFile('notes.xml', '<NotAnEsi/>')

    expect(result.success).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('loads a module by ident, and names the ident it cannot find', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('modules.xml', AXL_MODULES)
    if (!upload.success || !upload.item?.modules?.length) throw new Error('upload failed')
    const ident = upload.item.modules[0].ident

    const found = await port.loadModuleFull(upload.item.id, ident)
    const missing = await port.loadModuleFull(upload.item.id, '0xDEADBEEF')

    expect(found).toMatchObject({ success: true, module: { ident } })
    expect(missing).toEqual({ success: false, error: 'Module ident 0xDEADBEEF not found' })
  })

  it('hands each caller its own copy of a cached device', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('coupler.xml', AXL_COUPLER)
    if (!upload.success || !upload.item) throw new Error('upload failed')

    const first = await port.loadDeviceFull(upload.item.id, 0)
    if (!first.success) throw new Error(first.error)
    first.device.name = 'changed by caller'
    const second = await port.loadDeviceFull(upload.item.id, 0)

    if (!second.success) throw new Error(second.error)
    expect(second.device.name).not.toBe('changed by caller')
  })
  it('reports store failures as results, never as throws', async () => {
    const fail = () => Promise.reject(new Error('disk is read-only'))
    const store: EsiStoreMechanism = {
      list: fail,
      upload: fail,
      saveSummary: fail,
      remove: fail,
      clear: fail,
      readXml: fail,
    }
    const port = createEsiRepositoryPort({ parser, store })

    expect(await port.loadRepositoryLight()).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.parseAndSaveFile('a.xml', AXL_COUPLER)).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.deleteRepositoryItem('x')).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.clearRepository()).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.loadDeviceFull('x', 0)).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.loadModuleFull('x', '0x1')).toEqual({ success: false, error: 'disk is read-only' })
  })

  it('reports a parser thread crash, a bad device index and an unparsable module file', async () => {
    const crashing: EsiParserMechanism = { run: () => Promise.reject(new Error('worker crashed')) }
    expect(
      await createEsiRepositoryPort({ parser: crashing, store: memoryStore().store }).parseAndSaveFile(
        'a.xml',
        AXL_COUPLER,
      ),
    ).toEqual({
      success: false,
      error: 'worker crashed',
    })

    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('coupler.xml', AXL_COUPLER)
    if (!upload.success || !upload.item) throw new Error('upload failed')
    expect((await port.loadDeviceFull(upload.item.id, 99)).success).toBe(false)

    const failingModules: EsiParserMechanism = {
      run: (request) => (request.op === 'modules' ? Promise.resolve({ success: false }) : parser.run(request)),
    } as EsiParserMechanism
    const modulesPort = createEsiRepositoryPort({ parser: failingModules, store: memoryStore().store })
    const up2 = await modulesPort.parseAndSaveFile('m.xml', AXL_MODULES)
    if (!up2.success || !up2.item) throw new Error('upload failed')
    expect(await modulesPort.loadModuleFull(up2.item.id, '0x1')).toEqual({
      success: false,
      error: 'Failed to parse module ESI',
    })
  })

  it('skips a legacy row whose XML no longer parses, and keeps the rest', async () => {
    const { store, rows } = memoryStore()
    rows.push({ id: 'broken', filename: 'broken.xml', loadedAt: '2026-01-01T00:00:00.000Z', content: '<NotAnEsi/>' })
    rows.push({ id: 'gone', filename: 'gone.xml', loadedAt: '2026-01-01T00:00:00.000Z', content: AXL_COUPLER })
    const readXml = store.readXml
    store.readXml = (id) => (id === 'gone' ? Promise.reject(new Error('XML file not found')) : readXml(id))
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await createEsiRepositoryPort({ parser, store }).loadRepositoryLight()

    expect(listed).toEqual({ success: true, items: [], needsMigration: false })
    errors.mockRestore()
  })

  it('reports an upload the store accepted without returning a row', async () => {
    const { store } = memoryStore()
    store.upload = () => Promise.resolve({ record: null, duplicate: false, retried: false })

    expect(await createEsiRepositoryPort({ parser, store }).parseAndSaveFile('a.xml', AXL_COUPLER)).toEqual({
      success: false,
      error: 'Upload succeeded but no item was returned',
    })
  })

  it('drops cached XML when the repository scope changes or an item is deleted', async () => {
    const { store } = memoryStore()
    let reads = 0
    const readXml = store.readXml
    store.readXml = (id) => {
      reads++
      return readXml(id)
    }
    let scopeChanged = () => {}
    store.onScopeChanged = (listener) => {
      scopeChanged = listener
      return () => {}
    }
    const port = createEsiRepositoryPort({ parser, store })
    const upload = await port.parseAndSaveFile('m.xml', AXL_MODULES)
    if (!upload.success || !upload.item) throw new Error('upload failed')
    const ident = upload.item.modules?.[0].ident ?? ''

    await port.loadModuleFull(upload.item.id, ident)
    await port.loadModuleFull(upload.item.id, ident)
    expect(reads).toBe(1)
    scopeChanged()
    await port.loadModuleFull(upload.item.id, ident)
    expect(reads).toBe(2)
    expect(await port.deleteRepositoryItem(upload.item.id)).toEqual({ success: true })
    expect(await port.clearRepository()).toEqual({ success: true })
  })

  it('migrateRepository loads the repository the same way', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    expect(await port.migrateRepository()).toEqual({ success: true, items: [], needsMigration: false })
  })
})
