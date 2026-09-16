import type { AIChatContentBlock, AIEntitlements, AIFeatureConfig, AIUsage, BillingErrorPayload } from './types'

/** Language identifiers supported by AI completion. */
export type AICompletionLanguage = 'st' | 'il' | 'python' | 'cpp'

/** Language identifiers supported by AI chat (superset of completion languages). */
export type AIChatLanguage = 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd'

/** Inline completion request parameters. */
export interface AICompleteParams {
  prefix: string
  suffix: string
  language: AICompletionLanguage
  projectContext?: string
  model?: 'haiku' | 'sonnet'
  maxTokens?: number
}

export interface AIToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** `content` is a string for prose, or blocks once tools are involved (`tool_use`, `tool_result`). */
export interface AIChatMessageParam {
  role: 'user' | 'assistant'
  content: string | AIChatContentBlock[]
}

/** Chat request parameters. */
export interface AIChatParams {
  messages: AIChatMessageParam[]
  pouContext?: string
  language?: AIChatLanguage
  model?: 'haiku' | 'sonnet'
  /** Absent means the model has no way to act on the project. */
  tools?: AIToolDefinition[]
  /** Append to this conversation. Absent with `projectId` present starts one. */
  conversationId?: string
  /** With no `conversationId` the backend creates one, announced in a `conversation_started` frame. */
  projectId?: string
}

/**
 * Credit status returned by `fetchCredits`.
 * @deprecated Use `fetchEntitlements` + `fetchUsage` instead.
 */
export interface AICreditStatus {
  credits_used: number
  credits_total: number
  tier: 'free' | 'pro'
  current_period_end: string | null
}

/** The wire frames behind both `streamChat`'s flattened text and the agentic loop's `tool_use` handling. */
export type AISSEEvent =
  | { type: 'content_block_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'message_stop'; stopReason?: string }
  | { type: 'error'; error: string }
  /** First frame when the backend implicitly creates a conversation; capture the id for later turns. */
  | { type: 'conversation_started'; conversationId: string; conversationTitle: string }

/** Telemetry event names. */
export type AITelemetryEventName =
  | 'completion_requested'
  | 'completion_shown'
  | 'completion_accepted'
  | 'completion_dismissed'
  | 'completion_error'
  | 'completion_timeout'
  | 'completion_empty'
  | 'chat_message'
  | 'chat_rating'
  | 'conversation_created'
  | 'conversation_loaded'
  | 'conversation_renamed'
  | 'conversation_deleted'
  /** Fired when `AcuExhaustionModal` opens. Data: `{ source: 'usage_limit'|'subscription', planSlug, remaining }`. */
  | 'acu_exhausted'
  | 'upgrade_cta_clicked'

/** Thrown as one class by both platforms, so shared code can use `instanceof`. */
export class AIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
    readonly billing?: BillingErrorPayload,
  ) {
    super(message)
    this.name = 'AIRequestError'
  }
}

export interface AIConversationSummary {
  id: string
  title: string
  updatedAt: string
  projectId?: string | null
}

export interface AIConversationDetail extends AIConversationSummary {
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    /** Opaque on purpose — narrow at the point of use rather than duplicating the wire shape. */
    content: unknown
    /** ISO 8601; the transcript is ordered by this. */
    createdAt: string
    rating?: 'up' | 'down' | null
  }>
}

export interface AIPort extends AIFeatureConfig {
  streamCompletion(params: AICompleteParams, signal?: AbortSignal): AsyncGenerator<string, void, unknown>

  streamChat(params: AIChatParams, signal?: AbortSignal): AsyncGenerator<string, void, unknown>

  /** Unflattened chat stream the agentic loop consumes; adapters implement this and derive `streamChat` from it. */
  streamChatEvents(params: AIChatParams, signal?: AbortSignal): AsyncGenerator<AISSEEvent, void, unknown>

  fetchEntitlements(signal?: AbortSignal): Promise<AIEntitlements>

  fetchUsage(signal?: AbortSignal): Promise<AIUsage>

  /**
   * Fetch current AI credit status.
   * @deprecated Use `fetchEntitlements` + `fetchUsage` instead.
   */
  fetchCredits(signal?: AbortSignal): Promise<AICreditStatus>

  /** Fire-and-forget: failures are never surfaced to the caller. */
  sendTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): void

  /** Once per session, fire-and-forget; optional for a platform with no warm endpoint. */
  warmCache?(): void

  /** A build with no conversation store still chats, but hides the history list. */
  conversations?: {
    list(options?: { projectId?: string; limit?: number; offset?: number }): Promise<AIConversationSummary[]>
    get(id: string): Promise<AIConversationDetail>
    create(input: { projectId?: string; title?: string }): Promise<AIConversationDetail>
    rename(id: string, title: string): Promise<{ id: string; title: string }>
    remove(id: string): Promise<void>
  }
}
