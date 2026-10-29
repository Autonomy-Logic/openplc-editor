/**
 * Repository rows keep every field the light parse returns, including `modules`;
 * duplicates are found by content; rows from another parser version are re-parsed.
 * Runs the real parser on real vendor ESIs over an in-memory row store.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  EsiParserMechanism,
  EsiRowStore,
  EsiStoredRow,
} from '@root/middleware/shared/ports/esi-repository-mechanisms'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

import { hashText } from '../../project/project-snapshot-archive'
import { runEsiParseOp } from '../esi-parse-ops'
import { parseESILight } from '../esi-parser-main'
import { createEsiRepositoryPort, ESI_SUMMARY_VERSION } from '../esi-repository-port'

const read = (name: string): string =>
  decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'esi-real', name))))

const AXL_COUPLER = read('phoenix-axl-f-bk-ec.xml')
const AXL_MODULES = read('phoenix-axl-f-io-modules.xml')

const parser: EsiParserMechanism = { run: (request) => Promise.resolve(runEsiParseOp(request)) }

/** A store that only keeps what it is given. */
function memoryStore() {
  const rows: EsiStoredRow[] = []
  const xml = new Map<string, string>()
  const updated: string[] = []
  let lists = 0
  const store: EsiRowStore = {
    list: () => {
      lists++
      return Promise.resolve(rows.map((r) => ({ ...r })))
    },
    insert: (row, text) => {
      rows.push(row)
      xml.set(row.id, text)
      return Promise.resolve(row)
    },
    update: (row) => {
      updated.push(row.id)
      rows.splice(
        rows.findIndex((r) => r.id === row.id),
        1,
        row,
      )
      return Promise.resolve()
    },
    remove: (id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      )
      xml.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      rows.length = 0
      xml.clear()
      return Promise.resolve()
    },
    readXml: (id) => {
      const text = xml.get(id)
      return text === undefined ? Promise.reject(new Error('XML file not found')) : Promise.resolve(text)
    },
  }
  return { store, rows, xml, updated, lists: () => lists }
}

