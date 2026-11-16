import { createHash } from 'node:crypto'

import type { GsdmlPort, GsdmlRepositoryItem } from '@root/middleware/shared/ports/gsdml-port'
import type {
  GsdmlParseRequest,
  GsdmlParserMechanism,
  GsdmlRowStore,
  GsdmlStoredRow,
} from '@root/middleware/shared/ports/gsdml-repository-mechanisms'

import { createGsdmlRepositoryPort, GSDML_SUMMARY_VERSION, parseGsdml, runGsdmlParseOp } from '../index'
import { expectCatalog, expectError, readGsdmlFixture } from './fixtures/gsdml-fixtures'

const MODULAR = readGsdmlFixture('modular-head.gsdml.xml')
const COMPACT = readGsdmlFixture('compact-head.gsdml.xml')
const LOGBOOK = readGsdmlFixture('logbook.gsdml.xml')
const BASE = readGsdmlFixture('structural-base.gsdml.xml')
const NEWER = readGsdmlFixture('newer-version.gsdml.xml')
const WRONG_ROOT = readGsdmlFixture('structural', 'wrong-root.gsdml.xml')
const XXE = readGsdmlFixture('attack', 'xxe-system.gsdml.xml')

const OLD_TIME = '2026-01-01T00:00:00.000Z'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** The summary the shared parser gives a text; throws when the parser rejects the text. */
function summaryOf(xml: string) {
  const response = runGsdmlParseOp({ op: 'summary', xml })
  if (response.op !== 'summary' || !response.result.success) throw new Error('Expected a GSDML summary')
  return response.result.summary
}

/** The real shared parser behind a thread boundary: answers with a structured clone and records every request. */
function threadParser() {
  const requests: GsdmlParseRequest[] = []
  const parser: GsdmlParserMechanism = {
    run: (request) => {
      requests.push(request)
      return Promise.resolve(structuredClone(runGsdmlParseOp(request)))
    },
  }
  const runs = (op: GsdmlParseRequest['op']): number => requests.filter((request) => request.op === op).length
  return { parser, requests, runs }
}

/** A parser that answers each request with the response of the other op. */
function swappedParser(): GsdmlParserMechanism {
  return {
    run: (request) =>
      Promise.resolve(
        runGsdmlParseOp(
          request.op === 'summary' ? { op: 'catalog', xml: request.xml } : { op: 'summary', xml: request.xml },
        ),
      ),
  }
}

/** A parser whose thread fails every request with `message`. */
function crashingParser(message: string): GsdmlParserMechanism {
  return { run: () => Promise.reject(new Error(message)) }
}

/**
 * A store that only keeps what it is given. With `keepXml`, removing or clearing rows leaves their XML
 * readable, so a later catalog load shows whether the port parsed again or served its cache.
 */
function memoryStore(options: { keepXml?: boolean } = {}) {
  const rows: GsdmlStoredRow[] = []
  const xml = new Map<string, string>()
  const updated: GsdmlStoredRow[] = []
  let scopeListener: (() => void) | null = null
  const dropRow = (id: string): void => {
    const index = rows.findIndex((row) => row.id === id)
    if (index !== -1) rows.splice(index, 1)
  }
  const store: GsdmlRowStore = {
    list: () => Promise.resolve(rows.map((row) => ({ ...row }))),
    insert: (row, text) => {
      rows.push({ ...row })
      xml.set(row.id, text)
      return Promise.resolve({ ...row })
    },
    update: (row) => {
      updated.push({ ...row })
      const index = rows.findIndex((r) => r.id === row.id)
      if (index !== -1) rows.splice(index, 1, { ...row })
      return Promise.resolve()
    },
    remove: (id) => {
      dropRow(id)
      if (!options.keepXml) xml.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      rows.length = 0
      if (!options.keepXml) xml.clear()
      return Promise.resolve()
    },
    readXml: (id) => {
      const text = xml.get(id)
      return text === undefined ? Promise.reject(new Error('XML file not found')) : Promise.resolve(text)
    },
    onScopeChanged: (listener) => {
      scopeListener = listener
      return () => {
        scopeListener = null
      }
    },
  }
  const seed = (row: GsdmlStoredRow, text?: string): void => {
    rows.push({ ...row })
    if (text !== undefined) xml.set(row.id, text)
  }
  return { store, rows, xml, updated, seed, changeScope: () => scopeListener?.() }
}

