/** Wire shapes live on `AIPort`; this file re-exports them under the AI feature's own names. */

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

export type AIChatMessage = AIChatMessageParam

export type AIChatRequest = AIChatParams

export type { AIChatContentBlock }

export type { AISSEEvent, AITelemetryEventName, AIToolDefinition }

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
