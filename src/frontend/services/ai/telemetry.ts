import { sendTelemetry } from './api-client'
import type { AITelemetryEventName } from './types'

/**
 * Tracks an AI telemetry event with automatic timestamp enrichment.
 * All events are fire-and-forget — failures are silently ignored.
 */
function track(event: AITelemetryEventName, data: Record<string, unknown>): void {
  sendTelemetry({
    event,
    data: {
      ...data,
      timestamp: Date.now(),
    },
  })
}

/** A timing handle returned by `startTimer()` to measure elapsed time. */
export type TelemetryTimer = {
  /** Elapsed milliseconds since the timer was started. */
  elapsed: () => number
}

/**
 * Start a high-resolution timer for measuring durations (e.g., time-to-first-token).
 * Uses `performance.now()` for sub-millisecond precision.
 */
export function startTimer(): TelemetryTimer {
  const start = performance.now()
  return { elapsed: () => Math.round(performance.now() - start) }
}

/** Track that an inline completion was requested from the backend. */
export function trackCompletionRequested(data: {
  language: string
  model: string
  prefixLength: number
  suffixLength: number
  hasProjectContext: boolean
}): void {
  track('completion_requested', data)
}

/** Track that an inline completion was shown to the user (ghost text displayed). */
export function trackCompletionShown(data: {
  language: string
  model: string
  completionLength: number
  latencyMs: number
  source: 'network' | 'cache' | 'recycled'
  /** Time-to-first-token in ms (only present for network requests). */
  ttftMs?: number
}): void {
  track('completion_shown', data)
}

/** Track that the user accepted an inline completion (Tab/Enter). */
export function trackCompletionAccepted(data: { language: string; completionLength: number }): void {
  track('completion_accepted', data)
}

/** Track that the user dismissed an inline completion (Escape or kept typing). */
export function trackCompletionDismissed(data: {
  language: string
  completionLength: number
  shownDurationMs: number
}): void {
  track('completion_dismissed', data)
}

/** Track that an inline completion request failed. */
export function trackCompletionError(data: {
  language: string
  model: string
  errorType: string
  statusCode?: number
  latencyMs: number
}): void {
  track('completion_error', data)
}

/** Track that an inline completion request timed out. */
export function trackCompletionTimeout(data: { language: string; model: string; timeoutMs: number }): void {
  track('completion_timeout', data)
}

/** Track that a chat message was sent. */
export function trackChatMessage(data: {
  language: string
  model: string
  messageCount: number
  pouName: string | null
}): void {
  track('chat_message', data)
}

/** Track that a chat response was rated. */
export function trackChatRating(data: { messageId: string; rating: 'up' | 'down'; language: string }): void {
  track('chat_rating', data)
}
