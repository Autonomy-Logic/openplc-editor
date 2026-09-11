import { useQueryClient } from '@tanstack/react-query'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { AIRequestError } from '../../../../../middleware/shared/ports/ai-port'
import type { ChatMessage } from '../../../../../middleware/shared/ports/types'
import { isRemoteProjectPath } from '../../../../../middleware/shared/ports/types'
import { useAI, useCapabilities, useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'
import { runAgenticLoop } from '../../../../services/ai/agentic-loop'
import { collectFullProjectContext, isGraphicalLanguage } from '../../../../services/ai/context-collector'
import { useConversation } from '../../../../services/ai/conversations'
import {
  extractPouST,
  generateFBDLayoutMetadata,
  generateGraphicalContext,
  generateLadderLayoutMetadata,
  type ProjectStTranspiler,
  transpileProjectToST,
} from '../../../../services/ai/graphical-context'
import { repairToolUseSequence } from '../../../../services/ai/repair-tool-use-sequence'
import { trackChatMessage, trackConversationCreated, trackConversationLoaded } from '../../../../services/ai/telemetry'
import { AI_TOOLS, isMutatingTool, isNonDiffMutatingTool } from '../../../../services/ai/tools'
import type { AIChatMessage, AIChatRequest } from '../../../../services/ai/types'
import { executeSaveProject } from '../../../../services/save-actions'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../store'
import type { EditorSlice } from '../../../../store/slices/editor'
import type { FBDFlowSlice } from '../../../../store/slices/fbd'
import type { FileSlice } from '../../../../store/slices/file'
import type { LadderFlowSlice } from '../../../../store/slices/ladder'
import type { LibrarySlice } from '../../../../store/slices/library'
import type { ProjectSlice } from '../../../../store/slices/project'
import type { TabsSlice } from '../../../../store/slices/tabs'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { AIChatInput } from './ai-chat-input'
import { AIChatTurn } from './ai-chat-message'
import { AIChatSignInNotice } from './ai-chat-sign-in'
import { groupMessagesIntoTurns } from './ai-chat-turns'
import { AIConversationList } from './ai-conversation-list'
import { AISettingsPopover } from './ai-settings-popover'
import { AITierBadge } from './ai-tier-badge'
import { AIToolStatus, type ToolStatusEntry } from './ai-tool-status'
import { useAssistantAccess } from './use-assistant-access'
import { useStickToBottom } from './use-stick-to-bottom'

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type AIChatPanelProps = {
  /**
   * Turns the project into whole-program ST, so the model can read a ladder or
   * FBD diagram as code. Platform-supplied: the transpiler runs on a Web Worker
   * in the browser and in the main process on the desktop. Omitted, graphical
   * POUs simply report that their ST is unavailable — which is what this panel
   * already showed whenever a transpile failed.
   */
  transpileProject?: ProjectStTranspiler
}

export const AIChatPanel = ({ transpileProject }: AIChatPanelProps = {}) => {
  const aiState = useOpenPLCStore.useAi()
  const editor = useOpenPLCStore.useEditor()
  const {
    setChatOpen,
    setActiveEditorPou,
    addMessage,
    updateMessageContent,
    clearConversation,
    setAgenticLoopRunning,
    setAILoading,
    setAIError,
    setUsage,
    setSubscription,
    setBillingError,
    clearAllPendingDiffs,
    setConversationId,
    replaceMessages,
    setLoadingConversation,
  } = useOpenPLCStore.useAiActions()

  const projectPort = useProject()
  const capabilities = useCapabilities()
  const ai = useAI()
  const edgeAccount = useEdgeAccountPort()
  const {
    needsSignIn,
    ready: accountReady,
    reason: signInReason,
    noteRefusal,
    signedIn: onSignedIn,
  } = useAssistantAccess(capabilities, edgeAccount)
  const [signInOpen, setSignInOpen] = useState(false)
  const queryClient = useQueryClient()
  /**
   * Which project on Autonomy Edge this conversation belongs to, or nothing.
   *
   * The web used to read the router's `?project_id=`; the desktop has no router
   * and does not depend on `@tanstack/react-router`. `project.meta.path` carries
   * the same identifier on both — but ONLY for a project that lives on Edge. On
   * the desktop it is an absolute path on disk for a local project, and sending
   * that as a project id asks the backend to attach a conversation to a project
   * it has never heard of: it answers 500 and the whole message fails. Found by
   * driving the desktop build against staging, where every request from a local
   * project came back "Internal server error".
   *
   * Absent is the correct answer for a local project rather than a degradation:
   * the conversation store is keyed by Edge project, a project on disk has no
   * entry in it, and the backend simply keeps the conversation unattached.
   */
  const projectPath = useOpenPLCStore((s) => s.project.meta.path)
  const projectId = isRemoteProjectPath(projectPath) ? projectPath : undefined
  const abortRef = useRef<AbortController | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [toolStatuses, setToolStatuses] = useState<ToolStatusEntry[]>([])
  /**
   * Whether the current AI turn produced any reviewable diff hunks. Latched
   * true while `pendingDiffs` is non-empty and reset at the start of each turn
   * (and on Keep/Undo). Lets us tell "this turn never made diffs" (keep the
   * bar) apart from "every diff has now been individually accepted/rejected"
   * (hide the bar) — see `showKeepUndoBar` and the finalize effect below.
   */
  const [hadDiffsThisTurn, setHadDiffsThisTurn] = useState(false)

  // Number of POUs with unresolved diff hunks. Drives both the Keep/Undo bar
  // visibility and the auto-finalize when the user resolves the last hunk.
  const pendingDiffCount = Object.keys(aiState.pendingDiffs).length

  // Latch `hadDiffsThisTurn` once hunks appear. (Resolving them later sets the
  // count back to 0 but leaves the latch set until the next turn / Keep / Undo.)
  useEffect(() => {
    if (pendingDiffCount > 0 && !hadDiffsThisTurn) {
      setHadDiffsThisTurn(true)
    }
  }, [pendingDiffCount, hadDiffsThisTurn])

  /**
   * Snapshot of every POU-dependent slice, captured before the agentic loop runs.
   * On "Undo changes" we restore all of these atomically so orphaned tabs/editors/flows
   * don't survive the rollback (the old code only captured `project.data`).
   */
  type AICheckpoint = {
    projectData: ProjectSlice['project']['data']
    tabs: TabsSlice['tabs']
    selectedTab: TabsSlice['selectedTab']
    editors: EditorSlice['editors']
    editor: EditorSlice['editor']
    ladderFlows: LadderFlowSlice['ladderFlows']
    fbdFlows: FBDFlowSlice['fbdFlows']
    libraries: LibrarySlice['libraries']
    files: FileSlice['files']
  }
  const projectCheckpointRef = useRef<AICheckpoint | null>(null)

  // Derive the active POU name from the editor
  const pouName = editor.type === 'plc-textual' || editor.type === 'plc-graphical' ? editor.meta.name : null
  const language = editor.type === 'plc-textual' ? editor.meta.language : undefined

  // Track which editor is active (for context building, not conversation routing)
  useEffect(() => {
    if (pouName && pouName !== aiState.activeEditorPou) {
      setActiveEditorPou(pouName)
    }
  }, [pouName, aiState.activeEditorPou, setActiveEditorPou])

  // Hydrate ACU usage + subscription source once the account is known good, so the
  // tier badge (and any usage readout) reflects the live plan immediately on
  // open instead of waiting for the first chat send to refresh it.
  const didHydrateEntitlementsRef = useRef(false)
  useEffect(() => {
    if (!ai || !accountReady) return
    if (didHydrateEntitlementsRef.current) return
    didHydrateEntitlementsRef.current = true
    void (async () => {
      try {
        const [usage, entitlements] = await Promise.all([ai.fetchUsage(), ai.fetchEntitlements()])
        setUsage(usage.acu.used, usage.acu.monthlyLimit)
        setSubscription(entitlements.source.subscriptionStatus, null, entitlements.source.planSlug)
      } catch {
        // Non-critical — the badge falls back to the default tier until the
        // next successful send refreshes entitlements.
      }
    })()
  }, [ai, accountReady, setUsage, setSubscription])

  // Project-scoped messages (single conversation)
  const messages = aiState.messages

  /**
   * Sticky-bottom transcript, same contract as the Console
   * (`frontend/components/_organisms/console/index.tsx`): follow the tail
   * while attached, append silently once the user scrolls up, re-attach when
   * they scroll back down. `active` is the turn-in-flight signal that drives
   * the per-frame re-assert; see the hook for why attachment is decided from
   * gestures rather than from scroll-event geometry.
   */
  const {
    containerRef: messagesContainerRef,
    contentRef: messagesContentRef,
    pin,
    followTail,
  } = useStickToBottom(!!streamingMessageId || aiState.isAgenticLoopRunning)

  /**
   * Pin on new content. `useLayoutEffect` so the write lands before paint.
   * Depends on the streaming id and tool-status list as well as the messages
   * so tool blocks and the "AI is working" row follow the tail too.
   */
  useLayoutEffect(() => {
    pin()
  }, [messages, streamingMessageId, toolStatuses, aiState.isAgenticLoopRunning, pin])

  // Conversation loading: when the active conversationId changes to a value
  // that hasn't been loaded yet, fetch the transcript and replace the slice's
  // messages in one shot. The lastLoadedRef guards against re-loading on every
  // refetch — only transitions trigger a replace.
  const lastLoadedConversationRef = useRef<string | null>(null)
  const { data: loadedConversation, isLoading: isLoadingConversationData } = useConversation(aiState.conversationId)
  useEffect(() => {
    if (
      loadedConversation &&
      lastLoadedConversationRef.current !== loadedConversation.id &&
      loadedConversation.id === aiState.conversationId
    ) {
      replaceMessages(
        loadedConversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.createdAt).getTime(),
          ...(m.rating ? { rating: m.rating } : {}),
          conversationId: loadedConversation.id,
        })),
      )
      lastLoadedConversationRef.current = loadedConversation.id
    }
  }, [loadedConversation, aiState.conversationId, replaceMessages])
  useEffect(() => {
    if (aiState.conversationId === null) {
      lastLoadedConversationRef.current = null
    }
  }, [aiState.conversationId])
  useEffect(() => {
    setLoadingConversation(isLoadingConversationData && !!aiState.conversationId)
  }, [isLoadingConversationData, aiState.conversationId, setLoadingConversation])

  const handleSelectConversation = useCallback(
    (id: string) => {
      // Setting the id triggers the useConversation query above. Clearing
      // messages here gives instant feedback while the fetch resolves.
      setConversationId(id)
      replaceMessages([])
      if (ai) trackConversationLoaded(ai, { conversationId: id })
    },
    [ai, setConversationId, replaceMessages],
  )

  const handleInsertAtCursor = useCallback((code: string) => {
    window.dispatchEvent(new CustomEvent('ai-insert-at-cursor', { detail: code }))
  }, [])

  const handleKeepChanges = useCallback(() => {
    projectCheckpointRef.current = null
    setToolStatuses([])
    setHadDiffsThisTurn(false)
    if (pouName) {
      window.dispatchEvent(new CustomEvent('ai-accept-all-hunks', { detail: { pouName } }))
    }
    // Also clear any pending diffs on non-active POUs (the event above only
    // reaches the active editor; other POUs may have pending entries from the
    // same agentic turn that need clearing too).
    clearAllPendingDiffs()
    void executeSaveProject(projectPort, capabilities)
  }, [pouName, projectPort, capabilities, clearAllPendingDiffs])

  const handleUndoAIChanges = useCallback(() => {
    const cp = projectCheckpointRef.current
    if (!cp) return
    if (pouName) {
      window.dispatchEvent(new CustomEvent('ai-reject-all-hunks', { detail: { pouName } }))
    }

    // Restore every POU-dependent slice atomically so tabs, editor models, flows,
    // library entries, and file save-state can't reference POUs that no longer exist.
    openPLCStoreBase.setState((state) => ({
      ...state,
      project: { ...state.project, data: structuredClone(cp.projectData) },
      tabs: structuredClone(cp.tabs),
      selectedTab: cp.selectedTab,
      editors: structuredClone(cp.editors),
      editor: structuredClone(cp.editor),
      ladderFlows: structuredClone(cp.ladderFlows),
      fbdFlows: structuredClone(cp.fbdFlows),
      libraries: structuredClone(cp.libraries),
      files: structuredClone(cp.files),
    }))

    // Dispose Monaco text models whose POU no longer exists post-restore. Removing them
    // from the `editors[]` slice isn't enough — Monaco's own path-keyed registry keeps them
    // alive and they'd leak memory (or worse, re-surface if a new POU is created with the
    // same name). Use a word-boundary match so "Main" doesn't accidentally protect "MainCalc".
    const validModelNames = new Set(cp.editors.map((e) => e.meta.name))
    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString()
      const stillValid = Array.from(validModelNames).some((name) => {
        const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeForRegExp(name)}([^A-Za-z0-9_]|$)`)
        return pattern.test(uri)
      })
      if (!stillValid) {
        model.dispose()
      }
    }

    projectCheckpointRef.current = null
    // Checkpoint restore reverts every POU-dependent slice, so every pending
    // diff entry is now referring to text that no longer exists. Clear them all.
    clearAllPendingDiffs()
    setHadDiffsThisTurn(false)
    setAgenticLoopRunning(false)
    // Append revert note to the last assistant message. Handle both string
    // content (plain text) and block array content (post-DOPE-3) by extracting
    // the prose, appending the marker, and rewriting as a single text block —
    // mirrors what a reload would produce.
    const lastMsg = aiState.messages[aiState.messages.length - 1]
    if (lastMsg?.role === 'assistant') {
      const existingText =
        typeof lastMsg.content === 'string'
          ? lastMsg.content
          : lastMsg.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
      updateMessageContent(lastMsg.id, `${existingText}\n\n_Changes reverted._`)
    }
    setToolStatuses([])
  }, [pouName, aiState.messages, updateMessageContent, setAgenticLoopRunning, clearAllPendingDiffs])

  const handleSend = useCallback(
    async (userMessage: string) => {
      // No transport, no turn. The composer is disabled in this state, so this
      // is a guard rather than a path a user can reach.
      if (!ai) {
        setAIError('AI is not available on this platform.')
        return
      }

      // The composer is disabled in this state; a guard, not a path a user can reach.
      if (needsSignIn) return

      // Sending re-engages auto-follow regardless of where the user had
      // scrolled to: they just asked a question, so they want to see the
      // answer. Mirrors the Console's one-shot `followRequestId` kick.
      followTail()

      // Snapshot every POU-dependent slice before tool execution. On Undo we restore
      // all of these atomically so no slice can orphan-reference a deleted POU.
      const snapshotState = openPLCStoreBase.getState()
      projectCheckpointRef.current = {
        projectData: structuredClone(snapshotState.project.data),
        tabs: structuredClone(snapshotState.tabs),
        selectedTab: snapshotState.selectedTab,
        editors: structuredClone(snapshotState.editors),
        editor: structuredClone(snapshotState.editor),
        ladderFlows: structuredClone(snapshotState.ladderFlows),
        fbdFlows: structuredClone(snapshotState.fbdFlows),
        libraries: structuredClone(snapshotState.libraries),
        files: structuredClone(snapshotState.files),
      }
      // New turn: reset the diff latch so a prior turn's resolved diffs don't
      // make this turn's Keep/Undo bar disappear prematurely.
      setHadDiffsThisTurn(false)
      setAgenticLoopRunning(true)

      // Add user message to store
      const userMsg = {
        id: uuidv4(),
        role: 'user' as const,
        content: userMessage,
        timestamp: Date.now(),
      }
      addMessage(userMsg)

      // Create placeholder for assistant response
      const assistantMsgId = uuidv4()
      const assistantMsg = {
        id: assistantMsgId,
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
      setStreamingMessageId(assistantMsgId)
      setToolStatuses([])

      // Build messages array for API. Skip empty assistant placeholders
      // (`content: ''` or `content: []`) which exist mid-stream — sending
      // them back to Anthropic would confuse the model.
      const storeState = openPLCStoreBase.getState()
      const hasContent = (content: ChatMessage['content']) =>
        typeof content === 'string' ? content.length > 0 : content.length > 0
      // Heal broken tool_use/tool_result pairings before sending. A
      // conversation interrupted mid-agentic-loop can be persisted ending in a
      // tool_use with no matching tool_result; re-sending that verbatim makes
      // Anthropic 400 on every resume. The backend repairs this too — this is
      // a client-side guard so a stale build can't send a broken sequence.
      const apiMessages: AIChatMessage[] = repairToolUseSequence(
        storeState.ai.messages
          .filter((m) => m.role === 'user' || (m.role === 'assistant' && hasContent(m.content)))
          .map((m) => ({ role: m.role, content: m.content })),
      )

      // Resolve language from POU data
      const pou = pouName ? storeState.project.data.pous.find((p) => p.name === pouName) : undefined
      const pouLang = pou?.body.language ?? language ?? 'st'

      // Collect full project context with the active editor POU highlighted.
      //
      // Graphical POUs (LD/FBD/SFC) store an XYFlow graph, not source, so they
      // are represented by their transpiled ST. One whole-project transpile
      // serves every graphical POU — the previous code transpiled the same
      // program and then threw away everything except the active POU, leaving
      // every other diagram in the project represented by variable names alone.
      const graphicalPous = storeState.project.data.pous.filter((p) => isGraphicalLanguage(p.body.language))
      let graphicalSt: Map<string, string> | undefined
      if (graphicalPous.length > 0) {
        const programSt = await transpileProjectToST(storeState.project.data, transpileProject)
        if (programSt) {
          graphicalSt = new Map<string, string>()
          for (const p of graphicalPous) {
            const st = extractPouST(programSt, p.name, p.pouType)
            if (st) graphicalSt.set(p.name, st)
          }
        }
      }

      const projectCtx = collectFullProjectContext(storeState, pouName, { graphicalSt })

      let pouContext: string | undefined
      const isGraphical = pouLang === 'ld' || pouLang === 'fbd'
      if (pouName && isGraphical) {
        const pouType = pou?.pouType ?? 'program'
        const stCode = graphicalSt?.get(pouName) ?? null

        let layoutMetadata: string
        if (pouLang === 'ld') {
          const ladderFlow = storeState.ladderFlows.find((f) => f.name === pouName)
          layoutMetadata = ladderFlow ? generateLadderLayoutMetadata(ladderFlow) : '(* Ladder flow not found *)'
        } else {
          const fbdFlow = storeState.fbdFlows.find((f) => f.name === pouName)
          layoutMetadata = fbdFlow ? generateFBDLayoutMetadata(fbdFlow) : '(* FBD flow not found *)'
        }

        pouContext = generateGraphicalContext(pouName, pouType, pouLang, stCode, layoutMetadata, projectCtx)
      } else {
        pouContext = projectCtx
      }

      // Track telemetry
      trackChatMessage(ai, {
        language: pouLang,
        model: 'sonnet',
        messageCount: apiMessages.length,
        activeEditor: pouName,
      })

      // Run the agentic loop with tool-use support
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setAILoading(true)
      setAIError(null)

      // Track the message currently being streamed into. Starts as the
      // placeholder created above for iteration 1; resets at each
      // iteration_assistant_complete; the next text_delta after a reset
      // creates a fresh assistant placeholder so each iteration becomes its
      // own bubble (matches the on-reload view).
      let currentAssistantId: string | null = assistantMsgId
      let accumulated = ''
      // Tracks whether the agentic loop yielded a billing error event. When
      // true, the post-loop refresh path skips its "clear billingError on
      // success" step — otherwise the modal pops for ~200ms before the
      // refresh promise resolves and silently dismisses it.
      let loopHadBillingError = false
      try {
        // Read the latest conversationId from the slice on each send (might have
        // been set by a prior turn's `conversation_started` event).
        const activeConversationId = openPLCStoreBase.getState().ai.conversationId
        const fullRequest: AIChatRequest = {
          messages: apiMessages,
          pouContext,
          language: (pouLang as AIChatRequest['language']) ?? undefined,
          model: 'sonnet',
          // Backend persistence: at least one of the two must be present.
          // Both are optional from the backend's perspective — if neither is
          // sent, /ai/chat falls through to its stateless behavior.
          ...(activeConversationId ? { conversationId: activeConversationId } : {}),
          ...(projectId ? { projectId } : {}),
        }

        for await (const event of runAgenticLoop(ai, fullRequest, AI_TOOLS, {
          signal: controller.signal,
          transpileProject,
        })) {
          if (event.type === 'conversation_started') {
            // Mark the just-created conversation as "already loaded" BEFORE
            // setConversationId fires the useConversation query — otherwise
            // the load effect would refetch the half-persisted transcript
            // (only the user turn at this point) and replaceMessages would
            // wipe the streaming placeholder + any text already received.
            lastLoadedConversationRef.current = event.conversationId
            setConversationId(event.conversationId)
            // The new conversation isn't in the project's list yet; refresh.
            if (projectId) {
              void queryClient.invalidateQueries({ queryKey: ['ai-conversations', projectId] })
            }
            trackConversationCreated(ai, {
              conversationId: event.conversationId,
              projectId: projectId ?? null,
              titleLength: event.conversationTitle.length,
              model: 'sonnet',
            })
          }

          if (event.type === 'text_delta') {
            if (!currentAssistantId) {
              currentAssistantId = uuidv4()
              addMessage({
                id: currentAssistantId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
              })
              setStreamingMessageId(currentAssistantId)
              accumulated = ''
            }
            accumulated += event.text
            updateMessageContent(currentAssistantId, accumulated)
          }

          if (event.type === 'iteration_assistant_complete') {
            if (currentAssistantId) {
              // Freeze the streaming string into a block array so reload
              // can restore the full assistant turn (text + tool_use).
              updateMessageContent(currentAssistantId, event.blocks)
            } else {
              // No streaming placeholder for this iteration (rare — the
              // model went straight to tool calls). Add a message wholesale.
              addMessage({
                id: uuidv4(),
                role: 'assistant',
                content: event.blocks,
                timestamp: Date.now(),
              })
            }
            currentAssistantId = null
            accumulated = ''
          }

          if (event.type === 'tool_call_start') {
            setToolStatuses((prev) => [...prev, { toolId: event.toolId, toolName: event.toolName, status: 'running' }])
          }

          if (event.type === 'tool_call_complete') {
            setToolStatuses((prev) =>
              prev.map((s) =>
                s.toolId === event.toolId
                  ? { ...s, status: event.result.success ? 'success' : 'error', result: event.result }
                  : s,
              ),
            )
          }

          if (event.type === 'iteration_tool_results_complete') {
            // Persist tool_result blocks as a user-role message so the
            // agentic-loop transcript survives reload. The visible UX
            // doesn't render these in the bubble flow — toolStatuses
            // already shows the live spinner row, and the renderer hides
            // tool_result blocks.
            addMessage({
              id: uuidv4(),
              role: 'user',
              content: event.blocks,
              timestamp: Date.now(),
            })
          }

          if (event.type === 'error') {
            if (currentAssistantId && !accumulated) {
              // For 402 billing blocks, compose user-facing copy from the
              // structured payload — the backend `CreditGuard` message still
              // references the descoped Haiku model quick-switch (DOPE-288)
              // and would confuse the user. For all other errors, surface
              // the message as-is.
              let bubbleText: string
              if (noteRefusal(event.status)) {
                bubbleText = 'Sign in to Autonomy Edge to use the assistant.'
              } else if (event.billing?.code === 'subscription_inactive') {
                bubbleText = 'Your subscription is no longer active. Reactivate it to keep using AI features.'
              } else if (event.billing?.code === 'insufficient_acu') {
                bubbleText = "You're out of ACU. Buy more ACU or upgrade your plan to keep going."
              } else if (event.billing?.code === 'rate_limit_exceeded') {
                bubbleText =
                  'You’ve reached the AI usage limit for now. Wait until it resets, or upgrade your plan for a higher limit.'
              } else {
                bubbleText = `Error: ${event.error}`
              }
              updateMessageContent(currentAssistantId, bubbleText)
            }
            // The agentic-loop forwards `AIRequestError.billing` through the
            // error event when a 402 surfaces mid-loop. Lift it onto the slice
            // so AcuExhaustionModal pops — without this, the user only sees
            // the bubble error and never gets the upgrade CTA.
            if (event.billing) {
              setBillingError(event.billing)
              loopHadBillingError = true
            }
          }
        }

        // Refresh ACU usage + subscription source after the loop completes.
        // Done once per chat send (not per agentic iteration) — the loop can
        // run many tool round-trips per user prompt; refreshing each iteration
        // would hammer the chassis pointlessly. `/me/entitlements` doesn't
        // expose `currentPeriodEnd` today; DOPE-285 can add a separate
        // /me/subscription fetch if its modal copy needs the reset date.
        try {
          const [usage, entitlements] = await Promise.all([ai.fetchUsage(), ai.fetchEntitlements()])
          setUsage(usage.acu.used, usage.acu.monthlyLimit)
          setSubscription(entitlements.source.subscriptionStatus, null, entitlements.source.planSlug)
          // Clear any prior 402 billing block on a clean send — but NOT when
          // this very turn produced one (otherwise the exhaustion modal pops
          // and immediately dismisses when this refresh resolves).
          if (!loopHadBillingError) {
            setBillingError(null)
          }
        } catch {
          // Non-critical
        }
      } catch (error) {
        if (error instanceof AIRequestError) {
          noteRefusal(error.status)
          setAIError(error.message)
          // Any structured billing/limit payload (402 insufficient_acu /
          // subscription_inactive, or 429 rate_limit_exceeded) pops the
          // exhaustion modal with the right copy + CTA.
          if (error.billing) {
            setBillingError(error.billing)
          }
        } else if (!(error instanceof Error) || error.name !== 'AbortError') {
          setAIError('An unexpected error occurred.')
        }
      }

      // If we never streamed any text and never got an iteration completion
      // (i.e. the original placeholder is still empty), surface a fallback.
      const finalState = openPLCStoreBase.getState().ai
      const stillEmptyPlaceholder = finalState.messages.find(
        (m) => m.id === assistantMsgId && (m.content === '' || (Array.isArray(m.content) && m.content.length === 0)),
      )
      if (stillEmptyPlaceholder) {
        updateMessageContent(assistantMsgId, 'Unable to get a response from the AI service. Please try again.')
      }

      setStreamingMessageId(null)
      setAgenticLoopRunning(false)
      setAILoading(false)
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    },
    [
      ai,
      needsSignIn,
      noteRefusal,
      pouName,
      language,
      projectId,
      transpileProject,
      addMessage,
      updateMessageContent,
      setAgenticLoopRunning,
      setAILoading,
      setAIError,
      setUsage,
      setSubscription,
      setBillingError,
      setConversationId,
      queryClient,
      followTail,
    ],
  )

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreamingMessageId(null)
    setAgenticLoopRunning(false)
    setAILoading(false)
  }, [setAgenticLoopRunning, setAILoading])

  const handleClear = useCallback(() => {
    clearConversation()
  }, [clearConversation])

  const hasMutatingSuccess = toolStatuses.some((s) => s.status === 'success' && isMutatingTool(s.toolName))
  // A non-diff mutation (variable/datatype CRUD, POU deletion) leaves changes
  // that have no per-hunk controls, so they can only be kept/reverted from the
  // bar — keep it visible even after all hunks are resolved.
  const hasNonDiffMutation = toolStatuses.some((s) => s.status === 'success' && isNonDiffMutatingTool(s.toolName))

  // Show the Keep/Undo bar while there are unresolved AI changes. Once a
  // diff-only turn has every hunk individually accepted/rejected
  // (`pendingDiffCount === 0` after `hadDiffsThisTurn` latched), there's
  // nothing left for the bulk bar to act on, so it hides. Turns that produced
  // no diffs (`!hadDiffsThisTurn`) or any non-diff mutation keep the bar.
  const showKeepUndoBar =
    !aiState.isAgenticLoopRunning &&
    hasMutatingSuccess &&
    (pendingDiffCount > 0 || hasNonDiffMutation || !hadDiffsThisTurn)

  // Finalize a diff-only turn once the user resolves the last hunk: persist the
  // per-hunk decisions (same as "Keep changes") and clear the turn state so the
  // bar — already hidden by `showKeepUndoBar` — stays gone. Gated on
  // `!hasNonDiffMutation` so turns with structural changes still require an
  // explicit Keep/Undo, and on `toolStatuses.length` so Keep/Undo's own
  // clearing doesn't re-trigger a save.
  useEffect(() => {
    if (
      !aiState.isAgenticLoopRunning &&
      hadDiffsThisTurn &&
      pendingDiffCount === 0 &&
      !hasNonDiffMutation &&
      toolStatuses.length > 0
    ) {
      setHadDiffsThisTurn(false)
      projectCheckpointRef.current = null
      setToolStatuses([])
      void executeSaveProject(projectPort, capabilities)
    }
  }, [
    aiState.isAgenticLoopRunning,
    hadDiffsThisTurn,
    pendingDiffCount,
    hasNonDiffMutation,
    toolStatuses,
    projectPort,
    capabilities,
  ])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'>
      {/* Header */}
      <header className='flex h-10 items-center gap-2 border-b border-neutral-100 pl-3 pr-2 dark:border-white/5'>
        <span className='text-[13px] font-semibold tracking-[0.01em] text-neutral-900 dark:text-white'>AI Chat</span>
        <AITierBadge />
        <div className='flex-1' />
        {messages.length > 0 && (
          <button
            type='button'
            onClick={handleClear}
            className='rounded px-2 py-1 text-[12px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
            title='Clear conversation'
          >
            Clear
          </button>
        )}
        {/* Hidden outright on a platform with no conversation store — an empty
            switcher would just be a dead control. */}
        {ai?.conversations && (
          <AIConversationList
            projectId={projectId}
            currentConversationId={aiState.conversationId}
            onSelect={handleSelectConversation}
            onNewChat={handleClear}
          />
        )}
        <AISettingsPopover />
        <button
          type='button'
          onClick={() => setChatOpen(false)}
          className='grid h-[26px] w-[26px] place-items-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
          title='Close chat'
        >
          <svg
            width='15'
            height='15'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M18 6 6 18M6 6l12 12' />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {/* `overflow-anchor:none`: we pin the tail ourselves, and the browser's
            scroll anchoring moves `scrollTop` on its own as the streamed
            markdown reflows, which fights that pin. */}
        <div
          ref={messagesContainerRef}
          // A scrollable region has to be reachable by keyboard, and the
          // transcript is the one part of this panel a keyboard user needs to
          // move through independently of the composer. It also makes the
          // hook's PageUp/Home/ArrowUp detach real: `keydown` bubbles up from
          // the focused element, so without a focus target of its own the
          // container never saw those keys.
          tabIndex={0}
          role='log'
          aria-label='Conversation'
          className='focus-visible:ring-brand/40 min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none [overflow-anchor:none] focus-visible:ring-1'
        >
          {messages.length === 0 ? (
            <div className='px-7 pb-7 pt-20 text-center'>
              <div className='mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand to-blue-500 text-white shadow-[0_8px_24px_-8px_rgba(4,100,251,0.6)]'>
                <svg
                  width='22'
                  height='22'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.75'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <path d='M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8' />
                </svg>
              </div>
              <div className='mb-1.5 text-[17px] font-semibold text-neutral-900 dark:text-white'>
                Ask about your project
              </div>
              <p className='mx-auto max-w-[320px] text-[12.5px] leading-[1.55] text-neutral-500 dark:text-neutral-400'>
                The AI can create POUs, add variables, explain code, and edit your project.
              </p>
            </div>
          ) : (
            <div ref={messagesContentRef} className='flex min-w-0 flex-col gap-3 px-3.5 pb-2 pt-4'>
              {groupMessagesIntoTurns(messages, streamingMessageId).map((turn) => (
                <AIChatTurn
                  key={turn.kind === 'user' ? turn.message.id : turn.id}
                  turn={turn}
                  language={language}
                  onInsertAtCursor={handleInsertAtCursor}
                />
              ))}
              {aiState.isAgenticLoopRunning && <AIToolStatus />}
            </div>
          )}
        </div>
        {showKeepUndoBar && (
          <div className='flex shrink-0 gap-2 border-t border-neutral-100 bg-white px-3.5 py-2.5 dark:border-white/5 dark:bg-neutral-950'>
            <button
              type='button'
              onClick={handleKeepChanges}
              className='rounded-md bg-brand px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-medium-dark'
              title='Save the project with AI changes'
            >
              Keep changes
            </button>
            <button
              type='button'
              onClick={handleUndoAIChanges}
              className='rounded-md border border-neutral-300 bg-transparent px-3.5 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-white/20 dark:text-white dark:hover:bg-white/[0.08]'
              title='Revert all changes made by the AI in this turn'
            >
              Undo changes
            </button>
          </div>
        )}
      </div>

      {/* No session, no assistant: the way in sits where the answer would have been.
          Where the build opens the sign-in dialog by itself, no second one is offered. */}
      {needsSignIn && (
        <AIChatSignInNotice
          reason={signInReason}
          onSignIn={capabilities.requiresEdgeAccount ? undefined : () => setSignInOpen(true)}
        />
      )}

      {/* Input */}
      <AIChatInput
        onSend={(msg) => void handleSend(msg)}
        onCancel={handleCancel}
        isLoading={!!streamingMessageId}
        disabled={!ai || needsSignIn}
        disabledReason={needsSignIn ? 'Sign in to Autonomy Edge to use the assistant.' : undefined}
      />

      {needsSignIn && edgeAccount && !capabilities.requiresEdgeAccount && (
        <EdgeSignInModal
          open={signInOpen}
          onOpenChange={setSignInOpen}
          account={edgeAccount}
          reason={signInReason}
          onSignedIn={() => {
            setSignInOpen(false)
            onSignedIn()
          }}
        />
      )}
    </div>
  )
}
