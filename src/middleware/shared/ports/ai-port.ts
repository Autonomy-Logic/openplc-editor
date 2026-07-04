/**
 * AIPort — Contract for AI-assisted coding features (inline completions, chat, credits, telemetry).
 *
 * The shared UI depends only on this interface. Platform adapters provide concrete
 * implementations that handle HTTP streaming, SSE parsing, and API authentication.
 */

import type { AIEntitlements, AIFeatureConfig, AIUsage } from './types'

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

/** Chat request parameters. */
export interface AIChatParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  pouContext?: string
  language?: AIChatLanguage
  model?: 'haiku' | 'sonnet'
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
   * Register an inline completion provider with the given Monaco instance.
   * All AI logic (provider creation, caching, store subscriptions) is handled internally.
   * Returns a disposable to tear down the provider, or null if not supported.
   *
   * @param monacoInstance - The Monaco editor module (typed as unknown to avoid coupling)
   */
  registerInlineCompletions?(params: { monacoInstance: unknown; pouName: string; language: AICompletionLanguage }): {
    dispose: () => void
  }
}
