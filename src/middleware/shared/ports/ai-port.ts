/**
 * AIPort — Contract for AI-assisted coding features (inline completions, chat, credits, telemetry).
 *
 * The shared UI depends only on this interface. Platform adapters provide concrete
 * implementations that handle HTTP streaming, SSE parsing, and API authentication.
 */

import type { AIFeatureConfig } from './types'

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

/** Credit status returned by fetchCredits. */
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
  | 'chat_message'
  | 'chat_rating'

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
   * Fetch current AI credit status.
   */
  fetchCredits(signal?: AbortSignal): Promise<AICreditStatus>

  /**
   * Send a telemetry event (fire-and-forget).
   */
  sendTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): void
}
