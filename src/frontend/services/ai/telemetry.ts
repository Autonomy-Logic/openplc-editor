import type { AIPort, AITelemetryEventName } from '../../../middleware/shared/ports/ai-port'

/** Narrowed to the one method a caller needs, so a fake or spy doesn't have to stand up the rest of the AI surface. */
export type AITelemetrySink = Pick<AIPort, 'sendTelemetry'>

/** Fire-and-forget: failures are silently ignored. No timestamp added here — the port stamps every event. */
function track(ai: AITelemetrySink, event: AITelemetryEventName, data: Record<string, unknown>): void {
  ai.sendTelemetry(event, data)
}

export type TelemetryTimer = {
  elapsed: () => number
}

export function startTimer(): TelemetryTimer {
  const start = performance.now()
  return { elapsed: () => Math.round(performance.now() - start) }
}

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

export function trackCompletionAccepted(
  ai: AITelemetrySink,
  data: { language: string; completionLength: number },
): void {
  track(ai, 'completion_accepted', data)
}

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

export function trackCompletionTimeout(
  ai: AITelemetrySink,
  data: { language: string; model: string; timeoutMs: number },
): void {
  track(ai, 'completion_timeout', data)
}

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

export function trackChatRating(
  ai: AITelemetrySink,
  data: { messageId: string; rating: 'up' | 'down'; language: string },
): void {
  track(ai, 'chat_rating', data)
}

/** Fires on the `conversation_started` SSE event, not on an explicit create. */
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

export function trackConversationLoaded(ai: AITelemetrySink, data: { conversationId: string }): void {
  track(ai, 'conversation_loaded', data)
}

export function trackConversationRenamed(
  ai: AITelemetrySink,
  data: { conversationId: string; newTitleLength: number },
): void {
  track(ai, 'conversation_renamed', data)
}

export function trackConversationDeleted(ai: AITelemetrySink, data: { conversationId: string }): void {
  track(ai, 'conversation_deleted', data)
}

/** Fires when the exhaustion modal opens on a 402; `remaining` is the ACU left, typically `0`. */
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

export function trackUpgradeCtaClicked(ai: AITelemetrySink, data: { source: 'modal' }): void {
  track(ai, 'upgrade_cta_clicked', data)
}
