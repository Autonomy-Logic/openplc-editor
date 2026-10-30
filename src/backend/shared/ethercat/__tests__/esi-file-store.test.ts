/**
 * ESI rows kept as `repository.json` plus one XML per row, over an in-memory folder.
 */

import type { EsiFileStore, EsiStoredRow } from '@root/middleware/shared/ports/esi-repository-mechanisms'

import { createFileEsiRowStore, ESI_INDEX_FILE, readEsiIndex } from '../esi-file-store'

const ID = '5279f43b-65a4-479c-90f1-4c04acd45c57'
const ID2 = '22c22c2e-f363-4e26-93b7-2354201be81d'

const ROW: EsiStoredRow = {
  id: ID,
  filename: 'axl.xml',
  loadedAt: '2026-10-28T00:00:00.000Z',
  contentHash: 'abc',
  summaryVersion: 2,
  summary: { vendor: { id: '0x84', name: 'Phoenix' }, devices: [], modules: [{ ident: '0x1', name: 'DI' }] },
}

function memoryFolder(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const log: string[] = []
  const folder: EsiFileStore = {
    read: (name) => Promise.resolve(files.get(name) ?? null),
    write: (name, text) => {
      log.push(`write ${name}`)
      files.set(name, text)
      return Promise.resolve()
    },
    remove: (name) => {
      log.push(`remove ${name}`)
      files.delete(name)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...files.keys()]),
  }
  return { folder, files, log }
}

const index = (files: Map<string, string>) => JSON.parse(files.get(ESI_INDEX_FILE) ?? 'null') as unknown

