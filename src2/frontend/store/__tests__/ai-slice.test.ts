import { createStore, StoreApi } from 'zustand/vanilla'

import { createAISlice, createAISliceFactory } from '../slices/ai/slice'
import type { AISlice, ChatMessage } from '../slices/ai/types'
import { MAX_CONVERSATION_MESSAGES } from '../slices/ai/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): StoreApi<AISlice> {
  return createStore<AISlice>()(createAISlice)
}

function makeMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides?.id ?? 'msg-1',
    role: overrides?.role ?? 'user',
    content: overrides?.content ?? 'Hello',
    timestamp: overrides?.timestamp ?? Date.now(),
    ...(overrides?.rating !== undefined ? { rating: overrides.rating } : {}),
  }
}

describe('createAISlice', () => {
  let store: StoreApi<AISlice>

  beforeEach(() => {
    store = makeStore()
  })

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('has the expected default shape', () => {
      const { ai } = store.getState()
      expect(ai.isEnabled).toBe(false)
      expect(ai.isLoading).toBe(false)
      expect(ai.hasConsented).toBe(false)
      expect(ai.model).toBe('haiku')
      expect(ai.creditsUsed).toBe(0)
      expect(ai.creditsTotal).toBe(500)
      expect(ai.tier).toBe('free')
      expect(ai.currentPeriodEnd).toBeNull()
      expect(ai.conversations).toEqual([])
      expect(ai.activeConversationPou).toBeNull()
      expect(ai.isChatOpen).toBe(false)
      expect(ai.error).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Simple setters
  // ---------------------------------------------------------------------------

  describe('setAIEnabled', () => {
    it('enables AI', () => {
      store.getState().aiActions.setAIEnabled(true)
      expect(store.getState().ai.isEnabled).toBe(true)
    })

    it('disables AI', () => {
      store.getState().aiActions.setAIEnabled(true)
      store.getState().aiActions.setAIEnabled(false)
      expect(store.getState().ai.isEnabled).toBe(false)
    })
  })

  describe('setAILoading', () => {
    it('sets loading to true', () => {
      store.getState().aiActions.setAILoading(true)
      expect(store.getState().ai.isLoading).toBe(true)
    })

    it('sets loading to false', () => {
      store.getState().aiActions.setAILoading(true)
      store.getState().aiActions.setAILoading(false)
      expect(store.getState().ai.isLoading).toBe(false)
    })
  })

  describe('setAIConsented', () => {
    it('sets consented to true', () => {
      store.getState().aiActions.setAIConsented(true)
      expect(store.getState().ai.hasConsented).toBe(true)
    })

    it('sets consented to false', () => {
      store.getState().aiActions.setAIConsented(true)
      store.getState().aiActions.setAIConsented(false)
      expect(store.getState().ai.hasConsented).toBe(false)
    })
  })

  describe('setAIModel', () => {
    it('changes the model to sonnet', () => {
      store.getState().aiActions.setAIModel('sonnet')
      expect(store.getState().ai.model).toBe('sonnet')
    })

    it('changes the model back to haiku', () => {
      store.getState().aiActions.setAIModel('sonnet')
      store.getState().aiActions.setAIModel('haiku')
      expect(store.getState().ai.model).toBe('haiku')
    })
  })

  describe('setCredits', () => {
    it('sets both used and total credits', () => {
      store.getState().aiActions.setCredits(42, 1000)
      expect(store.getState().ai.creditsUsed).toBe(42)
      expect(store.getState().ai.creditsTotal).toBe(1000)
    })
  })

  describe('setTier', () => {
    it('sets tier to pro', () => {
      store.getState().aiActions.setTier('pro')
      expect(store.getState().ai.tier).toBe('pro')
    })

    it('sets tier back to free', () => {
      store.getState().aiActions.setTier('pro')
      store.getState().aiActions.setTier('free')
      expect(store.getState().ai.tier).toBe('free')
    })
  })

  describe('setCurrentPeriodEnd', () => {
    it('sets the period end date', () => {
      store.getState().aiActions.setCurrentPeriodEnd('2026-04-01')
      expect(store.getState().ai.currentPeriodEnd).toBe('2026-04-01')
    })

    it('clears the period end date', () => {
      store.getState().aiActions.setCurrentPeriodEnd('2026-04-01')
      store.getState().aiActions.setCurrentPeriodEnd(null)
      expect(store.getState().ai.currentPeriodEnd).toBeNull()
    })
  })

  describe('setAIError', () => {
    it('sets an error message', () => {
      store.getState().aiActions.setAIError('rate limit exceeded')
      expect(store.getState().ai.error).toBe('rate limit exceeded')
    })

    it('clears the error', () => {
      store.getState().aiActions.setAIError('rate limit exceeded')
      store.getState().aiActions.setAIError(null)
      expect(store.getState().ai.error).toBeNull()
    })
  })

  describe('setActiveConversationPou', () => {
    it('sets the active conversation POU name', () => {
      store.getState().aiActions.setActiveConversationPou('MainProgram')
      expect(store.getState().ai.activeConversationPou).toBe('MainProgram')
    })

    it('clears the active conversation POU', () => {
      store.getState().aiActions.setActiveConversationPou('MainProgram')
      store.getState().aiActions.setActiveConversationPou(null)
      expect(store.getState().ai.activeConversationPou).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Conversation management
  // ---------------------------------------------------------------------------

  describe('addMessage', () => {
    it('creates a new conversation when none exists for the POU', () => {
      const msg = makeMessage({ id: 'msg-1', role: 'user', content: 'Help me' })
      store.getState().aiActions.addMessage('MyPou', msg)

      const conversations = store.getState().ai.conversations
      expect(conversations).toHaveLength(1)
      expect(conversations[0].pouName).toBe('MyPou')
      expect(conversations[0].messages).toHaveLength(1)
      expect(conversations[0].messages[0]).toEqual(msg)
    })

    it('appends to an existing conversation', () => {
      const msg1 = makeMessage({ id: 'msg-1' })
      const msg2 = makeMessage({ id: 'msg-2', role: 'assistant', content: 'Sure' })

      store.getState().aiActions.addMessage('MyPou', msg1)
      store.getState().aiActions.addMessage('MyPou', msg2)

      const conversations = store.getState().ai.conversations
      expect(conversations).toHaveLength(1)
      expect(conversations[0].messages).toHaveLength(2)
      expect(conversations[0].messages[1].id).toBe('msg-2')
    })

    it('keeps separate conversations per POU', () => {
      store.getState().aiActions.addMessage('PouA', makeMessage({ id: 'a-1' }))
      store.getState().aiActions.addMessage('PouB', makeMessage({ id: 'b-1' }))

      const conversations = store.getState().ai.conversations
      expect(conversations).toHaveLength(2)
      expect(conversations[0].pouName).toBe('PouA')
      expect(conversations[1].pouName).toBe('PouB')
    })

    it('enforces MAX_CONVERSATION_MESSAGES by keeping the most recent messages', () => {
      expect(MAX_CONVERSATION_MESSAGES).toBe(20)

      // Add MAX + 5 messages
      for (let i = 0; i < MAX_CONVERSATION_MESSAGES + 5; i++) {
        store.getState().aiActions.addMessage('MyPou', makeMessage({ id: `msg-${i}`, content: `Message ${i}` }))
      }

      const messages = store.getState().ai.conversations[0].messages
      expect(messages).toHaveLength(MAX_CONVERSATION_MESSAGES)
      // The first 5 messages should have been trimmed
      expect(messages[0].id).toBe('msg-5')
      expect(messages[MAX_CONVERSATION_MESSAGES - 1].id).toBe(`msg-${MAX_CONVERSATION_MESSAGES + 4}`)
    })
  })

  describe('updateMessageContent', () => {
    it('updates the content of an existing message', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1', content: 'initial' }))
      store.getState().aiActions.updateMessageContent('MyPou', 'msg-1', 'updated content')

      expect(store.getState().ai.conversations[0].messages[0].content).toBe('updated content')
    })

    it('does nothing when the conversation does not exist', () => {
      store.getState().aiActions.updateMessageContent('NonExistent', 'msg-1', 'content')
      expect(store.getState().ai.conversations).toHaveLength(0)
    })

    it('does nothing when the message id does not match', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1', content: 'original' }))
      store.getState().aiActions.updateMessageContent('MyPou', 'msg-999', 'changed')

      expect(store.getState().ai.conversations[0].messages[0].content).toBe('original')
    })
  })

  describe('rateMessage', () => {
    it('sets a thumbs-up rating', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('MyPou', 'msg-1', 'up')

      expect(store.getState().ai.conversations[0].messages[0].rating).toBe('up')
    })

    it('sets a thumbs-down rating', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('MyPou', 'msg-1', 'down')

      expect(store.getState().ai.conversations[0].messages[0].rating).toBe('down')
    })

    it('clears the rating when set to undefined', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('MyPou', 'msg-1', 'up')
      store.getState().aiActions.rateMessage('MyPou', 'msg-1', undefined)

      expect(store.getState().ai.conversations[0].messages[0].rating).toBeUndefined()
    })

    it('does nothing when the conversation does not exist', () => {
      store.getState().aiActions.rateMessage('NonExistent', 'msg-1', 'up')
      expect(store.getState().ai.conversations).toHaveLength(0)
    })

    it('does nothing when the message id does not match', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('MyPou', 'msg-999', 'up')

      expect(store.getState().ai.conversations[0].messages[0].rating).toBeUndefined()
    })
  })

  describe('clearConversation', () => {
    it('removes the conversation for the given POU', () => {
      store.getState().aiActions.addMessage('PouA', makeMessage({ id: 'a-1' }))
      store.getState().aiActions.addMessage('PouB', makeMessage({ id: 'b-1' }))

      store.getState().aiActions.clearConversation('PouA')

      const conversations = store.getState().ai.conversations
      expect(conversations).toHaveLength(1)
      expect(conversations[0].pouName).toBe('PouB')
    })

    it('clears activeConversationPou and error if it matches the cleared POU', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.setActiveConversationPou('MyPou')
      store.getState().aiActions.setAIError('some error')

      store.getState().aiActions.clearConversation('MyPou')

      expect(store.getState().ai.activeConversationPou).toBeNull()
      expect(store.getState().ai.error).toBeNull()
    })

    it('does not clear activeConversationPou when it does not match', () => {
      store.getState().aiActions.addMessage('PouA', makeMessage({ id: 'a-1' }))
      store.getState().aiActions.addMessage('PouB', makeMessage({ id: 'b-1' }))
      store.getState().aiActions.setActiveConversationPou('PouB')
      store.getState().aiActions.setAIError('preserved error')

      store.getState().aiActions.clearConversation('PouA')

      expect(store.getState().ai.activeConversationPou).toBe('PouB')
      expect(store.getState().ai.error).toBe('preserved error')
    })

    it('is a no-op when the POU has no conversation', () => {
      store.getState().aiActions.addMessage('MyPou', makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.clearConversation('NonExistent')

      expect(store.getState().ai.conversations).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Chat visibility
  // ---------------------------------------------------------------------------

  describe('toggleChat', () => {
    it('opens the chat when closed', () => {
      store.getState().aiActions.toggleChat()
      expect(store.getState().ai.isChatOpen).toBe(true)
    })

    it('closes the chat when open', () => {
      store.getState().aiActions.toggleChat()
      store.getState().aiActions.toggleChat()
      expect(store.getState().ai.isChatOpen).toBe(false)
    })
  })

  describe('setChatOpen', () => {
    it('opens the chat', () => {
      store.getState().aiActions.setChatOpen(true)
      expect(store.getState().ai.isChatOpen).toBe(true)
    })

    it('closes the chat', () => {
      store.getState().aiActions.setChatOpen(true)
      store.getState().aiActions.setChatOpen(false)
      expect(store.getState().ai.isChatOpen).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Factory pattern (createAISliceFactory)
// ---------------------------------------------------------------------------

describe('createAISliceFactory', () => {
  it('uses default state when called without config', () => {
    const store = createStore<AISlice>()(createAISliceFactory())
    const { ai } = store.getState()
    expect(ai.isEnabled).toBe(false)
    expect(ai.hasConsented).toBe(false)
  })

  it('overrides isEnabled and hasConsented from config', () => {
    const store = createStore<AISlice>()(createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: true }))
    const { ai } = store.getState()
    expect(ai.isEnabled).toBe(true)
    expect(ai.hasConsented).toBe(true)
  })

  it('preserves other default values when config is provided', () => {
    const store = createStore<AISlice>()(createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: false }))
    const { ai } = store.getState()
    expect(ai.model).toBe('haiku')
    expect(ai.creditsUsed).toBe(0)
    expect(ai.creditsTotal).toBe(500)
    expect(ai.tier).toBe('free')
    expect(ai.currentPeriodEnd).toBeNull()
    expect(ai.conversations).toEqual([])
    expect(ai.activeConversationPou).toBeNull()
    expect(ai.isChatOpen).toBe(false)
    expect(ai.error).toBeNull()
  })

  it('creates functional actions when config is provided', () => {
    const store = createStore<AISlice>()(createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: true }))
    store.getState().aiActions.setAIEnabled(false)
    expect(store.getState().ai.isEnabled).toBe(false)
  })
})
