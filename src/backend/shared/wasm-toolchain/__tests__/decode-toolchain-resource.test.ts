/**
 * Streams and Response, which the test environment for the shared surface lacks.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { decodeToolchainResource, downloadWithStallLimit, loadToolchainResources } from '../clang-worker-host'

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

/** A response whose body sends `chunks`, waiting `gapMs` before each, then ends unless `hang` is set. */
function slowResponse(chunks: string[], gapMs: number, hang = false, status = 200): Response {
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, gapMs))
      if (i < chunks.length) controller.enqueue(encode(chunks[i++]))
      else if (!hang) controller.close()
      else await new Promise(() => undefined)
    },
  })
  return new Response(body, { status })
}

describe('downloadWithStallLimit', () => {
  it('finishes a download that keeps moving, however long it takes in total', async () => {
    const bytes = await downloadWithStallLimit(
      'u',
      () => Promise.resolve(slowResponse(['ab', 'cd', 'ef', 'gh'], 25)),
      60,
    )
    expect(new TextDecoder().decode(bytes)).toBe('abcdefgh')
  })

  it('fails a download that stops sending bytes, and aborts it', async () => {
    let aborted = false
    const open = (_url: string, signal: AbortSignal) => {
      signal.addEventListener('abort', () => (aborted = true))
      return Promise.resolve(slowResponse(['ab'], 5, true))
    }
    await expect(downloadWithStallLimit('https://x/llvm.core.wasm.gz', open, 40)).rejects.toThrow(
      'Download of https://x/llvm.core.wasm.gz stalled: no data for 0 s.',
    )
    expect(aborted).toBe(true)
  })

  it('fails a request that never answers', async () => {
    const open = (_url: string, signal: AbortSignal) =>
      new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    await expect(downloadWithStallLimit('u', open, 30)).rejects.toThrow('stalled')
  })

  it('fails on an HTTP error status', async () => {
    await expect(
      downloadWithStallLimit('u', () => Promise.resolve(new Response('missing', { status: 404 })), 1000),
    ).rejects.toThrow('Could not download u (HTTP 404).')
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
        return Promise.resolve(new Response(encode(url)))
      },
    )
    expect(downloaded).toEqual(['https://x/a.wasm.gz', 'https://x/b.tar.gz'])
    expect(files).toEqual({ 'a.wasm': encode('https://x/a.wasm.gz'), 'b.tar': encode('https://x/b.tar.gz') })
  })

  it('fails when one download fails', async () => {
    await expect(
      loadToolchainResources([{ name: 'a.wasm', url: 'u' }], true, () => Promise.reject(new Error('network down'))),
    ).rejects.toThrow('network down')
  })
})
