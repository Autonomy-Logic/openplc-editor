const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/** A body that hands out `chunks` one read at a time and records whether it was read to its end. */
export function trackedBody(chunks: string[]): { body: ReadableStream<Uint8Array>; fullyRead: () => boolean } {
  let next = 0
  let ended = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (next < chunks.length) {
          controller.enqueue(encode(chunks[next++]))
          return
        }
        ended = true
        controller.close()
      },
    },
    { highWaterMark: 0 },
  )
  return { body, fullyRead: () => ended }
}

/** A body that never sends a byte; given a signal, it errors when the signal aborts, as a browser's `fetch` body does. */
export const silentBody = (signal?: AbortSignal): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>(
    {
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new Error('The download was aborted.')))
      },
      pull: () => new Promise<void>(() => undefined),
    },
    { highWaterMark: 0 },
  )

/** A `Response` whose `type` is `basic`, as a same-origin `fetch` answers; a constructed `Response` is `default`. */
export function basicResponse(body: BodyInit | null, init?: ResponseInit): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}
