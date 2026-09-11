/**
 * Telemetry is a thin layer: name the event, hand it to the port. These tests
 * pin the two things that can silently break — the event name each helper emits,
 * and that the payload reaches the port unmangled.
 *
 * The sink is injected rather than module-mocked. That is what lets one test file
 * run under both runners (jest in the editor, vitest on the web): module mock
 * hoisting is the one thing the two do not agree on.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

import type { AITelemetryEventName } from '../../../../middleware/shared/ports/ai-port'
import {
  type AITelemetrySink,
  startTimer,
  trackAcuExhausted,
  trackChatMessage,
  trackChatRating,
  trackCompletionAccepted,
  trackCompletionDismissed,
  trackCompletionError,
  trackCompletionRequested,
  trackCompletionShown,
  trackCompletionTimeout,
  trackConversationCreated,
  trackConversationDeleted,
  trackConversationLoaded,
  trackConversationRenamed,
  trackUpgradeCtaClicked,
} from '../telemetry'

type SentEvent = { event: AITelemetryEventName; data: Record<string, unknown> }

let sent: SentEvent[] = []
const sink: AITelemetrySink = {
  sendTelemetry(event, data) {
    sent.push({ event, data })
  },
}

beforeEach(() => {
  sent = []
})

describe('startTimer', () => {
  it('returns elapsed milliseconds', () => {
    const timer = startTimer()
    // elapsed returns a rounded number
    expect(typeof timer.elapsed()).toBe('number')
  })
})

describe('tracking functions', () => {
  it('delegates each tracking function to the port with the right event name', () => {
    trackCompletionRequested(sink, {
      language: 'st',
      model: 'haiku',
      prefixLength: 10,
      suffixLength: 5,
      hasProjectContext: true,
    })
    trackCompletionShown(sink, {
      language: 'st',
      model: 'haiku',
      completionLength: 20,
      latencyMs: 100,
      source: 'network',
      ttftMs: 50,
    })
    trackCompletionAccepted(sink, { language: 'st', completionLength: 20 })
    trackCompletionDismissed(sink, { language: 'st', completionLength: 20, shownDurationMs: 500 })
    trackCompletionError(sink, {
      language: 'st',
      model: 'haiku',
      errorType: 'api_error',
      statusCode: 500,
      latencyMs: 200,
    })
    trackCompletionTimeout(sink, { language: 'st', model: 'haiku', timeoutMs: 5000 })
    trackChatMessage(sink, { language: 'st', model: 'haiku', messageCount: 3, activeEditor: 'Main' })
    trackChatRating(sink, { messageId: 'm1', rating: 'up', language: 'st' })
    trackConversationCreated(sink, { conversationId: 'c1', projectId: 'p1', titleLength: 12, model: 'sonnet' })
    trackConversationLoaded(sink, { conversationId: 'c1' })
    trackConversationRenamed(sink, { conversationId: 'c1', newTitleLength: 20 })
    trackConversationDeleted(sink, { conversationId: 'c1' })
    trackAcuExhausted(sink, { source: 'usage_limit', planSlug: 'community', remaining: 0 })
    trackUpgradeCtaClicked(sink, { source: 'modal' })

    expect(sent.map((e) => e.event)).toEqual([
      'completion_requested',
      'completion_shown',
      'completion_accepted',
      'completion_dismissed',
      'completion_error',
      'completion_timeout',
      'chat_message',
      'chat_rating',
      'conversation_created',
      'conversation_loaded',
      'conversation_renamed',
      'conversation_deleted',
      'acu_exhausted',
      'upgrade_cta_clicked',
    ])
  })

  it('trackAcuExhausted carries the source, planSlug, and remaining payload', () => {
    trackAcuExhausted(sink, { source: 'subscription', planSlug: 'plus', remaining: null })
    expect(sent).toEqual([
      { event: 'acu_exhausted', data: { source: 'subscription', planSlug: 'plus', remaining: null } },
    ])
  })

  it('trackUpgradeCtaClicked carries the source payload', () => {
    trackUpgradeCtaClicked(sink, { source: 'modal' })
    expect(sent).toEqual([{ event: 'upgrade_cta_clicked', data: { source: 'modal' } }])
  })
})