/** A store whose every operation fails with `message`. */
function failingStore(message: string): GsdmlRowStore {
  const fail = () => Promise.reject(new Error(message))
  return { list: fail, insert: fail, update: fail, remove: fail, clear: fail, readXml: fail }
}

/** A row stored by the current summary version, carrying the summary of `summarized`. */
function currentRow(id: string, summarized: string): GsdmlStoredRow {
  return {
    id,
    filename: `${id}.xml`,
    loadedAt: OLD_TIME,
    contentHash: sha256(summarized),
    summaryVersion: GSDML_SUMMARY_VERSION,
    summary: summaryOf(summarized),
  }
}

/** Imports a file that must be stored as a new item, and returns the item. */
async function importItem(port: GsdmlPort, filename: string, xml: string): Promise<GsdmlRepositoryItem> {
  const result = await port.importFile(filename, xml)
  if (!result.success) throw new Error(result.error)
  if (result.item === undefined) throw new Error(`${filename} was taken as a duplicate`)
  return result.item
}

/** Loads the catalog of an item that must load. */
async function loadedCatalog(port: GsdmlPort, itemId: string) {
  const result = await port.loadCatalog(itemId)
  if (!result.success) throw new Error(result.error)
  return result.catalog
}

/** The first argument of every call of a console spy, as text. */
function loggedFirstArgs(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]))
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('GSDML repository port: summary version', () => {
  it('starts the GSDML summary at version 1', () => {
    expect(GSDML_SUMMARY_VERSION).toBe(1)
  })
})

describe('GSDML repository port: importFile', () => {
  it('returns an item made of the parser summary and the stored row identity', async () => {
    const { store, rows } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    const result = await port.importFile('modular-head.xml', MODULAR)

    expect(result).toEqual({
      success: true,
      item: { ...summaryOf(MODULAR), id: rows[0].id, filename: 'modular-head.xml', loadedAt: rows[0].loadedAt },
    })
    expect(rows[0].id).toMatch(UUID)
  })

  it('carries the identity and the counts of the modular head device in the item', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: memoryStore().store })

    const item = await importItem(port, 'modular-head.xml', MODULAR)

    expect(item).toMatchObject({
      vendorId: '0xf0a',
      deviceId: '0xb1',
      vendorName: 'Example Devices',
      deviceInfoText: 'Example modular device',
      deviceAccessPointCount: 3,
      moduleCount: 7,
      noticeCount: 0,
    })
  })

  it('stores the row with its content hash and summary version, and the XML verbatim', async () => {
    const { store, rows, xml } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    const item = await importItem(port, 'modular-head.xml', MODULAR)

    expect(rows).toEqual([
      {
        id: item.id,
        filename: 'modular-head.xml',
        loadedAt: item.loadedAt,
        contentHash: sha256(MODULAR),
        summaryVersion: GSDML_SUMMARY_VERSION,
        summary: summaryOf(MODULAR),
      },
    ])
    expect(xml.get(item.id)).toBe(MODULAR)
  })

  it('sends the file to the parser as one summary request with the text verbatim', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore().store })

    await port.importFile('modular-head.xml', MODULAR)

    expect(thread.requests).toEqual([{ op: 'summary', xml: MODULAR }])
  })

  it('treats the same bytes under another name as a duplicate and stores nothing more', async () => {
    const { store, rows } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })
    await importItem(port, 'modular-head.xml', MODULAR)

    const again = await port.importFile('renamed.xml', MODULAR)

    expect(again).toEqual({ success: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('finds a duplicate among rows a fresh port has not listed yet', async () => {
    const { store, rows } = memoryStore()
    await importItem(createGsdmlRepositoryPort({ parser: threadParser().parser, store }), 'a.xml', MODULAR)
    const fresh = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    expect(await fresh.importFile('b.xml', MODULAR)).toEqual({ success: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('stores a file with other content as a new item', async () => {
    const { store, rows } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })
    await importItem(port, 'modular-head.xml', MODULAR)

    const other = await importItem(port, 'compact-head.xml', COMPACT)

    expect(other).toMatchObject({ ...summaryOf(COMPACT), filename: 'compact-head.xml' })
    expect(rows.map((row) => row.filename)).toEqual(['modular-head.xml', 'compact-head.xml'])
  })

  it('rejects a structurally invalid file with the parser reason and stores nothing', async () => {
    const { store, rows, xml } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    const result = await port.importFile('wrong-root.xml', WRONG_ROOT)

    expect(result).toEqual({ success: false, error: expectError(parseGsdml(WRONG_ROOT)) })
    expect(rows).toEqual([])
    expect(xml.size).toBe(0)
  })

  it('rejects a file declaring an external entity with the parser reason and stores nothing', async () => {
    const { store, rows, xml } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    const result = await port.importFile('xxe.xml', XXE)

    expect(result).toEqual({ success: false, error: expectError(parseGsdml(XXE)) })
    expect(rows).toEqual([])
    expect(xml.size).toBe(0)
  })

  it('rejects a parser response to another op as unexpected and stores nothing', async () => {
    const { store, rows } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: swappedParser(), store })

    const result = await port.importFile('modular-head.xml', MODULAR)

    expect(result).toEqual({ success: false, error: 'Unexpected GSDML parser response' })
    expect(rows).toEqual([])
  })

  it('reports a parser thread failure with its message', async () => {
    const port = createGsdmlRepositoryPort({ parser: crashingParser('worker crashed'), store: memoryStore().store })

    expect(await port.importFile('modular-head.xml', MODULAR)).toEqual({ success: false, error: 'worker crashed' })
  })

  it('reports a parser thread failure without a message as Failed to parse GSDML file', async () => {
    const port = createGsdmlRepositoryPort({ parser: crashingParser(''), store: memoryStore().store })

    expect(await port.importFile('modular-head.xml', MODULAR)).toEqual({
      success: false,
      error: 'Failed to parse GSDML file',
    })
  })
})

