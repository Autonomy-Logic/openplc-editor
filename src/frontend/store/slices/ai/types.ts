import type {
  AIChatContentBlock,
  BillingErrorPayload,
  ChatMessage,
  ChatMessageRole,
  SubscriptionStatus,
} from '../../../../middleware/shared/ports/types'
import type { DiffHunk } from '../../../utils/ai-diff-review'

export type { AIChatContentBlock, BillingErrorPayload, ChatMessage, ChatMessageRole, SubscriptionStatus }

// ---------------------------------------------------------------------------
// Conversation summary (returned by GET /ai/conversations)
// ---------------------------------------------------------------------------

export type ConversationSummary = {
  id: string
  title: string
  lastModel: 'haiku' | 'sonnet' | null
  createdAt: string
  updatedAt: string
}

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
    /** ACU consumed in the current billing period. Replaces `creditsUsed`. */
    acuUsed: number
    /** ACU monthly cap for the active plan. Replaces `creditsTotal`. */
    acuTotal: number
    /**
     * Paddle subscription status from `/me/entitlements`. `null` before the
     * first fetch completes.
     */
    subscriptionStatus: SubscriptionStatus | null
    /** Plan slug from `/me/entitlements` (e.g. `'community'`, `'standard'`). `null` before first fetch. */
    planSlug: string | null
    /**
     * @deprecated Use `acuUsed`. Kept in sync by `setUsage` and the legacy
     * `setCredits` setter for one release.
     */
    creditsUsed: number
    /**
     * @deprecated Use `acuTotal`. Kept in sync by `setUsage` and the legacy
     * `setCredits` setter for one release.
     */
    creditsTotal: number
    /**
     * @deprecated Pre-Paddle tier flag. Use `subscriptionStatus` + `planSlug`.
     * Retained for one release while UI surfaces migrate.
     */
    tier: 'free' | 'pro'
    currentPeriodEnd: string | null
    /**
     * Structured billing error from the most recent 402 (insufficient ACU or
     * inactive subscription). Read by the exhaustion-modal consumer
     * (DOPE-285). `null` while no billing block is active — cleared on the
     * next successful AI request.
     */
    billingError: BillingErrorPayload | null
    messages: ChatMessage[]
    activeEditorPou: string | null
    isAgenticLoopRunning: boolean
    isChatOpen: boolean
    error: string | null
    /** Pending diff review entries, keyed by POU name. */
    pendingDiffs: Record<string, DiffReviewEntry>
    /**
     * Currently-active backend conversation. `null` when the user is
     * starting a fresh chat (the backend creates the conversation on the
     * first /ai/chat call and emits `conversation_started`, after which
     * this id is set so iteration N+1 of the agentic loop can append).
     */
    conversationId: string | null
    /** Recent conversations for the active project, populated by the list query. */
    conversations: ConversationSummary[]
    /** True while a conversation detail (with messages) is being fetched. */
    isLoadingConversation: boolean
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
  /**
   * Set the ACU usage counters from `/me/usage`. Also writes the deprecated
   * `creditsUsed` / `creditsTotal` fields to keep unmigrated consumers in sync.
   */
  setUsage: (used: number, total: number) => void
  /**
   * Set the subscription source fields from `/me/entitlements`. `null` clears
   * them (e.g. on logout or before the first fetch resolves).
   */
  setSubscription: (status: SubscriptionStatus | null, currentPeriodEnd: string | null, planSlug: string | null) => void
  /**
   * @deprecated Use `setUsage`. Writes to both legacy (`creditsUsed`/`creditsTotal`)
   * and new (`acuUsed`/`acuTotal`) fields during the deprecation window.
   */
  setCredits: (used: number, total: number) => void
  /**
   * @deprecated Use `setSubscription`. `tier` is the pre-Paddle 'free'|'pro'
   * flag; the new Paddle world uses `subscriptionStatus` + `planSlug`.
   */
  setTier: (tier: 'free' | 'pro') => void
  setCurrentPeriodEnd: (date: string | null) => void
  /**
   * Set or clear the structured 402 payload. Called by the chat panel /
   * inline completion provider when an AIRequestError(402) surfaces, and
   * cleared (passed `null`) on the next successful request.
   */
  setBillingError: (error: BillingErrorPayload | null) => void
  setAIError: (error: string | null) => void
  setActiveEditorPou: (pouName: string | null) => void
  setAgenticLoopRunning: (running: boolean) => void
  addMessage: (message: ChatMessage) => void
  updateMessageContent: (messageId: string, content: string | AIChatContentBlock[]) => void
  rateMessage: (messageId: string, rating: 'up' | 'down' | undefined) => void
  clearConversation: () => void
  toggleChat: () => void
  setChatOpen: (open: boolean) => void
  setPendingDiff: (pouName: string, entry: DiffReviewEntry) => void
  updatePendingDiffAcceptedHunks: (pouName: string, acceptedHunks: string[]) => void
  updatePendingDiff: (pouName: string, update: { newBody: string; hunks: DiffHunk[]; acceptedHunks: string[] }) => void
  clearPendingDiff: (pouName: string) => void
  clearAllPendingDiffs: () => void
  /** Set the active backend conversation id (or null on "+ New chat"). */
  setConversationId: (id: string | null) => void
  /** Replace the conversation list (typically called after a list query resolves). */
  setConversations: (conversations: ConversationSummary[]) => void
  /** Insert a new conversation summary at the top of the list (after creation). */
  prependConversation: (conversation: ConversationSummary) => void
  /** Drop a conversation from the list by id (after delete). */
  removeConversation: (id: string) => void
  /** Update a conversation summary's title (after rename). */
  updateConversationTitle: (id: string, title: string) => void
  /** Replace the message list wholesale (used when loading a persisted conversation). */
  replaceMessages: (messages: ChatMessage[]) => void
  setLoadingConversation: (loading: boolean) => void
}

// ---------------------------------------------------------------------------
// AI slice
// ---------------------------------------------------------------------------

export type AISlice = AIState & {
  aiActions: AIActions
}
