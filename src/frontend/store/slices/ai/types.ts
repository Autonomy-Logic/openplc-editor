import type { ChatMessage, ChatMessageRole } from '../../../../middleware/shared/ports/types'
import type { DiffHunk } from '../../../utils/ai-diff-review'

export type { ChatMessage, ChatMessageRole }

// ---------------------------------------------------------------------------
// AI message types
// ---------------------------------------------------------------------------

export type AIAction = 'complete' | 'chat'

// ---------------------------------------------------------------------------
// User preferences (persisted to localStorage)
// ---------------------------------------------------------------------------

export type AIPreferences = {
  inlineCompletionsEnabled: boolean
}

// ---------------------------------------------------------------------------
// Per-POU pending diff review state
// ---------------------------------------------------------------------------

/**
 * Snapshot of a POU's diff review session. One entry exists per POU with
 * unresolved hunks — stored by POU name so the user can switch tabs freely
 * and still return to pending reviews.
 *
 * `acceptedHunks` holds the ids of hunks that are still pending (the name is
 * historical — see handleKeepHunk/handleUndoHunk in monaco/index.tsx, which
 * pre-dates this lift-to-store). Accepting a hunk removes its id; rejecting
 * rebuilds the body and recomputes the remaining hunks.
 */
export type DiffReviewEntry = {
  oldBody: string
  newBody: string
  hunks: DiffHunk[]
  acceptedHunks: string[]
}

// ---------------------------------------------------------------------------
// AI state
// ---------------------------------------------------------------------------

export type AIState = {
  ai: {
    isEnabled: boolean
    isLoading: boolean
    hasConsented: boolean
    preferences: AIPreferences
    creditsUsed: number
    creditsTotal: number
    tier: 'free' | 'pro'
    currentPeriodEnd: string | null
    messages: ChatMessage[]
    activeEditorPou: string | null
    isAgenticLoopRunning: boolean
    isChatOpen: boolean
    error: string | null
    /** Pending diff review entries, keyed by POU name. */
    pendingDiffs: Record<string, DiffReviewEntry>
  }
}

// ---------------------------------------------------------------------------
// AI actions
// ---------------------------------------------------------------------------

export type AIActions = {
  setAIEnabled: (enabled: boolean) => void
  setAILoading: (loading: boolean) => void
  setAIConsented: (consented: boolean) => void
  setPreference: <K extends keyof AIPreferences>(key: K, value: AIPreferences[K]) => void
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
  setPendingDiff: (pouName: string, entry: DiffReviewEntry) => void
  updatePendingDiffAcceptedHunks: (pouName: string, acceptedHunks: string[]) => void
  updatePendingDiff: (pouName: string, update: { newBody: string; hunks: DiffHunk[]; acceptedHunks: string[] }) => void
  clearPendingDiff: (pouName: string) => void
  clearAllPendingDiffs: () => void
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
