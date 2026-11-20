/**
 * The generic description repository: current and stale rows, content duplicates,
 * the row the store kept, cache invalidation on delete, clear and scope change,
 * and every error text. Runs a fake summarizer over an in-memory row store.
 */

import { createHash } from 'node:crypto'

import type {
  DescriptionRowStore,
  DescriptionStoredRow,
} from '@root/middleware/shared/ports/device-description-repository'

import { createDescriptionRepository, errorMessage, toRepositoryItem } from '../description-repository'

interface TestSummary {
  title: string
  source: string
}

type TestRow = DescriptionStoredRow<TestSummary>

type Summarize = (xml: string, filename: string) => Promise<{ summary: TestSummary } | { error: string }>

const LABEL = 'TEST'
const SUMMARY_VERSION = 7
const XML_CACHE_MAX_CHARS = 64 * 1024 * 1024
const OLD_TIME = '2026-01-01T00:00:00.000Z'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A description document the fake summarizer accepts. */
const desc = (title: string): string => `<desc title="${title}"/>`

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** A summarizer that accepts only `desc(...)` documents and records each call. */
function fakeSummarizer() {
  const calls: Array<{ xml: string; filename: string }> = []
  const summarize: Summarize = (xml, filename) => {
    calls.push({ xml, filename })
    const match = /^<desc title="([^"]*)"\/>$/.exec(xml)
    if (match === null) return Promise.resolve({ error: `not a TEST description: ${filename}` })
    return Promise.resolve({ summary: { title: match[1], source: filename } })
  }
  return { summarize, calls }
}

/** A row stored by this summary version for `desc(title)`. */
function currentRow(id: string, title: string): TestRow {
  return {
    id,
    filename: `${id}.xml`,
    loadedAt: OLD_TIME,
    contentHash: sha256(desc(title)),
    summaryVersion: SUMMARY_VERSION,
    summary: { title, source: `${id}.xml` },
  }
}

/** A store that only keeps what it is given and records every call in `events`. */
function memoryStore(seed: Array<{ row: TestRow; xml?: string }> = []) {
  const rows: TestRow[] = seed.map(({ row }) => ({ ...row }))
  const xml = new Map<string, string>()
  for (const { row, xml: text } of seed) if (text !== undefined) xml.set(row.id, text)
  const events: string[] = []
  let lists = 0
  let reads = 0
  let scopeListener: (() => void) | null = null
  const store: DescriptionRowStore<TestSummary> = {
    list: () => {
      lists++
      events.push('list')
      return Promise.resolve(rows.map((r) => ({ ...r })))
    },
    insert: (row, text) => {
      events.push(`insert:${row.id}`)
      rows.push({ ...row })
      xml.set(row.id, text)
      return Promise.resolve({ ...row })
    },
    update: (row) => {
      events.push(`update:${row.id}`)
      rows.splice(
        rows.findIndex((r) => r.id === row.id),
        1,
        { ...row },
      )
      return Promise.resolve()
    },
    remove: (id) => {
      events.push(`remove:${id}`)
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      )
      xml.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      events.push('clear')
      rows.length = 0
      xml.clear()
      return Promise.resolve()
    },
    readXml: (id) => {
      reads++
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
  return {
    store,
    rows,
    xml,
    events,
    lists: () => lists,
    reads: () => reads,
    changeScope: () => scopeListener?.(),
  }
}

function repositoryOver(store: DescriptionRowStore<TestSummary>, summarize: Summarize = fakeSummarizer().summarize) {
  return createDescriptionRepository<TestSummary>({ store, summaryVersion: SUMMARY_VERSION, label: LABEL, summarize })
}

/** The first argument of every `console.error` call, as text. */
function loggedErrors(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]))
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('toRepositoryItem', () => {
  it('exposes the summary with the row identity and none of the row bookkeeping', () => {
    const row = { ...currentRow('a', 'Alpha'), summary: { title: 'Alpha', source: 'a.xml' } }

    expect(toRepositoryItem(row)).toEqual({
      title: 'Alpha',
      source: 'a.xml',
      id: 'a',
      filename: 'a.xml',
      loadedAt: OLD_TIME,
    })
  })

  it('lets the row identity win over a summary field of the same name', () => {
    const row = {
      id: 'row-id',
      filename: 'row.xml',
      loadedAt: OLD_TIME,
      summary: { id: 'summary-id', filename: 'summary.xml', loadedAt: 'never', title: 'T' },
    }

    expect(toRepositoryItem(row)).toEqual({ id: 'row-id', filename: 'row.xml', loadedAt: OLD_TIME, title: 'T' })
  })
})

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new Error('disk offline'), 'fallback')).toBe('disk offline')
  })

  it('falls back when the Error has no message', () => {
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback')
  })

  it('uses the text of a thrown non-Error value, and falls back when that text is empty', () => {
    expect(errorMessage('plain text', 'fallback')).toBe('plain text')
    expect(errorMessage('', 'fallback')).toBe('fallback')
  })
})

