/**
 * AIPort — Contract for AI-assisted coding features (inline completions, chat, credits, telemetry).
 *
 * The shared UI depends only on this interface. Platform adapters provide concrete
 * implementations that handle HTTP streaming, SSE parsing, and API authentication.
 */

import type { AIChatContentBlock, AIEntitlements, AIFeatureConfig, AIUsage, BillingErrorPayload } from './types'

// ---------------------------------------------------------------------------
// Parameter & result types
// ---------------------------------------------------------------------------

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

/** A tool the model may call, as the API describes one. */
export interface AIToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/**
 * One turn of the conversation.
 *
 * `content` is a string for ordinary prose and a list of blocks once tools are in
 * play: the model's `tool_use` and the caller's `tool_result` ride back up on the
 * next iteration, which is how the model learns what its own call did.
 */
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
  /** Offered to the model. Absent means it has no way to act on the project. */
  tools?: AIToolDefinition[]
  /** Append to this conversation. Absent with `projectId` present starts one. */
  conversationId?: string
  /**
   * Whose project this is about. With no `conversationId`, the backend creates the
   * conversation and titles it, announcing the id in a `conversation_started` frame.
   */
  projectId?: string
}

/**
 * Credit status returned by `fetchCredits`.
 *
 * @deprecated Use `AIEntitlements` + `AIUsage` (via the new `fetchEntitlements`
 * / `fetchUsage` port methods). Retained for one release while UI call sites
 * migrate to the ACU-based billing surface.
 */
export interface AICreditStatus {
  credits_used: number
  credits_total: number
  tier: 'free' | 'pro'
  current_period_end: string | null
}

/**
 * One frame of the model's answer, as it arrives.
 *
 * This is the WIRE contract, and it lives on the port because both builds now
 * have to speak it. `streamChat` and `streamCompletion` flatten this to text,
 * which is all an inline completion or a plain reply needs — but the agentic
 * loop needs `tool_use`, and a loop that cannot see a tool call silently stops
 * building anything while still looking like it answered. So the structured
 * stream is part of the contract rather than something each adapter keeps to
 * itself: on the desktop these frames cross an IPC boundary, and a shape known
 * only to one adapter cannot be carried over one.
 */