describe('shared ESI repository port', () => {
  it('keeps the modules of a module ESI on the repository row', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })

    const result = await port.parseAndSaveFile('AXL_F_BK_EC_IO_Modules_321.xml', AXL_MODULES)

    if (!result.success || !result.item) throw new Error('upload failed')
    expect(result.item.modules?.length ?? 0).toBeGreaterThan(0)
  })

  it('stores every field the light parse returns, with the content hash and summary version', async () => {
    const { store, rows } = memoryStore()
    const port = createEsiRepositoryPort({ parser, store })

    await port.parseAndSaveFile('AXL_F_BK_EC_321.xml', AXL_COUPLER)

    const { success: _success, error: _error, ...expected } = parseESILight(AXL_COUPLER, 'AXL_F_BK_EC_321.xml')
    expect(rows[0]).toMatchObject({
      filename: 'AXL_F_BK_EC_321.xml',
      contentHash: await hashText(AXL_COUPLER),
      summaryVersion: ESI_SUMMARY_VERSION,
      summary: expected,
    })
    const listed = await port.loadRepositoryLight()
    if (!listed.success) throw new Error(listed.error)
    expect(listed.items[0]).toEqual({
      ...expected,
      id: rows[0].id,
      filename: 'AXL_F_BK_EC_321.xml',
      loadedAt: rows[0].loadedAt,
    })
  })

  it('treats identical content as a duplicate whatever the filename, without storing it again', async () => {
    const { store, rows } = memoryStore()
    const port = createEsiRepositoryPort({ parser, store })

    await port.parseAndSaveFile('a.xml', AXL_COUPLER)
    const again = await port.parseAndSaveFile('renamed.xml', AXL_COUPLER)

    expect(again).toEqual({ success: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('finds a duplicate among rows it has not listed yet', async () => {
    const { store, rows } = memoryStore()
    await createEsiRepositoryPort({ parser, store }).parseAndSaveFile('a.xml', AXL_COUPLER)

    const fresh = createEsiRepositoryPort({ parser, store })

    expect(await fresh.parseAndSaveFile('b.xml', AXL_COUPLER)).toEqual({ success: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('uses the row the store kept, whose id the store may have assigned', async () => {
    const { store } = memoryStore()
    const insert = store.insert
    store.insert = (row, text) => insert({ ...row, id: 'assigned-by-store' }, text)
    const port = createEsiRepositoryPort({ parser, store })

    const result = await port.parseAndSaveFile('a.xml', AXL_COUPLER)

    expect(result).toMatchObject({ success: true, item: { id: 'assigned-by-store', filename: 'a.xml' } })
  })

  it('re-parses rows without a summary or from another parser version, and stores the result', async () => {
    const { store, rows, xml, updated } = memoryStore()
    rows.push({ id: 'legacy', filename: 'm.xml', loadedAt: '2026-01-01T00:00:00.000Z' })
    rows.push({
      id: 'older',
      filename: 'c.xml',
      loadedAt: '2026-01-01T00:00:00.000Z',
      contentHash: 'x',
      summaryVersion: ESI_SUMMARY_VERSION - 1,
      summary: { vendor: { id: '0x84', name: 'Phoenix' }, devices: [] },
    })
    xml.set('legacy', AXL_MODULES)
    xml.set('older', AXL_COUPLER)
    const port = createEsiRepositoryPort({ parser, store })

    const listed = await port.loadRepositoryLight()

    if (!listed.success) throw new Error(listed.error)
    expect(listed.needsMigration).toBe(false)
    expect(listed.items[0].modules?.length ?? 0).toBeGreaterThan(0)
    expect(listed.items[1].devices.length).toBeGreaterThan(0)
    expect(updated).toEqual(['legacy', 'older'])
    expect(rows[0]).toMatchObject({ contentHash: await hashText(AXL_MODULES), summaryVersion: ESI_SUMMARY_VERSION })
    // Up to date now: listing again re-parses nothing.
    await port.loadRepositoryLight()
    expect(updated).toHaveLength(2)
  })

  it('shows a re-parsed row even when the store cannot keep the update', async () => {
    const { store, rows, xml } = memoryStore()
    rows.push({ id: 'legacy', filename: 'c.xml', loadedAt: '2026-01-01T00:00:00.000Z' })
    xml.set('legacy', AXL_COUPLER)
    store.update = () => Promise.reject(new Error('read-only'))
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await createEsiRepositoryPort({ parser, store }).loadRepositoryLight()

    expect(listed).toMatchObject({ success: true, items: [{ id: 'legacy' }] })
    errors.mockRestore()
  })

  it('skips a row whose XML is missing or no longer parses, and keeps the rest', async () => {
    const { store, rows, xml } = memoryStore()
    rows.push({ id: 'broken', filename: 'broken.xml', loadedAt: '2026-01-01T00:00:00.000Z' })
    rows.push({ id: 'gone', filename: 'gone.xml', loadedAt: '2026-01-01T00:00:00.000Z' })
    xml.set('broken', '<NotAnEsi/>')
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await createEsiRepositoryPort({ parser, store }).loadRepositoryLight()

    expect(listed).toEqual({ success: true, items: [], needsMigration: false })
    errors.mockRestore()
  })

  it('rejects a file that is not an ESI without storing anything', async () => {
    const { store, rows } = memoryStore()

    const result = await createEsiRepositoryPort({ parser, store }).parseAndSaveFile('notes.xml', '<NotAnEsi/>')

    expect(result.success).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('loads a module by ident, and names the ident it cannot find', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('modules.xml', AXL_MODULES)
    if (!upload.success || !upload.item?.modules?.length) throw new Error('upload failed')
    const ident = upload.item.modules[0].ident

    expect(await port.loadModuleFull(upload.item.id, ident)).toMatchObject({ success: true, module: { ident } })
    expect(await port.loadModuleFull(upload.item.id, '0xDEADBEEF')).toEqual({
      success: false,
      error: 'Module ident 0xDEADBEEF not found',
    })
  })

  it('hands each caller its own copy of a cached device, and reports a bad device index', async () => {
    const port = createEsiRepositoryPort({ parser, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('coupler.xml', AXL_COUPLER)
    if (!upload.success || !upload.item) throw new Error('upload failed')

    const first = await port.loadDeviceFull(upload.item.id, 0)
    if (!first.success) throw new Error(first.error)
    first.device.name = 'changed by caller'
    const second = await port.loadDeviceFull(upload.item.id, 0)

    if (!second.success) throw new Error(second.error)
    expect(second.device.name).not.toBe('changed by caller')
    expect((await port.loadDeviceFull(upload.item.id, 99)).success).toBe(false)
  })

  it('reports store failures as results, never as throws', async () => {
    const fail = () => Promise.reject(new Error('disk is read-only'))
    const store: EsiRowStore = { list: fail, insert: fail, update: fail, remove: fail, clear: fail, readXml: fail }
    const port = createEsiRepositoryPort({ parser, store })

    expect(await port.loadRepositoryLight()).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.migrateRepository()).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.parseAndSaveFile('a.xml', AXL_COUPLER)).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.deleteRepositoryItem('x')).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.clearRepository()).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.loadDeviceFull('x', 0)).toEqual({ success: false, error: 'disk is read-only' })
    expect(await port.loadModuleFull('x', '0x1')).toEqual({ success: false, error: 'disk is read-only' })
  })

  it('reports a parser thread crash and an unparsable module file', async () => {
    const crashing: EsiParserMechanism = { run: () => Promise.reject(new Error('worker crashed')) }
    expect(
      await createEsiRepositoryPort({ parser: crashing, store: memoryStore().store }).parseAndSaveFile(
        'a.xml',
        AXL_COUPLER,
      ),
    ).toEqual({ success: false, error: 'worker crashed' })

    const failingModules = {
      run: (request: Parameters<EsiParserMechanism['run']>[0]) =>
        request.op === 'modules' ? Promise.resolve({ success: false }) : parser.run(request),
    } as EsiParserMechanism
    const port = createEsiRepositoryPort({ parser: failingModules, store: memoryStore().store })
    const upload = await port.parseAndSaveFile('m.xml', AXL_MODULES)
    if (!upload.success || !upload.item) throw new Error('upload failed')
    expect(await port.loadModuleFull(upload.item.id, '0x1')).toEqual({
      success: false,
      error: 'Failed to parse module ESI',
    })
  })

  it('drops its caches and listed rows when the scope changes, and after delete and clear', async () => {
    const { store, lists } = memoryStore()
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
    const listsBefore = lists()
    expect(await port.parseAndSaveFile('again.xml', AXL_MODULES)).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(listsBefore + 1)

    expect(await port.deleteRepositoryItem(upload.item.id)).toEqual({ success: true })
    expect(await port.parseAndSaveFile('after-delete.xml', AXL_MODULES)).toMatchObject({ success: true, item: {} })
    expect(await port.clearRepository()).toEqual({ success: true })
    expect(await port.parseAndSaveFile('after-clear.xml', AXL_MODULES)).toMatchObject({ success: true, item: {} })
  })
})
