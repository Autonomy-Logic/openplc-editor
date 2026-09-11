/**
 * Types the AI feature owns — the agentic loop, the tools, and the shapes the
 * chat UI hands around.
 *
 * The WIRE shapes are not here: `AIChatParams`, `AIChatMessageParam`,
 * `AIToolDefinition`, `AISSEEvent`, `AICreditStatus` and `AITelemetryEventName`
 * live on `AIPort`, because both builds now speak them and a shape known only to
 * one adapter cannot cross the desktop's IPC boundary. They are re-exported here
 * under the names this feature has always used, so a call site reads the same on
 * either side of the move.
 */

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

/**
 * Content block for structured messages (tool_use, tool_result). Canonical
 * definition lives in `middleware/shared/ports/types.ts` so both shared UI
 * and the adapters agree on shape. Re-exported here for backwards-compat.
 */
export type { AIChatContentBlock }

/** Streaming frames, tool definitions and telemetry names — all port contracts. */
export type { AISSEEvent, AITelemetryEventName, AIToolDefinition }

/**
 * Billing/entitlement response types re-exported from the ports layer so
 * consumers within the feature can import from a single nearby location
 * (mirrors how `AIChatContentBlock` is re-exported above).
 */
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