describe('file-backed ESI row store', () => {
  it('keeps rows and XML exactly as given, under a version 3 index', async () => {
    const { folder, files } = memoryFolder()
    const store = createFileEsiRowStore(folder)

    expect(await store.list()).toEqual([])
    expect(await store.insert(ROW, '<xml/>')).toBe(ROW)

    expect(index(files)).toEqual({ version: 3, items: [ROW] })
    expect(files.get(`${ID}.xml`)).toBe('<xml/>')
    expect(await store.list()).toEqual([ROW])
    expect(await store.readXml(ID)).toBe('<xml/>')
  })

  it('reads a version 1 or 2 index as rows without a summary', async () => {
    const legacy = { version: 2, items: [{ id: ID, filename: 'm.xml', vendorId: '0x84', loadedAt: 0, devices: [] }] }
    const { folder } = memoryFolder({ [ESI_INDEX_FILE]: JSON.stringify(legacy) })

    expect(await createFileEsiRowStore(folder).list()).toEqual([
      { id: ID, filename: 'm.xml', loadedAt: '1970-01-01T00:00:00.000Z' },
    ])
  })

  it('dates a legacy row with an unreadable timestamp now, not at the epoch', () => {
    const read = readEsiIndex(JSON.stringify({ version: 1, items: [{ id: ID, filename: 'm.xml' }] }))

    if (!('rows' in read)) throw new Error('expected rows')
    expect(Date.parse(read.rows[0].loadedAt)).toBeGreaterThan(Date.parse('2026-01-01'))
  })

  it.each([
    ['not JSON', '{'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['items that are not a list', JSON.stringify({ version: 3, items: {} })],
    ['a row without an id', JSON.stringify({ version: 3, items: [{ filename: 'a.xml', loadedAt: 'x' }] })],
    ['a row whose id is a path', JSON.stringify({ version: 3, items: [{ ...ROW, id: '../x' }] })],
    ['a summary without devices', JSON.stringify({ version: 3, items: [{ ...ROW, summary: { vendor: {} } }] })],
    ['a legacy row without a filename', JSON.stringify({ version: 2, items: [{ id: ID, loadedAt: 1 }] })],
  ])('keeps an index with %s as a backup and starts empty', async (_case, text) => {
    const { folder, files } = memoryFolder({ [ESI_INDEX_FILE]: text })

    const store = createFileEsiRowStore(folder)
    expect(await store.list()).toEqual([])
    expect(await store.list()).toEqual([])

    const backups = [...files.keys()].filter((name) => name.startsWith(`${ESI_INDEX_FILE}.corrupt-`))
    expect(backups).toHaveLength(1)
    expect(files.get(backups[0])).toBe(text)
    expect(index(files)).toEqual({ version: 3, items: [] })
  })

  it('refuses an index from a newer Editor instead of rewriting it', async () => {
    const newer = JSON.stringify({ version: 4, items: [] })
    const { folder, files } = memoryFolder({ [ESI_INDEX_FILE]: newer })
    const store = createFileEsiRowStore(folder)

    await expect(store.list()).rejects.toThrow('saved by a newer OpenPLC Editor')
    await expect(store.insert(ROW, '<xml/>')).rejects.toThrow('saved by a newer OpenPLC Editor')
    expect(files.get(ESI_INDEX_FILE)).toBe(newer)
  })

  it('replaces a row on update', async () => {
    const { folder } = memoryFolder()
    const store = createFileEsiRowStore(folder)
    await store.insert(ROW, '<xml/>')
    await store.insert({ ...ROW, id: ID2 }, '<two/>')

    await store.update({ ...ROW, filename: 'renamed.xml' })

    expect((await store.list()).map((r) => r.filename)).toEqual(['renamed.xml', 'axl.xml'])
  })

  it('writes the index before deleting XML on remove and clear', async () => {
    const { folder, files, log } = memoryFolder()
    const store = createFileEsiRowStore(folder)
    await store.insert(ROW, '<xml/>')
    await store.insert({ ...ROW, id: ID2 }, '<two/>')

    log.length = 0
    await store.remove(ID)
    expect(log).toEqual([`write ${ESI_INDEX_FILE}`, `remove ${ID}.xml`])

    log.length = 0
    await store.clear()
    expect(log).toEqual([`write ${ESI_INDEX_FILE}`, `remove ${ID2}.xml`])
    expect(index(files)).toEqual({ version: 3, items: [] })
  })

  it('leaves no XML behind when the index cannot be written on insert', async () => {
    const { folder, files } = memoryFolder()
    const write = folder.write
    folder.write = (name, text) =>
      name === ESI_INDEX_FILE ? Promise.reject(new Error('disk full')) : write(name, text)
    const store = createFileEsiRowStore(folder)

    await expect(store.insert(ROW, '<xml/>')).rejects.toThrow('disk full')
    expect(files.has(`${ID}.xml`)).toBe(false)
    // A failed call does not block the next one.
    folder.write = write
    await expect(store.insert(ROW, '<xml/>')).resolves.toBe(ROW)
  })

  it('refuses ids that are not UUIDs, and reports a missing XML', async () => {
    const store = createFileEsiRowStore(memoryFolder().folder)

    await expect(store.readXml('../../etc/passwd')).rejects.toThrow('Invalid item ID')
    await expect(store.insert({ ...ROW, id: 'x/y' }, '<xml/>')).rejects.toThrow('Invalid item ID')
    await expect(store.readXml(ID)).rejects.toThrow('XML file not found')
  })

  it('passes the folder scope changes through', () => {
    const { folder } = memoryFolder()
    let subscribed = false
    folder.onScopeChanged = () => {
      subscribed = true
      return () => {}
    }

    createFileEsiRowStore(folder).onScopeChanged?.(() => {})

    expect(subscribed).toBe(true)
    expect(createFileEsiRowStore(memoryFolder().folder).onScopeChanged).toBeUndefined()
  })

  it('reports XML it could not delete on clear, after emptying the index', async () => {
    const { folder, files } = memoryFolder()
    const store = createFileEsiRowStore(folder)
    await store.insert(ROW, '<xml/>')
    await store.insert({ ...ROW, id: ID2 }, '<two/>')
    const remove = folder.remove
    folder.remove = (name) => (name === `${ID}.xml` ? Promise.reject(new Error('locked')) : remove(name))

    await expect(store.clear()).rejects.toThrow('Could not delete 1 ESI file(s)')
    expect(index(files)).toEqual({ version: 3, items: [] })
    expect(files.has(`${ID2}.xml`)).toBe(false)

    folder.remove = remove
    await expect(store.clear()).resolves.toBeUndefined()
    expect(files.has(`${ID}.xml`)).toBe(false)
  })
})
