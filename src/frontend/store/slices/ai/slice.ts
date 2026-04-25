import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { AIFeatureConfig } from '../../../../middleware/shared/ports/types'
import type { AISlice } from './types'
import { MAX_CONVERSATION_MESSAGES } from './types'

const DEFAULT_AI_STATE: AISlice['ai'] = {
  isEnabled: false,
  isLoading: false,
  hasConsented: false,
  preferences: {
    inlineCompletionsEnabled: true,
  },
  creditsUsed: 0,
  creditsTotal: 500,
  tier: 'free',
  currentPeriodEnd: null,
  messages: [],
  activeEditorPou: null,
  isAgenticLoopRunning: false,
  isChatOpen: false,
  error: null,
  pendingDiffs: {},
}

export function createAISliceFactory(config?: AIFeatureConfig): StateCreator<AISlice, [], [], AISlice> {
  const overrides = config
    ? {
        isEnabled: config.isFeatureEnabled,
        hasConsented: config.hasUserConsented,
        preferences: { inlineCompletionsEnabled: config.inlineCompletionsEnabled },
      }
    : {}
  return (setState) => ({
    ai: { ...DEFAULT_AI_STATE, ...overrides },

    aiActions: {
      setAIEnabled: (enabled) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isEnabled = enabled
          }),
        )
      },
      setAILoading: (loading) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isLoading = loading
          }),
        )
      },
      setAIConsented: (consented) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.hasConsented = consented
          }),
        )
      },
      setPreference: (key, value) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.preferences[key] = value
          }),
        )
      },
      setCredits: (used, total) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.creditsUsed = used
            ai.creditsTotal = total
          }),
        )
      },
      setTier: (tier) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.tier = tier
          }),
        )
      },
      setCurrentPeriodEnd: (date) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.currentPeriodEnd = date
          }),
        )
      },
      setAIError: (error) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.error = error
          }),
        )
      },
      setActiveEditorPou: (pouName) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.activeEditorPou = pouName
          }),
        )
      },
      setAgenticLoopRunning: (running) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isAgenticLoopRunning = running
          }),
        )
      },
      addMessage: (message) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.messages.push(message)
            if (ai.messages.length > MAX_CONVERSATION_MESSAGES) {
              ai.messages = ai.messages.slice(-MAX_CONVERSATION_MESSAGES)
            }
          }),
        )
      },
      updateMessageContent: (messageId, content) => {
        setState(
          produce(({ ai }: AISlice) => {
            const msg = ai.messages.find((m) => m.id === messageId)
            if (msg) {
              msg.content = content
            }
          }),
        )
      },
      rateMessage: (messageId, rating) => {
        setState(
          produce(({ ai }: AISlice) => {
            const msg = ai.messages.find((m) => m.id === messageId)
            if (msg) {
              msg.rating = rating
            }
          }),
        )
      },
      clearConversation: () => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.messages = []
            ai.error = null
          }),
        )
      },
      toggleChat: () => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isChatOpen = !ai.isChatOpen
          }),
        )
      },
      setChatOpen: (open) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isChatOpen = open
          }),
        )
      },
      setPendingDiff: (pouName, entry) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.pendingDiffs[pouName] = entry
          }),
        )
      },
      updatePendingDiffAcceptedHunks: (pouName, acceptedHunks) => {
        setState(
          produce(({ ai }: AISlice) => {
            const existing = ai.pendingDiffs[pouName]
            if (!existing) return
            existing.acceptedHunks = acceptedHunks
          }),
        )
      },
      updatePendingDiff: (pouName, { newBody, hunks, acceptedHunks }) => {
        setState(
          produce(({ ai }: AISlice) => {
            const existing = ai.pendingDiffs[pouName]
            if (!existing) return
            existing.newBody = newBody
            existing.hunks = hunks
            existing.acceptedHunks = acceptedHunks
          }),
        )
      },
      clearPendingDiff: (pouName) => {
        setState(
          produce(({ ai }: AISlice) => {
            delete ai.pendingDiffs[pouName]
          }),
        )
      },
      clearAllPendingDiffs: () => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.pendingDiffs = {}
          }),
        )
      },
    },
  })
}

const createAISlice: StateCreator<AISlice, [], [], AISlice> = createAISliceFactory()
export { createAISlice }
