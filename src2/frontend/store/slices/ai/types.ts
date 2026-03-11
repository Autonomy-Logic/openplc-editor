// ---------------------------------------------------------------------------
// AI model and message types
// ---------------------------------------------------------------------------

export type AIModel = 'haiku' | 'sonnet'
export type AIAction = 'complete' | 'chat'
export type ChatMessageRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  timestamp: number
  rating?: 'up' | 'down'
}

export type ChatConversation = {
  pouName: string
  messages: ChatMessage[]
}

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
    conversations: ChatConversation[]
    activeConversationPou: string | null
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
  setActiveConversationPou: (pouName: string | null) => void
  addMessage: (pouName: string, message: ChatMessage) => void
  updateMessageContent: (pouName: string, messageId: string, content: string) => void
  rateMessage: (pouName: string, messageId: string, rating: 'up' | 'down' | undefined) => void
  clearConversation: (pouName: string) => void
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

export const MAX_CONVERSATION_MESSAGES = 20
