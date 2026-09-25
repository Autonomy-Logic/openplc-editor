/**
 * Every ZIP here is built by JSZip, so the fixtures are real archives rather
 * than a mock of one. The cases that matter are the ones a user actually hits:
 * a bundle zipped on a Mac, a folder of archives, and a ZIP that is not a
 * bundle at all.
 */

import JSZip from 'jszip'

import { BUNDLE_LIMITS, LibraryBundleError, readLibraryBundle } from '../read-library-bundle'

/**
 * `deflate` matters: JSZip stores uncompressed by default, which makes every
 * entry's compression ratio 1:1 and would let the bomb case pass vacuously.
 */
const zipOf = async (files: Record<string, string>, deflate = false): Promise<Uint8Array> => {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content)
  return zip.generateAsync(deflate ? { type: 'uint8array', compression: 'DEFLATE' } : { type: 'uint8array' })
}

describe('reading a bundle', () => {
  it('returns every .stlib, whatever folder it sits in', async () => {
    const archives = await readLibraryBundle(
      await zipOf({ 'a.stlib': '{"a":1}', 'nested/b.stlib': '{"b":2}', 'deep/er/c.stlib': '{"c":3}' }),
    )

    expect(archives.map((archive) => archive.path)).toEqual(['a.stlib', 'deep/er/c.stlib', 'nested/b.stlib'])
    if (archives[0].kind !== 'stlib') throw new Error('expected an stlib entry')
    expect(archives[0].text).toBe('{"a":1}')
  })

  it('orders by path so two runs install in the same order', async () => {
    const archives = await readLibraryBundle(await zipOf({ 'z.stlib': '{}', 'a.stlib': '{}', 'm.stlib': '{}' }))
    expect(archives.map((archive) => archive.path)).toEqual(['a.stlib', 'm.stlib', 'z.stlib'])
  })

  it('ignores everything that is not a library file', async () => {
    const archives = await readLibraryBundle(
      await zipOf({ 'README.md': 'hi', 'lib.stlib': '{}', 'src/thing.st': 'PROGRAM' }),
    )
    expect(archives.map((archive) => archive.path)).toEqual(['lib.stlib'])
  })

  it('takes CODESYS files as bytes and .stlib as text', async () => {
    // A .lib is binary: reading it as a string would mangle it before the
    // importer ever saw it, so the two kinds come back differently on purpose.
    const files = await readLibraryBundle(
      await zipOf({ 'a.stlib': '{"a":1}', 'OSCAT.library': 'binary', 'old.lib': 'binary' }),
    )

    // Uppercase sorts before lowercase under codepoint order.
    expect(files.map((file) => [file.path, file.kind])).toEqual([
      ['OSCAT.library', 'codesys'],
      ['a.stlib', 'stlib'],
      ['old.lib', 'codesys'],
    ])
    const stlib = files.find((file) => file.kind === 'stlib')
    const codesys = files.find((file) => file.kind === 'codesys')
    if (stlib?.kind !== 'stlib' || codesys?.kind !== 'codesys') throw new Error('expected one of each kind')
    expect(stlib.text).toBe('{"a":1}')
    expect(codesys.bytes).toBeInstanceOf(Uint8Array)
  })

  it('hands the CODESYS preparer a basename, not a path', async () => {
    // The preparer derives the library identifier from the filename, so a
    // folder path would end up inside the name.
    const files = await readLibraryBundle(await zipOf({ 'vendor/v3/OSCAT.library': 'binary' }))
    if (files[0].kind !== 'codesys') throw new Error('expected a codesys entry')
    expect(files[0].filename).toBe('OSCAT.library')
    expect(files[0].path).toBe('vendor/v3/OSCAT.library')
  })

  it('takes every extension case-insensitively, which Windows produces', async () => {
    const archives = await readLibraryBundle(await zipOf({ 'Lib.STLIB': '{}', 'O.LIBRARY': 'x', 'P.LIB': 'x' }))
    expect(archives.map((archive) => archive.kind)).toEqual(['stlib', 'codesys', 'codesys'])
  })

  it('skips the resource forks macOS puts in a ZIP', async () => {
    // Zipping a folder in Finder writes __MACOSX/._name beside every file.
    // They end in .stlib and are not archives, so without this a Mac-authored
    // bundle reports half its entries as corrupt.
    const archives = await readLibraryBundle(
      await zipOf({
        'libs/real.stlib': '{"real":true}',
        '__MACOSX/libs/._real.stlib': ' ',
        '._stray.stlib': ' ',
      }),
    )

    expect(archives.map((archive) => archive.path)).toEqual(['libs/real.stlib'])
  })
})

describe('refusing a ZIP that is not a bundle', () => {
  it('refuses bytes that are not a ZIP at all', async () => {
    await expect(readLibraryBundle(new TextEncoder().encode('not a zip'))).rejects.toThrow(LibraryBundleError)
  })

  it('refuses a ZIP holding no library, rather than installing nothing quietly', async () => {
    await expect(readLibraryBundle(await zipOf({ 'notes.txt': 'hello' }))).rejects.toThrow(
      'ZIP contains no .stlib, .lib or .library files',
    )
  })

  it('refuses one holding only macOS metadata', async () => {
    await expect(readLibraryBundle(await zipOf({ '__MACOSX/._a.stlib': 'x', '._b.library': 'x' }))).rejects.toThrow(
      'ZIP contains no .stlib, .lib or .library files',
    )
  })
})

describe('limits', () => {
  it('refuses more entries than the limit', async () => {
    const many: Record<string, string> = {}
    for (let index = 0; index < 12; index += 1) many[`lib${index}.stlib`] = '{}'

    await expect(readLibraryBundle(await zipOf(many), { ...BUNDLE_LIMITS, maxEntries: 10 })).rejects.toThrow(
      'too many files',
    )
  })

  it('refuses an entry larger than the per-entry limit', async () => {
    const bytes = await zipOf({ 'big.stlib': 'x'.repeat(5_000) })
    await expect(readLibraryBundle(bytes, { ...BUNDLE_LIMITS, maxEntryBytes: 1_000 })).rejects.toThrow('too large')
  })

  it('refuses a ratio no honest archive reaches', async () => {
    // A long run of one character compresses far past anything real source
    // text does, which is exactly the shape of a bomb.
    const bytes = await zipOf({ 'bomb.stlib': 'A'.repeat(2_000_000) }, true)
    await expect(readLibraryBundle(bytes, { ...BUNDLE_LIMITS, maxCompressionRatio: 50 })).rejects.toThrow(
      'compression ratio',
    )
  })

  it('refuses a total past the limit even when each entry is small', async () => {
    const bytes = await zipOf({ 'a.stlib': 'x'.repeat(4_000), 'b.stlib': 'y'.repeat(4_000) })
    await expect(
      readLibraryBundle(bytes, { ...BUNDLE_LIMITS, maxEntryBytes: 10_000, maxTotalBytes: 5_000 }),
    ).rejects.toThrow('too large uncompressed')
  })

  it('accepts a bundle inside the limits', async () => {
    const archives = await readLibraryBundle(await zipOf({ 'a.stlib': '{}', 'b.stlib': '{}' }))
    expect(archives).toHaveLength(2)
  })
})