export type AISSEEvent =
  | { type: 'content_block_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'message_stop'; stopReason?: string }
  | { type: 'error'; error: string }
  /**
   * The FIRST frame when `/ai/chat` creates a conversation implicitly — the
   * request carried a `projectId` and no `conversationId`. The caller captures
   * the assigned id so the next turn of the loop appends to it instead of
   * starting another one.
   */
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
  /**
   * Fired when `AcuExhaustionModal` opens (transition from `null` to a
   * billing block on the slice). Data: `{ source: 'usage_limit'|'subscription', planSlug, remaining }`.
   */
  | 'acu_exhausted'
  /**
   * Fired when the user clicks the upgrade / reactivate CTA in the
   * exhaustion modal. Data: `{ source: 'modal' }`.
   */
  | 'upgrade_cta_clicked'

/**
 * A refusal from the AI transport, as one class both platforms throw.
 *
 * A class rather than a shape because the shared chat panel and the shared agentic
 * loop decide what to show with `instanceof`, and neither can reach into an adapter
 * to find a private one. `status` separates a 402 from a 500; `billing` is what pops
 * the exhaustion modal, and it must arrive whole rather than flattened to a sentence.
 *
 * DESKTOP ADAPTERS: IPC structure-clones its payloads and the prototype does not
 * survive the crossing, so an error thrown in the main process arrives in the
 * renderer as a plain object and every `instanceof` here answers false. The adapter
 * has to rebuild this class on the renderer side from the reported failure — the
 * version-control adapter's `unwrap` does exactly that, for exactly this reason.
 */
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

/** A stored conversation, as a list needs to show it. */
export interface AIConversationSummary {
  id: string
  title: string
  updatedAt: string
  projectId?: string | null
}

/** A stored conversation with its transcript. */
export interface AIConversationDetail extends AIConversationSummary {
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    /**
     * Opaque here on purpose: what a turn holds — prose, a tool call, a tool
     * result — is the wire's business, and restating it would be a second copy of
     * a shape the server owns. Narrow it at the point of use.
     */
    content: unknown
    /**
     * ISO 8601. The transcript is ordered by this and shows it, so synthesising it
     * on load would stamp every turn of a week-old conversation with today.
     */
    createdAt: string
    /**
     * The thumbs the user gave this answer, when they gave any.
     *
     * Carried because it is persisted feedback: dropping it on load means every
     * rating anyone ever left disappears the moment the conversation is reopened,
     * silently, with the UI showing an unrated answer.
     */
    rating?: 'up' | 'down' | null
  }>
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface AIPort extends AIFeatureConfig {
  /**
   * Stream an inline code completion.
   * Yields string tokens as they arrive. Handles SSE parsing internally.
   */
  streamCompletion(params: AICompleteParams, signal?: AbortSignal): AsyncGenerator<string, void, unknown>

  /**
   * Stream a chat response.
   * Yields string tokens as they arrive. Handles SSE parsing internally.
   */
  streamChat(params: AIChatParams, signal?: AbortSignal): AsyncGenerator<string, void, unknown>

  /**
   * The same chat response, unflattened.
   *
   * `streamChat` above is the convenience for a caller that only wants prose.
   * This is what the agentic loop consumes, because a tool call is not text: it
   * arrives as its own frame, and dropping it is indistinguishable from the
   * model choosing not to act. Both methods are fed by one request — an adapter
   * implements this one and derives the other from it, never the reverse.
   */
  streamChatEvents(params: AIChatParams, signal?: AbortSignal): AsyncGenerator<AISSEEvent, void, unknown>

  /**
   * Fetch the user's resolved entitlements (plan limits, ACU cap, feature flags).
   * Backed by `GET /me/entitlements` on the Edge API billing chassis.
   */
  fetchEntitlements(signal?: AbortSignal): Promise<AIEntitlements>

  /**
   * Fetch the user's current usage (resource counters + ACU consumption).
   * Backed by `GET /me/usage` on the Edge API billing chassis.
   */
  fetchUsage(signal?: AbortSignal): Promise<AIUsage>

  /**
   * Fetch current AI credit status.
   *
   * @deprecated Use `fetchEntitlements` + `fetchUsage` instead. Kept for one
   * release as a fallback while UI call sites migrate to the new shape.
   */
  fetchCredits(signal?: AbortSignal): Promise<AICreditStatus>

  /**
   * Send a telemetry event (fire-and-forget).
   */
  sendTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): void

  /**
   * Warm the model's prompt cache, once per session, when inline completions are
   * first registered.
   *
   * Fire-and-forget in the strict sense: it must never throw, and its result is
   * never awaited — a cold cache costs a slower first completion, which is not worth
   * delaying the editor for. Optional, because a platform whose backend has no warm
   * endpoint simply omits it and loses nothing but that first-request latency.
   */
  warmCache?(): void

  /**
   * Stored conversations, when the platform has them.
   *
   * Optional as a group: a build with no conversation store still chats, it just
   * cannot reopen what was said yesterday, and the shared UI hides the list rather
   * than showing an empty one. A platform that implements any of these implements
   * all of them — half a store is a rename that silently does nothing.
   *
   * The transcript is deliberately opaque here (`unknown` content blocks): what a
   * message holds is the wire's business, and restating it would be a second copy of
   * a shape the server owns.
   */
  conversations?: {
    list(options?: { projectId?: string; limit?: number; offset?: number }): Promise<AIConversationSummary[]>
    get(id: string): Promise<AIConversationDetail>
    create(input: { projectId?: string; title?: string }): Promise<AIConversationDetail>
    rename(id: string, title: string): Promise<{ id: string; title: string }>
    remove(id: string): Promise<void>
  }
}
