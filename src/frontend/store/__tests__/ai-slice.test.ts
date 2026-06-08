import { createStore, StoreApi } from 'zustand/vanilla'

import { createAISlice, createAISliceFactory } from '../slices/ai/slice'
import type { AISlice, ChatMessage } from '../slices/ai/types'

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
      expect(ai.acuUsed).toBe(0)
      expect(ai.acuTotal).toBe(0)
      expect(ai.subscriptionStatus).toBeNull()
      expect(ai.planSlug).toBeNull()
      expect(ai.creditsUsed).toBe(0)
      expect(ai.creditsTotal).toBe(500)
      expect(ai.tier).toBe('free')
      expect(ai.currentPeriodEnd).toBeNull()
      expect(ai.billingError).toBeNull()
      expect(ai.messages).toEqual([])
      expect(ai.activeEditorPou).toBeNull()
      expect(ai.isAgenticLoopRunning).toBe(false)
      expect(ai.isChatOpen).toBe(false)
      expect(ai.error).toBeNull()
      expect(ai.preferences).toEqual({ inlineCompletionsEnabled: true })
      expect(ai.pendingDiffs).toEqual({})
      expect(ai.conversationId).toBeNull()
      expect(ai.conversations).toEqual([])
      expect(ai.isLoadingConversation).toBe(false)
    })
  })

  describe('setPreference', () => {
    it('toggles inlineCompletionsEnabled off', () => {
      store.getState().aiActions.setPreference('inlineCompletionsEnabled', false)
      expect(store.getState().ai.preferences.inlineCompletionsEnabled).toBe(false)
    })

    it('toggles inlineCompletionsEnabled back on', () => {
      store.getState().aiActions.setPreference('inlineCompletionsEnabled', false)
      store.getState().aiActions.setPreference('inlineCompletionsEnabled', true)
      expect(store.getState().ai.preferences.inlineCompletionsEnabled).toBe(true)
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

  describe('setUsage', () => {
    it('writes the new ACU fields', () => {
      store.getState().aiActions.setUsage(42, 1000)
      expect(store.getState().ai.acuUsed).toBe(42)
      expect(store.getState().ai.acuTotal).toBe(1000)
    })

    it('mirrors to deprecated creditsUsed/creditsTotal so unmigrated consumers stay in sync', () => {
      store.getState().aiActions.setUsage(42, 1000)
      expect(store.getState().ai.creditsUsed).toBe(42)
      expect(store.getState().ai.creditsTotal).toBe(1000)
    })
  })

  describe('setSubscription', () => {
    it('sets subscriptionStatus, currentPeriodEnd, and planSlug together', () => {
      store.getState().aiActions.setSubscription('active', '2026-06-01', 'community')
      const { ai } = store.getState()
      expect(ai.subscriptionStatus).toBe('active')
      expect(ai.currentPeriodEnd).toBe('2026-06-01')
      expect(ai.planSlug).toBe('community')
    })

    it('accepts null for all three fields (e.g. on logout)', () => {
      store.getState().aiActions.setSubscription('active', '2026-06-01', 'community')
      store.getState().aiActions.setSubscription(null, null, null)
      const { ai } = store.getState()
      expect(ai.subscriptionStatus).toBeNull()
      expect(ai.currentPeriodEnd).toBeNull()
      expect(ai.planSlug).toBeNull()
    })
  })

  describe('setCredits (deprecated)', () => {
    it('sets both used and total credits', () => {
      store.getState().aiActions.setCredits(42, 1000)
      expect(store.getState().ai.creditsUsed).toBe(42)
      expect(store.getState().ai.creditsTotal).toBe(1000)
    })

    it('mirrors to new acuUsed/acuTotal so consumers migrated ahead of their call sites stay correct', () => {
      store.getState().aiActions.setCredits(42, 1000)
      expect(store.getState().ai.acuUsed).toBe(42)
      expect(store.getState().ai.acuTotal).toBe(1000)
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

  describe('setBillingError', () => {
    it('sets the structured 402 payload', () => {
      store.getState().aiActions.setBillingError({
        code: 'insufficient_acu',
        message: 'Out of ACU',
        remaining: 0,
        required: 12,
        monthlyLimit: 613,
      })
      const { billingError } = store.getState().ai
      expect(billingError?.code).toBe('insufficient_acu')
      expect(billingError?.required).toBe(12)
      expect(billingError?.monthlyLimit).toBe(613)
    })

    it('clears the billing error when passed null', () => {
      store.getState().aiActions.setBillingError({
        code: 'subscription_inactive',
        message: 'Payment failed',
        subscriptionStatus: 'past_due',
      })
      store.getState().aiActions.setBillingError(null)
      expect(store.getState().ai.billingError).toBeNull()
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

  describe('setActiveEditorPou', () => {
    it('sets the active editor POU name', () => {
      store.getState().aiActions.setActiveEditorPou('MainProgram')
      expect(store.getState().ai.activeEditorPou).toBe('MainProgram')
    })

    it('clears the active editor POU', () => {
      store.getState().aiActions.setActiveEditorPou('MainProgram')
      store.getState().aiActions.setActiveEditorPou(null)
      expect(store.getState().ai.activeEditorPou).toBeNull()
    })
  })

  describe('setAgenticLoopRunning', () => {
    it('sets the agentic loop to running', () => {
      store.getState().aiActions.setAgenticLoopRunning(true)
      expect(store.getState().ai.isAgenticLoopRunning).toBe(true)
    })

    it('sets the agentic loop to not running', () => {
      store.getState().aiActions.setAgenticLoopRunning(true)
      store.getState().aiActions.setAgenticLoopRunning(false)
      expect(store.getState().ai.isAgenticLoopRunning).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Message management (project-scoped)
  // ---------------------------------------------------------------------------

  describe('addMessage', () => {
    it('adds a message to the flat messages array', () => {
      const msg = makeMessage({ id: 'msg-1', role: 'user', content: 'Help me' })
      store.getState().aiActions.addMessage(msg)

      const messages = store.getState().ai.messages
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(msg)
    })

    it('appends multiple messages in order', () => {
      const msg1 = makeMessage({ id: 'msg-1' })
      const msg2 = makeMessage({ id: 'msg-2', role: 'assistant', content: 'Sure' })

      store.getState().aiActions.addMessage(msg1)
      store.getState().aiActions.addMessage(msg2)

      const messages = store.getState().ai.messages
      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe('msg-1')
      expect(messages[1].id).toBe('msg-2')
    })

    it('retains every appended message without truncation', () => {
      const total = 75
      for (let i = 0; i < total; i++) {
        store.getState().aiActions.addMessage(makeMessage({ id: `msg-${i}`, content: `Message ${i}` }))
      }

      const messages = store.getState().ai.messages
      expect(messages).toHaveLength(total)
      expect(messages[0].id).toBe('msg-0')
      expect(messages[total - 1].id).toBe(`msg-${total - 1}`)
    })
  })

  describe('updateMessageContent', () => {
    it('updates the content of an existing message', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1', content: 'initial' }))
      store.getState().aiActions.updateMessageContent('msg-1', 'updated content')

      expect(store.getState().ai.messages[0].content).toBe('updated content')
    })

    it('does nothing when the message id does not match', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1', content: 'original' }))
      store.getState().aiActions.updateMessageContent('msg-999', 'changed')

      expect(store.getState().ai.messages[0].content).toBe('original')
    })

    it('does nothing when there are no messages', () => {
      store.getState().aiActions.updateMessageContent('msg-1', 'content')
      expect(store.getState().ai.messages).toHaveLength(0)
    })
  })

  describe('rateMessage', () => {
    it('sets a thumbs-up rating', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('msg-1', 'up')

      expect(store.getState().ai.messages[0].rating).toBe('up')
    })

    it('sets a thumbs-down rating', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('msg-1', 'down')

      expect(store.getState().ai.messages[0].rating).toBe('down')
    })

    it('clears the rating when set to undefined', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('msg-1', 'up')
      store.getState().aiActions.rateMessage('msg-1', undefined)

      expect(store.getState().ai.messages[0].rating).toBeUndefined()
    })

    it('does nothing when the message id does not match', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.rateMessage('msg-999', 'up')

      expect(store.getState().ai.messages[0].rating).toBeUndefined()
    })

    it('does nothing when there are no messages', () => {
      store.getState().aiActions.rateMessage('msg-1', 'up')
      expect(store.getState().ai.messages).toHaveLength(0)
    })
  })

  describe('clearConversation', () => {
    it('clears messages, error, and the active conversation id', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-2' }))
      store.getState().aiActions.setAIError('some error')
      store.getState().aiActions.setConversationId('conv-1')

      store.getState().aiActions.clearConversation()

      expect(store.getState().ai.messages).toHaveLength(0)
      expect(store.getState().ai.error).toBeNull()
      expect(store.getState().ai.conversationId).toBeNull()
    })

    it('is a no-op on empty state (no error)', () => {
      store.getState().aiActions.clearConversation()
      expect(store.getState().ai.messages).toHaveLength(0)
      expect(store.getState().ai.error).toBeNull()
      expect(store.getState().ai.conversationId).toBeNull()
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

  // ---------------------------------------------------------------------------
  // Pending diff review (per-POU)
  // ---------------------------------------------------------------------------

  describe('pendingDiffs', () => {
    const sampleEntry = {
      oldBody: 'OLD',
      newBody: 'NEW',
      hunks: [{ id: 'h1', type: 'added' as const, startLine: 1, endLine: 1, newLines: ['NEW'], oldLines: [] }],
      acceptedHunks: ['h1'],
    }

    it('defaults to empty object', () => {
      expect(store.getState().ai.pendingDiffs).toEqual({})
    })

    it('setPendingDiff writes an entry keyed by POU name', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      expect(store.getState().ai.pendingDiffs.main).toEqual(sampleEntry)
    })

    it('supports multiple POUs simultaneously', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      store.getState().aiActions.setPendingDiff('helper', { ...sampleEntry, oldBody: 'OLD2' })
      expect(Object.keys(store.getState().ai.pendingDiffs)).toEqual(['main', 'helper'])
    })

    it('updatePendingDiffAcceptedHunks updates only the acceptedHunks of an existing entry', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      store.getState().aiActions.updatePendingDiffAcceptedHunks('main', [])
      expect(store.getState().ai.pendingDiffs.main.acceptedHunks).toEqual([])
      expect(store.getState().ai.pendingDiffs.main.newBody).toBe('NEW')
    })

    it('updatePendingDiffAcceptedHunks is a no-op for missing POU', () => {
      store.getState().aiActions.updatePendingDiffAcceptedHunks('nope', ['x'])
      expect(store.getState().ai.pendingDiffs.nope).toBeUndefined()
    })

    it('updatePendingDiff replaces newBody + hunks + acceptedHunks atomically', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      const freshHunks = [
        { id: 'h2', type: 'modified' as const, startLine: 2, endLine: 2, newLines: ['X'], oldLines: ['Y'] },
      ]
      store
        .getState()
        .aiActions.updatePendingDiff('main', { newBody: 'NEWER', hunks: freshHunks, acceptedHunks: ['h2'] })
      const entry = store.getState().ai.pendingDiffs.main
      expect(entry.newBody).toBe('NEWER')
      expect(entry.hunks).toEqual(freshHunks)
      expect(entry.acceptedHunks).toEqual(['h2'])
      // Old body preserved
      expect(entry.oldBody).toBe('OLD')
    })

    it('updatePendingDiff is a no-op for missing POU', () => {
      store.getState().aiActions.updatePendingDiff('nope', { newBody: 'x', hunks: [], acceptedHunks: [] })
      expect(store.getState().ai.pendingDiffs.nope).toBeUndefined()
    })

    it('clearPendingDiff removes a specific POU entry', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      store.getState().aiActions.setPendingDiff('helper', sampleEntry)
      store.getState().aiActions.clearPendingDiff('main')
      expect(store.getState().ai.pendingDiffs.main).toBeUndefined()
      expect(store.getState().ai.pendingDiffs.helper).toBeDefined()
    })

    it('clearAllPendingDiffs resets to empty', () => {
      store.getState().aiActions.setPendingDiff('main', sampleEntry)
      store.getState().aiActions.setPendingDiff('helper', sampleEntry)
      store.getState().aiActions.clearAllPendingDiffs()
      expect(store.getState().ai.pendingDiffs).toEqual({})
    })
  })

  // ---------------------------------------------------------------------------
  // Conversation management (DOPE-2)
  // ---------------------------------------------------------------------------

  describe('conversation management', () => {
    const summaryA = {
      id: 'conv-a',
      title: 'Refactor motor control',
      lastModel: 'sonnet' as const,
      createdAt: '2026-05-04T10:00:00Z',
      updatedAt: '2026-05-04T11:00:00Z',
    }
    const summaryB = {
      id: 'conv-b',
      title: 'Add timer',
      lastModel: 'sonnet' as const,
      createdAt: '2026-05-04T09:00:00Z',
      updatedAt: '2026-05-04T09:30:00Z',
    }

    describe('setConversationId', () => {
      it('sets the active conversation id', () => {
        store.getState().aiActions.setConversationId('conv-a')
        expect(store.getState().ai.conversationId).toBe('conv-a')
      })

      it('clears the active conversation id when set to null', () => {
        store.getState().aiActions.setConversationId('conv-a')
        store.getState().aiActions.setConversationId(null)
        expect(store.getState().ai.conversationId).toBeNull()
      })
    })

    describe('setConversations', () => {
      it('replaces the conversations list', () => {
        store.getState().aiActions.setConversations([summaryA, summaryB])
        expect(store.getState().ai.conversations).toEqual([summaryA, summaryB])
      })

      it('replaces with an empty list', () => {
        store.getState().aiActions.setConversations([summaryA])
        store.getState().aiActions.setConversations([])
        expect(store.getState().ai.conversations).toEqual([])
      })
    })

    describe('prependConversation', () => {
      it('inserts a new conversation at the top', () => {
        store.getState().aiActions.setConversations([summaryB])
        store.getState().aiActions.prependConversation(summaryA)
        expect(store.getState().ai.conversations.map((c) => c.id)).toEqual(['conv-a', 'conv-b'])
      })

      it('drops a duplicate id before prepending (no double rows)', () => {
        store.getState().aiActions.setConversations([summaryA, summaryB])
        store.getState().aiActions.prependConversation({ ...summaryA, title: 'Renamed' })
        const ids = store.getState().ai.conversations.map((c) => c.id)
        expect(ids).toEqual(['conv-a', 'conv-b'])
        expect(store.getState().ai.conversations[0].title).toBe('Renamed')
      })
    })

    describe('removeConversation', () => {
      it('drops a conversation from the list', () => {
        store.getState().aiActions.setConversations([summaryA, summaryB])
        store.getState().aiActions.removeConversation('conv-a')
        expect(store.getState().ai.conversations).toEqual([summaryB])
      })

      it('clears messages + active id when removing the active conversation', () => {
        store.getState().aiActions.setConversations([summaryA])
        store.getState().aiActions.setConversationId('conv-a')
        store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))

        store.getState().aiActions.removeConversation('conv-a')

        expect(store.getState().ai.conversations).toEqual([])
        expect(store.getState().ai.conversationId).toBeNull()
        expect(store.getState().ai.messages).toHaveLength(0)
      })

      it('keeps messages + active id when removing a different conversation', () => {
        store.getState().aiActions.setConversations([summaryA, summaryB])
        store.getState().aiActions.setConversationId('conv-a')
        store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1' }))

        store.getState().aiActions.removeConversation('conv-b')

        expect(store.getState().ai.conversationId).toBe('conv-a')
        expect(store.getState().ai.messages).toHaveLength(1)
      })

      it('is a no-op for unknown ids', () => {
        store.getState().aiActions.setConversations([summaryA])
        store.getState().aiActions.removeConversation('does-not-exist')
        expect(store.getState().ai.conversations).toEqual([summaryA])
      })
    })

    describe('updateConversationTitle', () => {
      it('updates the title of an existing summary', () => {
        store.getState().aiActions.setConversations([summaryA, summaryB])
        store.getState().aiActions.updateConversationTitle('conv-a', 'New title')
        expect(store.getState().ai.conversations[0].title).toBe('New title')
        expect(store.getState().ai.conversations[1].title).toBe(summaryB.title)
      })

      it('is a no-op for unknown ids', () => {
        store.getState().aiActions.setConversations([summaryA])
        store.getState().aiActions.updateConversationTitle('nope', 'x')
        expect(store.getState().ai.conversations[0].title).toBe(summaryA.title)
      })
    })

    describe('replaceMessages', () => {
      it('replaces the messages list wholesale', () => {
        store.getState().aiActions.addMessage(makeMessage({ id: 'old-1' }))
        const replacement = [
          makeMessage({ id: 'new-1', role: 'user', content: 'one' }),
          makeMessage({ id: 'new-2', role: 'assistant', content: 'two' }),
        ]
        store.getState().aiActions.replaceMessages(replacement)

        expect(store.getState().ai.messages.map((m) => m.id)).toEqual(['new-1', 'new-2'])
      })

      it('clears the error', () => {
        store.getState().aiActions.setAIError('boom')
        store.getState().aiActions.replaceMessages([])
        expect(store.getState().ai.error).toBeNull()
      })

      it('replaces with the full payload without truncation', () => {
        const total = 75
        const many: ChatMessage[] = []
        for (let i = 0; i < total; i++) {
          many.push(makeMessage({ id: `m-${i}`, content: `Message ${i}` }))
        }
        store.getState().aiActions.replaceMessages(many)

        const messages = store.getState().ai.messages
        expect(messages).toHaveLength(total)
        expect(messages[0].id).toBe('m-0')
        expect(messages[total - 1].id).toBe(`m-${total - 1}`)
      })
    })

    describe('setLoadingConversation', () => {
      it('toggles the isLoadingConversation flag', () => {
        store.getState().aiActions.setLoadingConversation(true)
        expect(store.getState().ai.isLoadingConversation).toBe(true)
        store.getState().aiActions.setLoadingConversation(false)
        expect(store.getState().ai.isLoadingConversation).toBe(false)
      })
    })
  })

  describe('updateMessageContent with block array', () => {
    it('replaces a streamed text content with a block array (used at agentic-loop iteration boundary)', () => {
      store.getState().aiActions.addMessage(makeMessage({ id: 'msg-1', role: 'assistant', content: 'streamed text' }))
      const blocks = [
        { type: 'text' as const, text: 'streamed text' },
        { type: 'tool_use' as const, id: 'toolu_1', name: 'create_pou', input: { name: 'Foo' } },
      ]
      store.getState().aiActions.updateMessageContent('msg-1', blocks)

      expect(store.getState().ai.messages[0].content).toEqual(blocks)
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
    const store = createStore<AISlice>()(
      createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: true, inlineCompletionsEnabled: true }),
    )
    const { ai } = store.getState()
    expect(ai.isEnabled).toBe(true)
    expect(ai.hasConsented).toBe(true)
  })

  it('hydrates inlineCompletionsEnabled preference from config', () => {
    const store = createStore<AISlice>()(
      createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: true, inlineCompletionsEnabled: false }),
    )
    expect(store.getState().ai.preferences.inlineCompletionsEnabled).toBe(false)
  })

  it('preserves other default values when config is provided', () => {
    const store = createStore<AISlice>()(
      createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: false, inlineCompletionsEnabled: true }),
    )
    const { ai } = store.getState()
    expect(ai.acuUsed).toBe(0)
    expect(ai.acuTotal).toBe(0)
    expect(ai.subscriptionStatus).toBeNull()
    expect(ai.planSlug).toBeNull()
    expect(ai.creditsUsed).toBe(0)
    expect(ai.creditsTotal).toBe(500)
    expect(ai.tier).toBe('free')
    expect(ai.currentPeriodEnd).toBeNull()
    expect(ai.billingError).toBeNull()
    expect(ai.messages).toEqual([])
    expect(ai.activeEditorPou).toBeNull()
    expect(ai.isAgenticLoopRunning).toBe(false)
    expect(ai.isChatOpen).toBe(false)
    expect(ai.error).toBeNull()
  })

  it('creates functional actions when config is provided', () => {
    const store = createStore<AISlice>()(
      createAISliceFactory({ isFeatureEnabled: true, hasUserConsented: true, inlineCompletionsEnabled: true }),
    )
    store.getState().aiActions.setAIEnabled(false)
    expect(store.getState().ai.isEnabled).toBe(false)
  })
})
