export { AIRequestError, fetchAICredits, sendTelemetry, streamAIRequest } from './api-client'
export { CompletionCache, buildCacheKey, hashString } from './completion-cache'
export { collectProjectContext } from './context-collector'
export {
  startTimer,
  trackChatMessage,
  trackChatRating,
  trackCompletionAccepted,
  trackCompletionDismissed,
  trackCompletionError,
  trackCompletionRequested,
  trackCompletionShown,
  trackCompletionTimeout,
} from './telemetry'
export type { TelemetryTimer } from './telemetry'
export type {
  AIChatMessage,
  AIChatRequest,
  AICompleteRequest,
  AICreditStatus,
  AIErrorResponse,
  AISSEEvent,
  AITelemetryEvent,
  AITelemetryEventName,
} from './types'