describe('GSDML repository port: loadRepository', () => {
  it('lists the imported items to a fresh port without running the parser', async () => {
    const { store } = memoryStore()
    const item = await importItem(
      createGsdmlRepositoryPort({ parser: threadParser().parser, store }),
      'modular-head.xml',
      MODULAR,
    )
    const thread = threadParser()

    const listed = await createGsdmlRepositoryPort({ parser: thread.parser, store }).loadRepository()

    expect(listed).toEqual({ success: true, items: [item] })
    expect(thread.requests).toEqual([])
  })

  it('lists a row of the current summary version as stored, without re-reading it', async () => {
    const { store, seed } = memoryStore()
    seed(currentRow('kept', COMPACT), MODULAR)
    const thread = threadParser()

    const listed = await createGsdmlRepositoryPort({ parser: thread.parser, store }).loadRepository()

    expect(listed).toEqual({
      success: true,
      items: [{ ...summaryOf(COMPACT), id: 'kept', filename: 'kept.xml', loadedAt: OLD_TIME }],
    })
    expect(thread.requests).toEqual([])
  })

  it('re-parses a row from an older summary version and a row without a summary, and lists the new summaries', async () => {
    const { store, seed } = memoryStore()
    seed({ ...currentRow('older', COMPACT), contentHash: 'stale', summaryVersion: GSDML_SUMMARY_VERSION - 1 }, MODULAR)
    seed({ id: 'legacy', filename: 'legacy.xml', loadedAt: OLD_TIME }, LOGBOOK)

    const listed = await createGsdmlRepositoryPort({ parser: threadParser().parser, store }).loadRepository()

    expect(listed).toEqual({
      success: true,
      items: [
        { ...summaryOf(MODULAR), id: 'older', filename: 'older.xml', loadedAt: OLD_TIME },
        { ...summaryOf(LOGBOOK), id: 'legacy', filename: 'legacy.xml', loadedAt: OLD_TIME },
      ],
    })
  })

  it('stores each re-parsed row with the current summary version and its content hash', async () => {
    const { store, seed, updated } = memoryStore()
    seed({ ...currentRow('older', COMPACT), contentHash: 'stale', summaryVersion: GSDML_SUMMARY_VERSION - 1 }, MODULAR)
    seed({ id: 'legacy', filename: 'legacy.xml', loadedAt: OLD_TIME }, LOGBOOK)

    await createGsdmlRepositoryPort({ parser: threadParser().parser, store }).loadRepository()

    expect(updated).toEqual([
      {
        id: 'older',
        filename: 'older.xml',
        loadedAt: OLD_TIME,
        contentHash: sha256(MODULAR),
        summaryVersion: GSDML_SUMMARY_VERSION,
        summary: summaryOf(MODULAR),
      },
      {
        id: 'legacy',
        filename: 'legacy.xml',
        loadedAt: OLD_TIME,
        contentHash: sha256(LOGBOOK),
        summaryVersion: GSDML_SUMMARY_VERSION,
        summary: summaryOf(LOGBOOK),
      },
    ])
  })

  it('re-parses an outdated row only once', async () => {
    const { store, seed } = memoryStore()
    seed({ ...currentRow('older', MODULAR), summaryVersion: GSDML_SUMMARY_VERSION - 1 }, MODULAR)
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store })

    await port.loadRepository()
    await port.loadRepository()
    await createGsdmlRepositoryPort({ parser: thread.parser, store }).loadRepository()

    expect(thread.runs('summary')).toBe(1)
  })
})

