import type { AIChatRequest, AICompleteRequest, AICreditStatus, AISSEEvent, AITelemetryEvent } from './types'

const AI_BASE_URL = `${import.meta.env?.VITE_EDGE_API_URL ?? ''}/ai`

/**
 * Parse a single SSE line into an AISSEEvent.
 * Returns null for non-data lines (comments, empty lines).
 */
function parseSSELine(line: string): AISSEEvent | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6)
  if (data === '[DONE]') return { type: 'message_stop' }
  try {
    return JSON.parse(data) as AISSEEvent
  } catch {
    return null
  }
}

/**
 * Stream an AI request as an AsyncGenerator of string tokens.
 * Handles SSE parsing, AbortSignal, and error responses (429, 503).
 *
 * @param endpoint - API endpoint path (e.g., '/complete' or '/chat')
 * @param body - Request body
 * @param signal - Optional AbortSignal for cancellation
 * @yields string tokens as they arrive from the stream
 */
export async function* streamAIRequest(
  endpoint: string,
  body: AICompleteRequest | AIChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(`${AI_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      throw new AIRequestError(
        'Rate limited. Please wait before trying again.',
        429,
        retryAfter ? Number(retryAfter) : undefined,
      )
    }
    if (response.status === 402) {
      throw new AIRequestError('Credit limit reached.', 402)
    }
    if (response.status === 503) {
      throw new AIRequestError('AI service temporarily unavailable.', 503)
    }
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new AIRequestError(errorText, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new AIRequestError('No response body', 0)

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        const event = parseSSELine(trimmed)
        if (!event) continue

        if (event.type === 'content_block_delta') {
          yield event.delta
        } else if (event.type === 'error') {
          throw new AIRequestError(event.error, 0)
        } else if (event.type === 'message_stop') {
          return
        }
      }
    }

    // Flush any remaining data in the buffer after the stream ends
    const remaining = buffer.trim()
    if (remaining) {
      const event = parseSSELine(remaining)
      if (event) {
        if (event.type === 'content_block_delta') {
          yield event.delta
        } else if (event.type === 'error') {
          throw new AIRequestError(event.error, 0)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Fetch AI credit status.
 */
export async function fetchAICredits(signal?: AbortSignal): Promise<AICreditStatus> {
  const response = await fetch(`${AI_BASE_URL}/credits`, {
    method: 'GET',
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    throw new AIRequestError('Failed to fetch credits', response.status)
  }

  return response.json() as Promise<AICreditStatus>
}

/**
 * Send a telemetry event (fire-and-forget).
 */
export function sendTelemetry(event: AITelemetryEvent): void {
  fetch(`${AI_BASE_URL}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(event),
  }).catch(() => {
    // Telemetry is best-effort, silently ignore failures
  })
}

/**
 * Custom error class for AI request failures.
 */
export class AIRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'AIRequestError'
  }
}
