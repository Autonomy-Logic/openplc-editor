import type { ChatMessage, ChatMessageRole } from '../../../../middleware/shared/ports/types'

export type { ChatMessage, ChatMessageRole }

// ---------------------------------------------------------------------------
// AI model and message types
// ---------------------------------------------------------------------------

export type AIModel = 'haiku' | 'sonnet'
export type AIAction = 'complete' | 'chat'

// ---------------------------------------------------------------------------
// AI state
// ---------------------------------------------------------------------------

export type AIState = {
  ai: {
    isEnabled: boolean
    isLoading: boolean
    hasConsented: boolean
    model: AIModel
    creditsUsed: number
    creditsTotal: number
    tier: 'free' | 'pro'
    currentPeriodEnd: string | null
    messages: ChatMessage[]
    activeEditorPou: string | null
    isAgenticLoopRunning: boolean
    isChatOpen: boolean
    error: string | null
  }
}

// ---------------------------------------------------------------------------
// AI actions
// ---------------------------------------------------------------------------

export type AIActions = {
  setAIEnabled: (enabled: boolean) => void
  setAILoading: (loading: boolean) => void
  setAIConsented: (consented: boolean) => void
  setAIModel: (model: AIModel) => void
  setCredits: (used: number, total: number) => void
  setTier: (tier: 'free' | 'pro') => void
  setCurrentPeriodEnd: (date: string | null) => void
  setAIError: (error: string | null) => void
  setActiveEditorPou: (pouName: string | null) => void
  setAgenticLoopRunning: (running: boolean) => void
  addMessage: (message: ChatMessage) => void
  updateMessageContent: (messageId: string, content: string) => void
  rateMessage: (messageId: string, rating: 'up' | 'down' | undefined) => void
  clearConversation: () => void
  toggleChat: () => void
  setChatOpen: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// AI slice
// ---------------------------------------------------------------------------

export type AISlice = AIState & {
  aiActions: AIActions
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_CONVERSATION_MESSAGES = 50
