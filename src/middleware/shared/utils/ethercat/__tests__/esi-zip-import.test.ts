import JSZip from 'jszip'

import { decodeXmlBytes, importESIZip, looksLikeESI, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES } from '../esi-zip-import'

const zipOf = async (files: Array<{ path: string; content: string | Uint8Array }>): Promise<Uint8Array> => {
  const zip = new JSZip()
  for (const f of files) zip.file(f.path, f.content)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('looksLikeESI', () => {
  test('accepts both ETG roots', () => {
    expect(looksLikeESI('<?xml version="1.0"?><EtherCATInfo Version="1.12"/>')).toBe(true)
    expect(looksLikeESI('<?xml version="1.0"?><EtherCATModule Version="1.12"/>')).toBe(true)
    expect(looksLikeESI('<root/>')).toBe(false)
  })
})

describe('decodeXmlBytes', () => {
  test('honours the declared ISO-8859-1 encoding', () => {
    const head = '<?xml version="1.0" encoding="ISO-8859-1"?><Name>Eingabemodul f'
    const bytes = new Uint8Array([...new TextEncoder().encode(head), 0xfc, ...new TextEncoder().encode('r</Name>')])
    expect(decodeXmlBytes(bytes)).toContain('Eingabemodul für')
  })

  test('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<EtherCATInfo/>')])
    expect(decodeXmlBytes(bytes)).toBe('<EtherCATInfo/>')
  })
})

describe('importESIZip', () => {
  test('imports module-only libraries and files at any folder depth', async () => {
    const buf = await zipOf([
      { path: 'Coupler.xml', content: '<EtherCATInfo/>' },
      { path: 'a/b/c/Modules.xml', content: '<EtherCATModule/>' },
    ])
    const r = await importESIZip(buf)
    expect(r.imported.map((f) => f.filename).sort()).toEqual(['Coupler.xml', 'Modules.xml'])
    expect(r.dropped).toEqual([])
  })

  test('keeps the first of two entries with the same file name and reports the second', async () => {
    const buf = await zipOf([
      { path: 'v1/Coupler.xml', content: '<EtherCATInfo/>' },
      { path: 'v2/coupler.xml', content: '<EtherCATInfo/>' },
    ])
    const r = await importESIZip(buf)
    expect(r.imported).toHaveLength(1)
    expect(r.dropped).toEqual(['v2/coupler.xml (duplicate file name)'])
  })

  test('stops reading an entry that inflates past the per-entry limit', async () => {
    const big = new Uint8Array(MAX_ZIP_ENTRY_BYTES + 1024).fill(0x20)
    big.set(new TextEncoder().encode('<EtherCATInfo>'))
    const r = await importESIZip(await zipOf([{ path: 'bomb.xml', content: big }]))
    expect(r.imported).toEqual([])
    expect(r.dropped).toEqual(['bomb.xml (larger than 32 MiB)'])
    // Building and inflating a 32 MiB entry is slow on CI runners.
  }, 60000)

  test('refuses a ZIP with more entries than the limit', async () => {
    const files = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' }))
    await expect(importESIZip(await zipOf(files))).rejects.toThrow(/limit is 2000/)
  })
})
