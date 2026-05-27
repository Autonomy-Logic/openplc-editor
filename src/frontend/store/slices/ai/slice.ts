import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { AIFeatureConfig } from '../../../../middleware/shared/ports/types'
import type { AISlice } from './types'

const DEFAULT_AI_STATE: AISlice['ai'] = {
  isEnabled: false,
  isLoading: false,
  hasConsented: false,
  preferences: {
    inlineCompletionsEnabled: true,
  },
  acuUsed: 0,
  acuTotal: 0,
  subscriptionStatus: null,
  planSlug: null,
  creditsUsed: 0,
  creditsTotal: 500,
  tier: 'free',
  currentPeriodEnd: null,
  billingError: null,
  messages: [],
  activeEditorPou: null,
  isAgenticLoopRunning: false,
  isChatOpen: false,
  error: null,
  pendingDiffs: {},
  conversationId: null,
  conversations: [],
  isLoadingConversation: false,
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
      setUsage: (used, total) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.acuUsed = used
            ai.acuTotal = total
            // Keep deprecated mirror fields in lockstep so unmigrated consumers
            // (DOPE-287 / DOPE-288 still on `creditsUsed`/`creditsTotal`) read
            // the same values. Removed once the rename is fully propagated.
            ai.creditsUsed = used
            ai.creditsTotal = total
          }),
        )
      },
      setSubscription: (status, currentPeriodEnd, planSlug) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.subscriptionStatus = status
            ai.currentPeriodEnd = currentPeriodEnd
            ai.planSlug = planSlug
          }),
        )
      },
      setCredits: (used, total) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.creditsUsed = used
            ai.creditsTotal = total
            // Mirror to the new ACU fields so consumers migrated ahead of their
            // call-site refactor see the right numbers via either name.
            ai.acuUsed = used
            ai.acuTotal = total
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
      setBillingError: (error) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.billingError = error
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
            // Drop the active conversation pointer so the next /ai/chat call
            // is treated as a fresh conversation. The list itself stays —
            // the user can still see prior conversations and resume one.
            ai.conversationId = null
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
      setConversationId: (id) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.conversationId = id
          }),
        )
      },
      setConversations: (conversations) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.conversations = conversations
          }),
        )
      },
      prependConversation: (conversation) => {
        setState(
          produce(({ ai }: AISlice) => {
            // Defensive: drop any existing entry with the same id
            // before prepending so we never end up with duplicates.
            ai.conversations = [conversation, ...ai.conversations.filter((c) => c.id !== conversation.id)]
          }),
        )
      },
      removeConversation: (id) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.conversations = ai.conversations.filter((c) => c.id !== id)
            if (ai.conversationId === id) {
              ai.conversationId = null
              ai.messages = []
            }
          }),
        )
      },
      updateConversationTitle: (id, title) => {
        setState(
          produce(({ ai }: AISlice) => {
            const summary = ai.conversations.find((c) => c.id === id)
            if (summary) {
              summary.title = title
            }
          }),
        )
      },
      replaceMessages: (messages) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.messages = messages
            ai.error = null
          }),
        )
      },
      setLoadingConversation: (loading) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.isLoadingConversation = loading
          }),
        )
      },
    },
  })
}

const createAISlice: StateCreator<AISlice, [], [], AISlice> = createAISliceFactory()
export { createAISlice }