describe('description repository: loadItems', () => {
  it('lists current rows as stored, without re-reading their XML', async () => {
    const { store, events, reads } = memoryStore([
      { row: currentRow('a', 'Alpha'), xml: desc('Alpha') },
      { row: currentRow('b', 'Beta'), xml: desc('Beta') },
    ])
    const summarizer = fakeSummarizer()

    const listed = await repositoryOver(store, summarizer.summarize).loadItems()

    expect(listed).toEqual({
      success: true,
      items: [
        { title: 'Alpha', source: 'a.xml', id: 'a', filename: 'a.xml', loadedAt: OLD_TIME },
        { title: 'Beta', source: 'b.xml', id: 'b', filename: 'b.xml', loadedAt: OLD_TIME },
      ],
    })
    expect(summarizer.calls).toEqual([])
    expect(reads()).toBe(0)
    expect(events).toEqual(['list'])
  })

  it.each([
    {
      name: 'no summary',
      fields: { contentHash: sha256(desc('New')), summaryVersion: SUMMARY_VERSION, summary: undefined },
    },
    { name: 'no content hash', fields: { contentHash: undefined, summaryVersion: SUMMARY_VERSION } },
    {
      name: 'another summary version',
      fields: { contentHash: sha256(desc('New')), summaryVersion: SUMMARY_VERSION - 1 },
    },
    { name: 'no summary version', fields: { contentHash: sha256(desc('New')), summaryVersion: undefined } },
  ])('re-reads a row with $name from its XML and stores the refreshed row', async ({ fields }) => {
    const stale: TestRow = {
      id: 'old',
      filename: 'old.xml',
      loadedAt: OLD_TIME,
      summary: { title: 'Stale', source: 'old.xml' },
      ...fields,
    }
    const { store, rows } = memoryStore([{ row: stale, xml: desc('New') }])
    const summarizer = fakeSummarizer()

    const listed = await repositoryOver(store, summarizer.summarize).loadItems()

    expect(summarizer.calls).toEqual([{ xml: desc('New'), filename: 'old.xml' }])
    expect(rows).toEqual([
      {
        id: 'old',
        filename: 'old.xml',
        loadedAt: OLD_TIME,
        contentHash: sha256(desc('New')),
        summaryVersion: SUMMARY_VERSION,
        summary: { title: 'New', source: 'old.xml' },
      },
    ])
    expect(listed).toEqual({
      success: true,
      items: [{ title: 'New', source: 'old.xml', id: 'old', filename: 'old.xml', loadedAt: OLD_TIME }],
    })
  })

  it('re-reads a refreshed row only once, keeping the store order', async () => {
    const { store, events } = memoryStore([
      { row: { id: 'old', filename: 'old.xml', loadedAt: OLD_TIME }, xml: desc('Old') },
      { row: currentRow('a', 'Alpha'), xml: desc('Alpha') },
    ])
    const summarizer = fakeSummarizer()
    const repository = repositoryOver(store, summarizer.summarize)

    const first = await repository.loadItems()
    const second = await repository.loadItems()

    expect(first).toEqual(second)
    if (!second.success) throw new Error(second.error)
    expect(second.items.map((item) => item.id)).toEqual(['old', 'a'])
    expect(summarizer.calls).toHaveLength(1)
    expect(events.filter((event) => event.startsWith('update:'))).toEqual(['update:old'])
  })

  it('leaves out a stale row that no longer parses, logs it, and lists the rest', async () => {
    const { store, events } = memoryStore([
      { row: { id: 'broken', filename: 'broken.xml', loadedAt: OLD_TIME }, xml: '<other/>' },
      { row: currentRow('a', 'Alpha'), xml: desc('Alpha') },
    ])
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await repositoryOver(store).loadItems()

    expect(listed).toMatchObject({ success: true, items: [{ id: 'a' }] })
    if (!listed.success) throw new Error(listed.error)
    expect(listed.items).toHaveLength(1)
    expect(events).not.toContain('update:broken')
    expect(loggedErrors(errors)).toEqual([expect.stringContaining('TEST file broken.xml could not be re-read')])
  })

  it('leaves out a stale row whose XML cannot be read, and logs it', async () => {
    const { store } = memoryStore([{ row: { id: 'gone', filename: 'gone.xml', loadedAt: OLD_TIME } }])
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await repositoryOver(store).loadItems()

    expect(listed).toEqual({ success: true, items: [] })
    expect(loggedErrors(errors)).toEqual([expect.stringContaining('TEST file gone.xml could not be re-read')])
  })

  it('leaves out a stale row when the summarizer rejects, and logs it', async () => {
    const { store } = memoryStore([{ row: { id: 'old', filename: 'old.xml', loadedAt: OLD_TIME }, xml: desc('Old') }])
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await repositoryOver(store, () => Promise.reject(new Error('worker crashed'))).loadItems()

    expect(listed).toEqual({ success: true, items: [] })
    expect(loggedErrors(errors)).toEqual([expect.stringContaining('TEST file old.xml could not be re-read')])
  })

  it('lists a refreshed row even when the store rejects its update, and logs it', async () => {
    const { store } = memoryStore([{ row: { id: 'old', filename: 'old.xml', loadedAt: OLD_TIME }, xml: desc('Old') }])
    store.update = () => Promise.reject(new Error('read-only'))
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const listed = await repositoryOver(store).loadItems()

    expect(listed).toEqual({
      success: true,
      items: [{ title: 'Old', source: 'old.xml', id: 'old', filename: 'old.xml', loadedAt: OLD_TIME }],
    })
    expect(loggedErrors(errors)).toEqual([expect.stringContaining('TEST file old.xml not updated:')])
  })

  it('keeps the listed rows to find a duplicate without listing again', async () => {
    const { store, lists, rows } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)

    await repository.loadItems()
    const again = await repository.importFile('renamed.xml', desc('Alpha'))

    expect(again).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(1)
    expect(rows).toHaveLength(1)
  })

  it('leaves a row it could not re-read out of the duplicate check', async () => {
    const unreadable: TestRow = {
      id: 'gone',
      filename: 'gone.xml',
      loadedAt: OLD_TIME,
      contentHash: sha256(desc('Beta')),
      summaryVersion: SUMMARY_VERSION - 1,
      summary: { title: 'Beta', source: 'gone.xml' },
    }
    const { store, lists } = memoryStore([{ row: unreadable }])
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const repository = repositoryOver(store)

    await repository.loadItems()
    const imported = await repository.importFile('b.xml', desc('Beta'))

    expect(imported).toMatchObject({ success: true, item: { title: 'Beta', filename: 'b.xml' } })
    expect(lists()).toBe(1)
  })

  it('reports a failed listing with its message, or the TEST fallback', async () => {
    const { store } = memoryStore()
    store.list = () => Promise.reject(new Error('disk offline'))
    expect(await repositoryOver(store).loadItems()).toEqual({ success: false, error: 'disk offline' })

    store.list = () => Promise.reject(new Error(''))
    expect(await repositoryOver(store).loadItems()).toEqual({
      success: false,
      error: 'Failed to load TEST repository',
    })
  })
})