describe('GSDML repository port: loadCatalog', () => {
  it('returns the catalog the shared parser reads from the stored XML', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: memoryStore().store })
    const item = await importItem(port, 'modular-head.xml', MODULAR)

    expect(await port.loadCatalog(item.id)).toEqual({ success: true, catalog: expectCatalog(parseGsdml(MODULAR)) })
  })

  it('sends the stored XML to the parser as one catalog request, verbatim', async () => {
    const { store, seed } = memoryStore()
    seed(currentRow('stored', MODULAR), MODULAR)
    const thread = threadParser()

    await createGsdmlRepositoryPort({ parser: thread.parser, store }).loadCatalog('stored')

    expect(thread.requests).toEqual([{ op: 'catalog', xml: MODULAR }])
  })

  it('serves a second call for the same item from its cache, without running the parser again', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore().store })
    const item = await importItem(port, 'modular-head.xml', MODULAR)
    await loadedCatalog(port, item.id)

    const second = await port.loadCatalog(item.id)

    expect(second).toEqual({ success: true, catalog: expectCatalog(parseGsdml(MODULAR)) })
    expect(thread.runs('catalog')).toBe(1)
  })

  it('returns the cached catalog itself, not a copy', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: memoryStore().store })
    const item = await importItem(port, 'modular-head.xml', MODULAR)

    const first = await loadedCatalog(port, item.id)
    const second = await loadedCatalog(port, item.id)

    expect(second).toBe(first)
  })

  it('keeps the catalogs of the four most recently used items and parses an evicted one again', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore().store })
    const [a, b, c, d, e] = [
      await importItem(port, 'a.xml', MODULAR),
      await importItem(port, 'b.xml', COMPACT),
      await importItem(port, 'c.xml', LOGBOOK),
      await importItem(port, 'd.xml', BASE),
      await importItem(port, 'e.xml', NEWER),
    ]
    for (const item of [a, b, c, d, a, e]) await loadedCatalog(port, item.id)
    expect(thread.runs('catalog')).toBe(5)

    for (const item of [a, c, d, e]) await loadedCatalog(port, item.id)
    expect(thread.runs('catalog')).toBe(5)

    expect(await port.loadCatalog(b.id)).toEqual({ success: true, catalog: expectCatalog(parseGsdml(COMPACT)) })
    expect(thread.runs('catalog')).toBe(6)
  })

  it('returns the parse error of a stored file that no longer parses', async () => {
    const { store, seed } = memoryStore()
    seed(currentRow('broken', MODULAR), WRONG_ROOT)

    const result = await createGsdmlRepositoryPort({ parser: threadParser().parser, store }).loadCatalog('broken')

    expect(result).toEqual({ success: false, error: expectError(parseGsdml(WRONG_ROOT)) })
  })

  it('returns the read error of the store for an item it cannot read', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: memoryStore().store })

    expect(await port.loadCatalog('missing')).toEqual({ success: false, error: 'XML file not found' })
  })

  it('reports a read failure without a message as Failed to load GSDML catalog', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: failingStore('') })

    expect(await port.loadCatalog('any')).toEqual({ success: false, error: 'Failed to load GSDML catalog' })
  })

  it('rejects a parser response to another op as unexpected', async () => {
    const { store, seed } = memoryStore()
    seed(currentRow('stored', MODULAR), MODULAR)

    const result = await createGsdmlRepositoryPort({ parser: swappedParser(), store }).loadCatalog('stored')

    expect(result).toEqual({ success: false, error: 'Unexpected GSDML parser response' })
  })

  it('reports a parser thread failure with its message', async () => {
    const { store, seed } = memoryStore()
    seed(currentRow('stored', MODULAR), MODULAR)

    const result = await createGsdmlRepositoryPort({ parser: crashingParser('worker crashed'), store }).loadCatalog(
      'stored',
    )

    expect(result).toEqual({ success: false, error: 'worker crashed' })
  })
})

