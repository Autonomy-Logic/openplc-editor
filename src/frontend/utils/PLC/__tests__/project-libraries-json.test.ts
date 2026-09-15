import { sortProjectLibraryRefs, withProjectLibraries } from '../project-libraries-json'

// The library manager rewrites one field of a file every other part of the
// editor also writes. Anything this drops is data loss, so the assertions are
// mostly about what it leaves alone.

describe('sortProjectLibraryRefs', () => {
  it('sorts by name and keeps only name and version', () => {
    expect(
      sortProjectLibraryRefs([
        { name: 'zeta', version: '1.0.0', extra: true } as never,
        { name: 'alpha', version: '0.1.0' },
      ]),
    ).toEqual([
      { name: 'alpha', version: '0.1.0' },
      { name: 'zeta', version: '1.0.0' },
    ])
  })

  it('does not mutate its input', () => {
    const refs = [
      { name: 'b', version: '1' },
      { name: 'a', version: '2' },
    ]
    sortProjectLibraryRefs(refs)
    expect(refs.map((r) => r.name)).toEqual(['b', 'a'])
  })
})

describe('withProjectLibraries', () => {
  it('replaces data.libraries and leaves every other key alone', () => {
    const json = JSON.stringify(
      {
        meta: { name: 'demo', schemaVersion: 3 },
        data: { pous: [{ name: 'main' }], libraries: [{ name: 'old', version: '0.0.1' }], tasks: [] },
        somethingNewerBuildsWrite: { keep: 'me' },
      },
      null,
      2,
    )

    const result = withProjectLibraries(json, [{ name: 'node-uio', version: '0.0.2' }])

    expect(result.ok).toBe(true)
    const back = JSON.parse(result.ok ? result.json : '{}')
    expect(back.data.libraries).toEqual([{ name: 'node-uio', version: '0.0.2' }])
    expect(back.data.pous).toEqual([{ name: 'main' }])
    expect(back.data.tasks).toEqual([])
    expect(back.meta).toEqual({ name: 'demo', schemaVersion: 3 })
    expect(back.somethingNewerBuildsWrite).toEqual({ keep: 'me' })
  })

  it('writes refs sorted by name', () => {
    const result = withProjectLibraries('{"data":{}}', [
      { name: 'zeta', version: '1.0.0' },
      { name: 'alpha', version: '0.1.0' },
    ])

    expect(result.ok && JSON.parse(result.json).data.libraries.map((r: { name: string }) => r.name)).toEqual([
      'alpha',
      'zeta',
    ])
  })

  it('clears the list when given no refs', () => {
    const result = withProjectLibraries('{"data":{"libraries":[{"name":"a","version":"1"}]}}', [])

    expect(result.ok && JSON.parse(result.json).data.libraries).toEqual([])
  })

  it('creates data when the document has none', () => {
    const result = withProjectLibraries('{"meta":{"name":"demo"}}', [{ name: 'a', version: '1' }])

    expect(result.ok && JSON.parse(result.json)).toEqual({
      meta: { name: 'demo' },
      data: { libraries: [{ name: 'a', version: '1' }] },
    })
  })

  it('replaces a data key that is not an object', () => {
    const result = withProjectLibraries('{"data":"nonsense"}', [{ name: 'a', version: '1' }])

    expect(result.ok && JSON.parse(result.json).data).toEqual({ libraries: [{ name: 'a', version: '1' }] })
  })

  it('reports malformed JSON rather than throwing', () => {
    expect(withProjectLibraries('{ not json', [])).toEqual({ ok: false, error: 'project.json on disk is malformed' })
  })

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '42'],
  ])('reports %s as not an object', (_label, json) => {
    expect(withProjectLibraries(json, [])).toEqual({ ok: false, error: 'project.json on disk is not an object' })
  })

  it('emits two-space indented JSON, as the project writer does', () => {
    const result = withProjectLibraries('{"data":{}}', [{ name: 'a', version: '1' }])

    expect(result.ok && result.json.split('\n')[1]).toBe('  "data": {')
  })
})
