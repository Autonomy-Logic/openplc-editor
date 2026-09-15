/** Types the AI feature owns. Wire shapes live on `AIPort` (both builds speak them) and are re-exported here under this feature's names. */

import type {
  AIChatMessageParam,
  AIChatParams,
  AISSEEvent,
  AITelemetryEventName,
  AIToolDefinition,
} from '../../../middleware/shared/ports/ai-port'
import type {
  AIChatContentBlock,
  AIEntitlements,
  AIUsage,
  BillingErrorPayload,
  EntitlementSource,
  PlanFeatures,
  PlanLevelSlug,
  SubscriptionStatus,
  UsageCounter,
} from '../../../middleware/shared/ports/types'

/** One turn of the transcript, as the API wants it. */
export type AIChatMessage = AIChatMessageParam

/** A whole chat request: transcript, context, and the tools the model may call. */
export type AIChatRequest = AIChatParams

/** Content block for structured messages (tool_use, tool_result). */
export type { AIChatContentBlock }

/** Streaming frames, tool definitions and telemetry names — all port contracts. */
export type { AISSEEvent, AITelemetryEventName, AIToolDefinition }

/** Billing/entitlement response types re-exported from the ports layer. */
export type {
  AIEntitlements,
  AIUsage,
  BillingErrorPayload,
  EntitlementSource,
  PlanFeatures,
  PlanLevelSlug,
  SubscriptionStatus,
  UsageCounter,
}