describe('GSDML repository port: catalog cache invalidation', () => {
  it('drops the catalog of a removed item: the next load runs the parser', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore({ keepXml: true }).store })
    const item = await importItem(port, 'modular-head.xml', MODULAR)
    await loadedCatalog(port, item.id)

    expect(await port.removeItem(item.id)).toEqual({ success: true })
    await loadedCatalog(port, item.id)

    expect(thread.runs('catalog')).toBe(2)
  })

  it('no longer serves the catalog of a removed item once the store dropped its XML', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: memoryStore().store })
    const item = await importItem(port, 'modular-head.xml', MODULAR)
    await loadedCatalog(port, item.id)

    await port.removeItem(item.id)

    expect(await port.loadCatalog(item.id)).toEqual({ success: false, error: 'XML file not found' })
  })

  it('keeps the cached catalogs of the other items when one item is removed', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore().store })
    const removed = await importItem(port, 'modular-head.xml', MODULAR)
    const kept = await importItem(port, 'compact-head.xml', COMPACT)
    await loadedCatalog(port, removed.id)
    await loadedCatalog(port, kept.id)

    await port.removeItem(removed.id)
    await loadedCatalog(port, kept.id)

    expect(thread.runs('catalog')).toBe(2)
  })

  it('drops every cached catalog on clear: the next loads run the parser', async () => {
    const thread = threadParser()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store: memoryStore({ keepXml: true }).store })
    const first = await importItem(port, 'modular-head.xml', MODULAR)
    const second = await importItem(port, 'compact-head.xml', COMPACT)
    await loadedCatalog(port, first.id)
    await loadedCatalog(port, second.id)

    expect(await port.clearRepository()).toEqual({ success: true })
    await loadedCatalog(port, first.id)
    await loadedCatalog(port, second.id)

    expect(thread.runs('catalog')).toBe(4)
  })

  it('drops every cached catalog on a scope change: the next loads run the parser', async () => {
    const thread = threadParser()
    const { store, changeScope } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: thread.parser, store })
    const first = await importItem(port, 'modular-head.xml', MODULAR)
    const second = await importItem(port, 'compact-head.xml', COMPACT)
    await loadedCatalog(port, first.id)
    await loadedCatalog(port, second.id)

    changeScope()
    await loadedCatalog(port, first.id)
    await loadedCatalog(port, second.id)

    expect(thread.runs('catalog')).toBe(4)
  })

  it('lists the rows of the new scope after a scope change', async () => {
    const { store, rows, changeScope } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })
    await importItem(port, 'modular-head.xml', MODULAR)
    await port.loadRepository()

    rows.length = 0
    changeScope()

    expect(await port.importFile('again.xml', MODULAR)).toMatchObject({
      success: true,
      item: { filename: 'again.xml' },
    })
  })
})

