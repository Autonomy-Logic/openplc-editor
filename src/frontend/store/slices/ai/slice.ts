import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { AIFeatureConfig } from '../../../../middleware/shared/ports/types'
import type { AISlice } from './types'
import { MAX_CONVERSATION_MESSAGES } from './types'

const DEFAULT_AI_STATE: AISlice['ai'] = {
  isEnabled: false,
  isLoading: false,
  hasConsented: false,
  model: 'haiku',
  creditsUsed: 0,
  creditsTotal: 500,
  tier: 'free',
  currentPeriodEnd: null,
  conversations: [],
  activeConversationPou: null,
  isChatOpen: false,
  error: null,
}

export function createAISliceFactory(config?: AIFeatureConfig): StateCreator<AISlice, [], [], AISlice> {
  const overrides = config ? { isEnabled: config.isFeatureEnabled, hasConsented: config.hasUserConsented } : {}
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
      setAIModel: (model) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.model = model
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
      setActiveConversationPou: (pouName) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.activeConversationPou = pouName
          }),
        )
      },
      addMessage: (pouName, message) => {
        setState(
          produce(({ ai }: AISlice) => {
            let conversation = ai.conversations.find((c) => c.pouName === pouName)
            if (!conversation) {
              conversation = { pouName, messages: [] }
              ai.conversations.push(conversation)
            }
            conversation.messages.push(message)
            if (conversation.messages.length > MAX_CONVERSATION_MESSAGES) {
              conversation.messages = conversation.messages.slice(-MAX_CONVERSATION_MESSAGES)
            }
          }),
        )
      },
      updateMessageContent: (pouName, messageId, content) => {
        setState(
          produce(({ ai }: AISlice) => {
            const conversation = ai.conversations.find((c) => c.pouName === pouName)
            if (!conversation) return
            const msg = conversation.messages.find((m) => m.id === messageId)
            if (msg) {
              msg.content = content
            }
          }),
        )
      },
      rateMessage: (pouName, messageId, rating) => {
        setState(
          produce(({ ai }: AISlice) => {
            const conversation = ai.conversations.find((c) => c.pouName === pouName)
            if (!conversation) return
            const msg = conversation.messages.find((m) => m.id === messageId)
            if (msg) {
              msg.rating = rating
            }
          }),
        )
      },
      clearConversation: (pouName) => {
        setState(
          produce(({ ai }: AISlice) => {
            ai.conversations = ai.conversations.filter((c) => c.pouName !== pouName)
            if (ai.activeConversationPou === pouName) {
              ai.activeConversationPou = null
              ai.error = null
            }
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
    },
  })
}

const createAISlice: StateCreator<AISlice, [], [], AISlice> = createAISliceFactory()
export { createAISlice }
