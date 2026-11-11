/**
 * Streams and Response, which the test environment for the shared surface lacks.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { decodeToolchainResource, loadToolchainResources } from '../clang-worker-host'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('decodeToolchainResource', () => {
  const gzip = async (bytes: Uint8Array): Promise<Uint8Array> =>
    new Uint8Array(
      await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    )

  it('decompresses a gzip resource', async () => {
    const raw = encode('\u0000asm toolchain')
    expect(await decodeToolchainResource(await gzip(raw), true)).toEqual(raw)
  })

  it('keeps a resource the server already decompressed', async () => {
    const raw = encode('\u0000asm toolchain')
    expect(await decodeToolchainResource(raw, true)).toBe(raw)
  })

  it('keeps every resource when the build stores them uncompressed', async () => {
    const raw = new Uint8Array([0x1f, 0x8b, 0])
    expect(await decodeToolchainResource(raw, false)).toBe(raw)
  })
})

describe('loadToolchainResources', () => {
  it('downloads each resource once and keys it by name', async () => {
    const downloaded: string[] = []
    const files = await loadToolchainResources(
      [
        { name: 'a.wasm', url: 'https://x/a.wasm.gz' },
        { name: 'b.tar', url: 'https://x/b.tar.gz' },
      ],
      false,
      (url) => {
        downloaded.push(url)
        return Promise.resolve(encode(url))
      },
    )
    expect(downloaded).toEqual(['https://x/a.wasm.gz', 'https://x/b.tar.gz'])
    expect(files).toEqual({ 'a.wasm': encode('https://x/a.wasm.gz'), 'b.tar': encode('https://x/b.tar.gz') })
  })

  it('fails when one download fails', async () => {
    await expect(
      loadToolchainResources([{ name: 'a.wasm', url: 'u' }], true, () => Promise.reject(new Error('HTTP 404'))),
    ).rejects.toThrow('HTTP 404')
  })
})