describe('GSDML repository port: store failures and error texts', () => {
  it('passes the message of a store failure through every operation', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: failingStore('disk is read-only') })
    const failure = { success: false, error: 'disk is read-only' }

    expect(await port.loadRepository()).toEqual(failure)
    expect(await port.importFile('modular-head.xml', MODULAR)).toEqual(failure)
    expect(await port.removeItem('any')).toEqual(failure)
    expect(await port.clearRepository()).toEqual(failure)
    expect(await port.loadCatalog('any')).toEqual(failure)
  })

  it('reports a list failure without a message as Failed to load GSDML repository', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: failingStore('') })

    expect(await port.loadRepository()).toEqual({ success: false, error: 'Failed to load GSDML repository' })
  })

  it('reports an insert failure without a message as Failed to upload GSDML file', async () => {
    const { store } = memoryStore()
    store.insert = () => Promise.reject(new Error(''))
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    expect(await port.importFile('modular-head.xml', MODULAR)).toEqual({
      success: false,
      error: 'Failed to upload GSDML file',
    })
  })

  it('reports a remove failure without a message as Failed to delete GSDML item', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: failingStore('') })

    expect(await port.removeItem('any')).toEqual({ success: false, error: 'Failed to delete GSDML item' })
  })

  it('reports a clear failure without a message as Failed to clear GSDML repository', async () => {
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store: failingStore('') })

    expect(await port.clearRepository()).toEqual({ success: false, error: 'Failed to clear GSDML repository' })
  })

  it('logs GSDML file <name> could not be re-read for an outdated row it cannot re-read, and leaves it out', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, seed } = memoryStore()
    seed({ id: 'broken', filename: 'broken.xml', loadedAt: OLD_TIME }, WRONG_ROOT)
    seed({ id: 'gone', filename: 'gone.xml', loadedAt: OLD_TIME })

    const listed = await createGsdmlRepositoryPort({ parser: threadParser().parser, store }).loadRepository()

    expect(listed).toEqual({ success: true, items: [] })
    expect(loggedFirstArgs(errors)).toEqual([
      `GSDML file broken.xml could not be re-read: ${expectError(parseGsdml(WRONG_ROOT))}`,
      'GSDML file gone.xml could not be re-read:',
    ])
  })

  it('logs GSDML file <name> not updated when the store cannot keep a re-parsed row, and still lists it', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, seed } = memoryStore()
    seed({ id: 'legacy', filename: 'legacy.xml', loadedAt: OLD_TIME }, MODULAR)
    store.update = () => Promise.reject(new Error('read-only'))

    const listed = await createGsdmlRepositoryPort({ parser: threadParser().parser, store }).loadRepository()

    expect(listed).toEqual({
      success: true,
      items: [{ ...summaryOf(MODULAR), id: 'legacy', filename: 'legacy.xml', loadedAt: OLD_TIME }],
    })
    expect(loggedFirstArgs(errors)).toEqual(['GSDML file legacy.xml not updated:'])
  })
})

describe('GSDML repository port: console', () => {
  it('writes nothing to the console outside the re-read logs', async () => {
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    ]
    const { store, changeScope } = memoryStore()
    const port = createGsdmlRepositoryPort({ parser: threadParser().parser, store })

    const item = await importItem(port, 'modular-head.xml', MODULAR)
    await port.importFile('renamed.xml', MODULAR)
    await port.importFile('wrong-root.xml', WRONG_ROOT)
    await port.importFile('xxe.xml', XXE)
    await port.loadRepository()
    await port.loadCatalog(item.id)
    await port.loadCatalog(item.id)
    await port.loadCatalog('missing')
    changeScope()
    await port.removeItem(item.id)
    await port.clearRepository()
    await createGsdmlRepositoryPort({ parser: swappedParser(), store }).importFile('compact-head.xml', COMPACT)

    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([])
  })
})
