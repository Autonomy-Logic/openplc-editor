import type { AIPort, AITelemetryEventName } from '../../../middleware/shared/ports/ai-port'

/** Narrowed to the one method a caller needs, so a fake or spy doesn't have to stand up the rest of the AI surface. */
export type AITelemetrySink = Pick<AIPort, 'sendTelemetry'>

/** Fire-and-forget: failures are silently ignored. No timestamp added here — the port stamps every event. */
function track(ai: AITelemetrySink, event: AITelemetryEventName, data: Record<string, unknown>): void {
  ai.sendTelemetry(event, data)
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
export function trackCompletionRequested(
  ai: AITelemetrySink,
  data: {
    language: string
    model: string
    prefixLength: number
    suffixLength: number
    hasProjectContext: boolean
  },
): void {
  track(ai, 'completion_requested', data)
}

/** Track that an inline completion was shown to the user (ghost text displayed). */
export function trackCompletionShown(
  ai: AITelemetrySink,
  data: {
    language: string
    model: string
    completionLength: number
    latencyMs: number
    source: 'network' | 'cache' | 'recycled'
    /** Time-to-first-token in ms (only present for network requests). */
    ttftMs?: number
  },
): void {
  track(ai, 'completion_shown', data)
}

/** Track that the user accepted an inline completion (Tab/Enter). */
export function trackCompletionAccepted(
  ai: AITelemetrySink,
  data: { language: string; completionLength: number },
): void {
  track(ai, 'completion_accepted', data)
}

/** Track that the user dismissed an inline completion (Escape or kept typing). */
export function trackCompletionDismissed(
  ai: AITelemetrySink,
  data: {
    language: string
    completionLength: number
    shownDurationMs: number
  },
): void {
  track(ai, 'completion_dismissed', data)
}

/** Track that an inline completion request failed. */
export function trackCompletionError(
  ai: AITelemetrySink,
  data: {
    language: string
    model: string
    errorType: string
    statusCode?: number
    latencyMs: number
  },
): void {
  track(ai, 'completion_error', data)
}

/** Track that an inline completion request timed out. */
export function trackCompletionTimeout(
  ai: AITelemetrySink,
  data: { language: string; model: string; timeoutMs: number },
): void {
  track(ai, 'completion_timeout', data)
}

/** Track that a chat message was sent. */
export function trackChatMessage(
  ai: AITelemetrySink,
  data: {
    language: string
    model: string
    messageCount: number
    activeEditor: string | null
  },
): void {
  track(ai, 'chat_message', data)
}

/** Track that a chat response was rated. */
export function trackChatRating(
  ai: AITelemetrySink,
  data: { messageId: string; rating: 'up' | 'down'; language: string },
): void {
  track(ai, 'chat_rating', data)
}

/** Track that a new chat conversation was implicitly created (fires on the `conversation_started` SSE event). */
export function trackConversationCreated(
  ai: AITelemetrySink,
  data: {
    conversationId: string
    projectId: string | null
    /** Length of the auto-derived title — the title itself is user content, so we send only its size. */
    titleLength: number
    model: 'haiku' | 'sonnet'
  },
): void {
  track(ai, 'conversation_created', data)
}

/** Track that the user opened an existing conversation from the switcher. */
export function trackConversationLoaded(ai: AITelemetrySink, data: { conversationId: string }): void {
  track(ai, 'conversation_loaded', data)
}

/** Track that a conversation was renamed. */
export function trackConversationRenamed(
  ai: AITelemetrySink,
  data: { conversationId: string; newTitleLength: number },
): void {
  track(ai, 'conversation_renamed', data)
}

/** Track that a conversation was hard-deleted. */
export function trackConversationDeleted(ai: AITelemetrySink, data: { conversationId: string }): void {
  track(ai, 'conversation_deleted', data)
}

/** Track that the `AcuExhaustionModal` opened in response to a 402; `remaining` is the ACU left, `0` typically. */
export function trackAcuExhausted(
  ai: AITelemetrySink,
  data: {
    source: 'usage_limit' | 'subscription' | 'rate_limit'
    planSlug: string | null
    remaining: number | null
  },
): void {
  track(ai, 'acu_exhausted', data)
}

/** Track that the user clicked the upgrade / reactivate CTA; `source` identifies which surface fired it. */
export function trackUpgradeCtaClicked(ai: AITelemetrySink, data: { source: 'modal' }): void {
  track(ai, 'upgrade_cta_clicked', data)
}
