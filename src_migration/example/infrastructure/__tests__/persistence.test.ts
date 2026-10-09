// Infrastructure tests: the adapters satisfy the persistence port and reject malformed stored data.
import type { VariableDocument } from '../../domain'
import { createInMemoryPersistence, createLocalStoragePersistence, type KeyValueStorage } from '..'

const KEY = 'test/variables'
const DOCUMENT: VariableDocument = { variables: [{ id: 1, name: 'Start', type: 'BOOL' }], nextId: 2 }

function createMapStorage(initial?: string): KeyValueStorage & { readonly raw: () => string | null } {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(KEY, initial)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    raw: () => values.get(KEY) ?? null,
  }
}

describe('local storage persistence', () => {
  it('reports no document when the key is absent', async () => {
    const persistence = createLocalStoragePersistence(createMapStorage(), KEY)
    expect(await persistence.load()).toEqual({ ok: true, document: null })
  })

  it('round-trips a document with a format version', async () => {
    const storage = createMapStorage()
    const persistence = createLocalStoragePersistence(storage, KEY)
    expect(await persistence.save(DOCUMENT)).toEqual({ ok: true })
    expect(JSON.parse(storage.raw() ?? '')).toEqual({ version: 1, ...DOCUMENT })
    expect(await persistence.load()).toEqual({ ok: true, document: DOCUMENT })
  })

  it('drops unknown stored fields', async () => {
    const stored = JSON.stringify({
      version: 1,
      nextId: 2,
      variables: [{ id: 1, name: 'Start', type: 'BOOL', extra: true }],
    })
    const persistence = createLocalStoragePersistence(createMapStorage(stored), KEY)
    expect(await persistence.load()).toEqual({ ok: true, document: DOCUMENT })
  })

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[]'],
    ['an unknown version', JSON.stringify({ version: 2, nextId: 1, variables: [] })],
    ['a fractional nextId', JSON.stringify({ version: 1, nextId: 1.5, variables: [] })],
    ['variables that are not a list', JSON.stringify({ version: 1, nextId: 1, variables: {} })],
    [
      'an unknown variable type',
      JSON.stringify({ version: 1, nextId: 2, variables: [{ id: 1, name: 'X', type: 'STRING' }] }),
    ],
    ['a variable without a name', JSON.stringify({ version: 1, nextId: 2, variables: [{ id: 1, type: 'INT' }] })],
  ])('reports %s as a load failure', async (_label, stored) => {
    const persistence = createLocalStoragePersistence(createMapStorage(stored), KEY)
    expect(await persistence.load()).toEqual({ ok: false })
  })

  it('reports storage errors instead of throwing', async () => {
    const failing: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const persistence = createLocalStoragePersistence(failing, KEY)
    expect(await persistence.load()).toEqual({ ok: false })
    expect(await persistence.save(DOCUMENT)).toEqual({ ok: false })
  })

  it('works against the Web Storage API', async () => {
    window.localStorage.removeItem(KEY)
    const persistence = createLocalStoragePersistence(window.localStorage, KEY)
    await persistence.save(DOCUMENT)
    expect(await persistence.load()).toEqual({ ok: true, document: DOCUMENT })
    window.localStorage.removeItem(KEY)
  })
})

describe('in-memory persistence', () => {
  it('keeps the last saved document', async () => {
    const persistence = createInMemoryPersistence()
    expect(await persistence.load()).toEqual({ ok: true, document: null })
    await persistence.save(DOCUMENT)
    expect(persistence.stored()).toBe(DOCUMENT)
    expect(await persistence.load()).toEqual({ ok: true, document: DOCUMENT })
  })
})
