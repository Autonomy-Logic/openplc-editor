/** AI completion request sent to Edge API */
export type AICompleteRequest = {
  /** Code before cursor position */
  prefix: string
  /** Code after cursor position */
  suffix: string
  /** Programming language identifier */
  language: 'st' | 'il' | 'python' | 'cpp'
  /** Additional project context (variables, globals, referenced FBs) */
  projectContext?: string
  /** AI model to use */
  model?: 'haiku' | 'sonnet'
  /** Maximum tokens to generate */
  maxTokens?: number
}

/** AI chat request sent to Edge API */
export type AIChatRequest = {
  /** Conversation messages */
  messages: AIChatMessage[]
  /** Current POU context */
  pouContext?: string
  /** Programming language of the current POU */
  language?: 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd'
  /** AI model to use */
  model?: 'haiku' | 'sonnet'
}

/** Chat message format for API requests */
export type AIChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** SSE event types from the streaming API */
export type AISSEEvent =
  | { type: 'content_block_delta'; delta: string }
  | { type: 'message_stop' }
  | { type: 'error'; error: string }

/** Credit status response from /api/ai/credits */
export type AICreditStatus = {
  credits_used: number
  credits_total: number
  tier: 'free' | 'pro'
  current_period_end: string | null
}

/** All trackable telemetry event names */
export type AITelemetryEventName =
  | 'completion_requested'
  | 'completion_shown'
  | 'completion_accepted'
  | 'completion_dismissed'
  | 'completion_error'
  | 'completion_timeout'
  | 'chat_message'
  | 'chat_rating'

/** Telemetry event sent to /api/ai/telemetry */
export type AITelemetryEvent = {
  event: AITelemetryEventName
  data: Record<string, unknown>
}

/** Error response from AI endpoints */
export type AIErrorResponse = {
  error: string
  retry_after?: number
}