describe('description repository: importFile', () => {
  it('stores a new description as a current row and returns its item', async () => {
    const { store, rows, xml } = memoryStore()
    const before = Date.now()

    const result = await repositoryOver(store).importFile('a.xml', desc('Alpha'))

    const after = Date.now()
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toEqual({
      id: expect.stringMatching(UUID),
      filename: 'a.xml',
      loadedAt: expect.any(String),
      contentHash: sha256(desc('Alpha')),
      summaryVersion: SUMMARY_VERSION,
      summary: { title: 'Alpha', source: 'a.xml' },
    })
    expect(new Date(row.loadedAt).toISOString()).toBe(row.loadedAt)
    expect(Date.parse(row.loadedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(row.loadedAt)).toBeLessThanOrEqual(after)
    expect(xml.get(row.id)).toBe(desc('Alpha'))
    expect(result).toEqual({
      success: true,
      item: { title: 'Alpha', source: 'a.xml', id: row.id, filename: 'a.xml', loadedAt: row.loadedAt },
    })
  })

  it('gives each new row its own id', async () => {
    const { store, rows } = memoryStore()
    const repository = repositoryOver(store)

    await repository.importFile('a.xml', desc('Alpha'))
    await repository.importFile('b.xml', desc('Beta'))

    expect(rows).toHaveLength(2)
    expect(rows[0].id).not.toBe(rows[1].id)
  })

  it('returns a summarizer error as is, without touching the store', async () => {
    const { store, events } = memoryStore()

    const result = await repositoryOver(store).importFile('notes.xml', '<other/>')

    expect(result).toEqual({ success: false, error: 'not a TEST description: notes.xml' })
    expect(events).toEqual([])
  })

  it('summarizes before the duplicate check, so known content that no longer parses is an error', async () => {
    const { store, events } = memoryStore()
    const summarizer = fakeSummarizer()
    let refuse = false
    const repository = repositoryOver(store, (xml, filename) =>
      refuse ? Promise.resolve({ error: 'parser refuses' }) : summarizer.summarize(xml, filename),
    )
    await repository.importFile('a.xml', desc('Alpha'))
    refuse = true

    const result = await repository.importFile('a-again.xml', desc('Alpha'))

    expect(result).toEqual({ success: false, error: 'parser refuses' })
    expect(events).toEqual(['list', expect.stringMatching(/^insert:/)])
  })

  it('summarizes before the duplicate check of stored rows it has not listed yet', async () => {
    const { store, events } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const refusing: Summarize = () => Promise.resolve({ error: 'parser refuses' })

    const result = await repositoryOver(store, refusing).importFile('a-again.xml', desc('Alpha'))

    expect(result).toEqual({ success: false, error: 'parser refuses' })
    expect(events).toEqual([])
  })

  it('summarizes a duplicate before reporting it', async () => {
    const { store } = memoryStore()
    const summarizer = fakeSummarizer()
    const repository = repositoryOver(store, summarizer.summarize)
    await repository.importFile('a.xml', desc('Alpha'))

    const result = await repository.importFile('copy.xml', desc('Alpha'))

    expect(result).toEqual({ success: true, duplicate: true })
    expect(summarizer.calls).toEqual([
      { xml: desc('Alpha'), filename: 'a.xml' },
      { xml: desc('Alpha'), filename: 'copy.xml' },
    ])
  })

  it('turns a summarizer rejection into an error result with its message, or the TEST fallback', async () => {
    const { store, events } = memoryStore()

    expect(
      await repositoryOver(store, () => Promise.reject(new Error('worker crashed'))).importFile('a.xml', desc('A')),
    ).toEqual({ success: false, error: 'worker crashed' })
    expect(await repositoryOver(store, () => Promise.reject(new Error(''))).importFile('a.xml', desc('A'))).toEqual({
      success: false,
      error: 'Failed to parse TEST file',
    })
    expect(events).toEqual([])
  })

  it('treats identical content as a duplicate whatever the filename, without storing it again', async () => {
    const { store, rows } = memoryStore()
    const repository = repositoryOver(store)

    await repository.importFile('a.xml', desc('Alpha'))
    const again = await repository.importFile('renamed.xml', desc('Alpha'))

    expect(again).toEqual({ success: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('stores different content under the same filename as a new row', async () => {
    const { store, rows } = memoryStore()
    const repository = repositoryOver(store)

    await repository.importFile('same.xml', desc('Alpha'))
    const second = await repository.importFile('same.xml', desc('Beta'))

    expect(second).toMatchObject({ success: true, item: { title: 'Beta', filename: 'same.xml' } })
    expect(rows).toHaveLength(2)
  })

  it('finds a duplicate among stored rows it has not listed yet, listing them only once', async () => {
    const { store, lists, rows } = memoryStore([
      { row: currentRow('a', 'Alpha'), xml: desc('Alpha') },
      { row: currentRow('b', 'Beta'), xml: desc('Beta') },
    ])
    const repository = repositoryOver(store)

    expect(await repository.importFile('x.xml', desc('Alpha'))).toEqual({ success: true, duplicate: true })
    expect(await repository.importFile('y.xml', desc('Beta'))).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(1)
    expect(rows).toHaveLength(2)
  })

  it('uses the identity of the row the store kept, with its own hash and summary', async () => {
    const { store, lists } = memoryStore()
    const insert = store.insert
    store.insert = async (row, text) => {
      const kept = await insert(row, text)
      return {
        ...kept,
        id: 'assigned-by-store',
        loadedAt: '2030-05-05T05:05:05.000Z',
        contentHash: 'from-store',
        summaryVersion: 1,
        summary: undefined,
      }
    }
    const repository = repositoryOver(store)

    const result = await repository.importFile('a.xml', desc('Alpha'))
    const again = await repository.importFile('copy.xml', desc('Alpha'))

    expect(result).toEqual({
      success: true,
      item: {
        title: 'Alpha',
        source: 'a.xml',
        id: 'assigned-by-store',
        filename: 'a.xml',
        loadedAt: '2030-05-05T05:05:05.000Z',
      },
    })
    expect(again).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(1)
  })

  it('replaces the remembered row that has the id the store returned', async () => {
    const { store, lists } = memoryStore()
    const insert = store.insert
    store.insert = async (row, text) => ({ ...(await insert(row, text)), id: 'only-id' })
    const repository = repositoryOver(store)

    await repository.importFile('a.xml', desc('Alpha'))
    await repository.importFile('b.xml', desc('Beta'))
    const alphaAgain = await repository.importFile('a2.xml', desc('Alpha'))

    expect(alphaAgain).toMatchObject({ success: true, item: { id: 'only-id', filename: 'a2.xml' } })
    expect(lists()).toBe(1)
  })

  it('reports a failed insert with its message, or the TEST fallback', async () => {
    const { store, rows } = memoryStore()
    store.insert = () => Promise.reject(new Error('quota exceeded'))
    expect(await repositoryOver(store).importFile('a.xml', desc('Alpha'))).toEqual({
      success: false,
      error: 'quota exceeded',
    })

    store.insert = () => Promise.reject(new Error(''))
    expect(await repositoryOver(store).importFile('a.xml', desc('Alpha'))).toEqual({
      success: false,
      error: 'Failed to upload TEST file',
    })
    expect(rows).toHaveLength(0)
  })

  it('reports a failed listing for the duplicate check as an upload error', async () => {
    const { store } = memoryStore()
    store.list = () => Promise.reject(new Error(''))

    expect(await repositoryOver(store).importFile('a.xml', desc('Alpha'))).toEqual({
      success: false,
      error: 'Failed to upload TEST file',
    })
  })
})

describe('description repository: removeItem', () => {
  it('notifies every listener with the id before the store removes the item', async () => {
    const { store, events } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)
    repository.onInvalidate((itemId) => events.push(`first:${String(itemId)}`))
    repository.onInvalidate((itemId) => events.push(`second:${String(itemId)}`))

    const result = await repository.removeItem('a')

    expect(result).toEqual({ success: true })
    expect(events).toEqual(['first:a', 'second:a', 'remove:a'])
  })

  it('drops the cached XML of the removed item', async () => {
    const { store, reads } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)
    await repository.loadXml('a')
    await repository.loadXml('a')
    expect(reads()).toBe(1)

    await repository.removeItem('a')

    await expect(repository.loadXml('a')).rejects.toThrow('XML file not found')
    expect(reads()).toBe(2)
  })

  it('forgets the removed row, so its content imports again without listing', async () => {
    const { store, lists } = memoryStore()
    const repository = repositoryOver(store)
    const first = await repository.importFile('a.xml', desc('Alpha'))
    if (!first.success || !first.item) throw new Error('import failed')

    await repository.removeItem(first.item.id)
    const again = await repository.importFile('a.xml', desc('Alpha'))

    expect(again).toMatchObject({ success: true, item: { title: 'Alpha' } })
    expect(lists()).toBe(1)
  })

  it('invalidates even when the store cannot remove, keeps the row and reports the message', async () => {
    const { store, events, reads, lists } = memoryStore()
    const repository = repositoryOver(store)
    const first = await repository.importFile('a.xml', desc('Alpha'))
    if (!first.success || !first.item) throw new Error('import failed')
    const id = first.item.id
    await repository.loadXml(id)
    repository.onInvalidate((itemId) => events.push(`invalidate:${String(itemId)}`))
    store.remove = () => Promise.reject(new Error('locked'))

    const result = await repository.removeItem(id)

    expect(result).toEqual({ success: false, error: 'locked' })
    expect(events).toContain(`invalidate:${id}`)
    await repository.loadXml(id)
    expect(reads()).toBe(2)
    expect(await repository.importFile('copy.xml', desc('Alpha'))).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(1)
  })

  it('reports a failed remove without a message with the TEST fallback', async () => {
    const { store } = memoryStore()
    store.remove = () => Promise.reject(new Error(''))

    expect(await repositoryOver(store).removeItem('a')).toEqual({ success: false, error: 'Failed to delete TEST item' })
  })
})

describe('description repository: clear', () => {
  it('notifies listeners with null before the store clears', async () => {
    const { store, events } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)
    repository.onInvalidate((itemId) => events.push(`invalidate:${String(itemId)}`))

    const result = await repository.clear()

    expect(result).toEqual({ success: true })
    expect(events).toEqual(['invalidate:null', 'clear'])
  })

  it('drops the cached XML', async () => {
    const { store, reads } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)
    await repository.loadXml('a')
    store.clear = () => Promise.resolve()

    await repository.clear()
    await repository.loadXml('a')

    expect(reads()).toBe(2)
  })

  it('starts from no rows after a successful clear, without listing again', async () => {
    const { store, lists } = memoryStore()
    const repository = repositoryOver(store)
    await repository.importFile('a.xml', desc('Alpha'))

    await repository.clear()
    const again = await repository.importFile('a.xml', desc('Alpha'))

    expect(again).toMatchObject({ success: true, item: { title: 'Alpha' } })
    expect(lists()).toBe(1)
  })

  it('lists again after a failed clear, and reports the TEST fallback', async () => {
    const { store, lists, events } = memoryStore()
    const repository = repositoryOver(store)
    await repository.importFile('a.xml', desc('Alpha'))
    repository.onInvalidate((itemId) => events.push(`invalidate:${String(itemId)}`))
    store.clear = () => Promise.reject(new Error(''))

    const result = await repository.clear()

    expect(result).toEqual({ success: false, error: 'Failed to clear TEST repository' })
    expect(events).toContain('invalidate:null')
    expect(await repository.importFile('copy.xml', desc('Alpha'))).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(2)
  })

  it('reports a failed clear with its message', async () => {
    const { store } = memoryStore()
    store.clear = () => Promise.reject(new Error('read-only'))

    expect(await repositoryOver(store).clear()).toEqual({ success: false, error: 'read-only' })
  })
})

describe('description repository: loadXml', () => {
  it('reads the XML of an item from the store once and serves it from the cache after', async () => {
    const { store, reads } = memoryStore([{ row: currentRow('a', 'Alpha'), xml: desc('Alpha') }])
    const repository = repositoryOver(store)

    expect(await repository.loadXml('a')).toBe(desc('Alpha'))
    expect(await repository.loadXml('a')).toBe(desc('Alpha'))
    expect(reads()).toBe(1)
  })

  it('keeps XML up to 64 Mi characters in total', async () => {
    const { store, xml, reads } = memoryStore()
    xml.set('small', 'x')
    xml.set('large', 'y'.repeat(XML_CACHE_MAX_CHARS - 1))
    const repository = repositoryOver(store)

    await repository.loadXml('small')
    await repository.loadXml('large')
    await repository.loadXml('small')

    expect(reads()).toBe(2)
  })

  it('evicts the least recently used XML beyond 64 Mi characters in total', async () => {
    const { store, xml, reads } = memoryStore()
    xml.set('small', 'x')
    xml.set('large', 'y'.repeat(XML_CACHE_MAX_CHARS))
    const repository = repositoryOver(store)

    await repository.loadXml('small')
    await repository.loadXml('large')
    await repository.loadXml('large')
    expect(reads()).toBe(2)
    await repository.loadXml('small')

    expect(reads()).toBe(3)
  })

  it('passes a read failure on and reads again on the next load', async () => {
    const { store, xml, reads } = memoryStore()
    const repository = repositoryOver(store)

    await expect(repository.loadXml('later')).rejects.toThrow('XML file not found')
    xml.set('later', desc('Later'))

    expect(await repository.loadXml('later')).toBe(desc('Later'))
    expect(reads()).toBe(2)
  })
})

describe('description repository: store scope change', () => {
  it('drops the cached XML and the remembered rows, and notifies listeners with null', async () => {
    const { store, lists, reads, changeScope } = memoryStore()
    const repository = repositoryOver(store)
    const notified: Array<string | null> = []
    repository.onInvalidate((itemId) => notified.push(itemId))
    const first = await repository.importFile('a.xml', desc('Alpha'))
    if (!first.success || !first.item) throw new Error('import failed')
    await repository.loadXml(first.item.id)

    changeScope()

    expect(notified).toEqual([null])
    await repository.loadXml(first.item.id)
    expect(reads()).toBe(2)
    expect(await repository.importFile('copy.xml', desc('Alpha'))).toEqual({ success: true, duplicate: true })
    expect(lists()).toBe(2)
  })

  it('works over a store that has no scope', async () => {
    const { store } = memoryStore()
    const { onScopeChanged: _scope, ...withoutScope } = store

    expect(await repositoryOver(withoutScope).importFile('a.xml', desc('Alpha'))).toMatchObject({
      success: true,
      item: { title: 'Alpha' },
    })
  })
})
