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
  /** Whole-program ST transpiler; when omitted, graphical POUs report their ST as unavailable. */
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
  // A local project's path is not an Edge project id; sending it makes the backend 500.
  const projectPath = useOpenPLCStore((s) => s.project.meta.path)
  const projectId = isRemoteProjectPath(projectPath) ? projectPath : undefined
  const abortRef = useRef<AbortController | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [toolStatuses, setToolStatuses] = useState<ToolStatusEntry[]>([])
  // Latched once this turn produces diff hunks; reset per turn and on Keep/Undo.
  const [hadDiffsThisTurn, setHadDiffsThisTurn] = useState(false)

  const pendingDiffCount = Object.keys(aiState.pendingDiffs).length

  useEffect(() => {
    if (pendingDiffCount > 0 && !hadDiffsThisTurn) {
      setHadDiffsThisTurn(true)
    }
  }, [pendingDiffCount, hadDiffsThisTurn])

  // Every POU-dependent slice must be captured, or Undo leaves orphaned tabs/editors/flows.
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

  const pouName = editor.type === 'plc-textual' || editor.type === 'plc-graphical' ? editor.meta.name : null
  const language = editor.type === 'plc-textual' ? editor.meta.language : undefined

  useEffect(() => {
    if (pouName && pouName !== aiState.activeEditorPou) {
      setActiveEditorPou(pouName)
    }
  }, [pouName, aiState.activeEditorPou, setActiveEditorPou])

  // Hydrate entitlements on open so the tier badge doesn't wait for the first send.
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
        // Non-critical; the next successful send refreshes entitlements.
      }
    })()
  }, [ai, accountReady, setUsage, setSubscription])

  const messages = aiState.messages

  const {
    containerRef: messagesContainerRef,
    contentRef: messagesContentRef,
    pin,
    followTail,
  } = useStickToBottom(!!streamingMessageId || aiState.isAgenticLoopRunning)

  // useLayoutEffect so the pin lands before paint; tool rows must follow the tail too.
  useLayoutEffect(() => {
    pin()
  }, [messages, streamingMessageId, toolStatuses, aiState.isAgenticLoopRunning, pin])

  // Only conversationId transitions replace messages; refetches must not.
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
    // The event only reaches the active editor; other POUs may hold pending diffs too.
    clearAllPendingDiffs()
    void executeSaveProject(projectPort, capabilities)
  }, [pouName, projectPort, capabilities, clearAllPendingDiffs])

  const handleUndoAIChanges = useCallback(() => {
    const cp = projectCheckpointRef.current
    if (!cp) return
    if (pouName) {
      window.dispatchEvent(new CustomEvent('ai-reject-all-hunks', { detail: { pouName } }))
    }

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

    // Monaco keeps its own model registry; dispose models for POUs that no longer exist.
    // Word-boundary match so "Main" doesn't protect "MainCalc".
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
    clearAllPendingDiffs()
    setHadDiffsThisTurn(false)
    setAgenticLoopRunning(false)
    // Append the revert note as a single text block, as a reload would produce.
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
      // Guard only: the composer is disabled in this state.
      if (!ai) {
        setAIError('AI is not available on this platform.')
        return
      }

      if (needsSignIn) return

      // Sending re-engages auto-follow wherever the user had scrolled to.
      followTail()

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
      setHadDiffsThisTurn(false)
      setAgenticLoopRunning(true)

      const userMsg = {
        id: uuidv4(),
        role: 'user' as const,
        content: userMessage,
        timestamp: Date.now(),
      }
      addMessage(userMsg)

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

      // Skip empty mid-stream assistant placeholders; the model must not see them.
      const storeState = openPLCStoreBase.getState()
      const hasContent = (content: ChatMessage['content']) =>
        typeof content === 'string' ? content.length > 0 : content.length > 0
      // A transcript ending in an unmatched tool_use makes the API 400 on every resume.
      const apiMessages: AIChatMessage[] = repairToolUseSequence(
        storeState.ai.messages
          .filter((m) => m.role === 'user' || (m.role === 'assistant' && hasContent(m.content)))
          .map((m) => ({ role: m.role, content: m.content })),
      )

      const pou = pouName ? storeState.project.data.pous.find((p) => p.name === pouName) : undefined
      const pouLang = pou?.body.language ?? language ?? 'st'

      // One whole-project transpile serves every graphical POU, not only the active one.
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

      trackChatMessage(ai, {
        language: pouLang,
        model: 'sonnet',
        messageCount: apiMessages.length,
        activeEditor: pouName,
      })

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setAILoading(true)
      setAIError(null)

      // Reset at each iteration_assistant_complete so every iteration gets its own bubble.
      let currentAssistantId: string | null = assistantMsgId
      let accumulated = ''
      // The post-loop refresh must not clear a billing error this very turn raised.
      let loopHadBillingError = false
      try {
        const activeConversationId = openPLCStoreBase.getState().ai.conversationId
        const fullRequest: AIChatRequest = {
          messages: apiMessages,
          pouContext,
          language: (pouLang as AIChatRequest['language']) ?? undefined,
          model: 'sonnet',
          // Without either id, /ai/chat falls through to its stateless behaviour.
          ...(activeConversationId ? { conversationId: activeConversationId } : {}),
          ...(projectId ? { projectId } : {}),
        }

        for await (const event of runAgenticLoop(ai, fullRequest, AI_TOOLS, {
          signal: controller.signal,
          transpileProject,
        })) {
          if (event.type === 'conversation_started') {
            // Mark loaded BEFORE setConversationId, or the load effect wipes the streaming placeholder.
            lastLoadedConversationRef.current = event.conversationId
            setConversationId(event.conversationId)
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
              updateMessageContent(currentAssistantId, event.blocks)
            } else {
              // The model went straight to tool calls; no placeholder exists.
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
            // Persisted as a user-role message so the transcript survives reload; the renderer hides it.
            addMessage({
              id: uuidv4(),
              role: 'user',
              content: event.blocks,
              timestamp: Date.now(),
            })
          }

          if (event.type === 'error') {
            if (currentAssistantId && !accumulated) {
              // Billing copy is composed here; the backend message is not user-facing.
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
            if (event.billing) {
              setBillingError(event.billing)
              loopHadBillingError = true
            }
          }
        }

        // Once per send, not per agentic iteration.
        try {
          const [usage, entitlements] = await Promise.all([ai.fetchUsage(), ai.fetchEntitlements()])
          setUsage(usage.acu.used, usage.acu.monthlyLimit)
          setSubscription(entitlements.source.subscriptionStatus, null, entitlements.source.planSlug)
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
          if (error.billing) {
            setBillingError(error.billing)
          }
        } else if (!(error instanceof Error) || error.name !== 'AbortError') {
          setAIError('An unexpected error occurred.')
        }
      }

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
  // Non-diff mutations have no per-hunk controls; only the bar can keep/revert them.
  const hasNonDiffMutation = toolStatuses.some((s) => s.status === 'success' && isNonDiffMutatingTool(s.toolName))

  // Hides once a diff-only turn has every hunk resolved individually.
  const showKeepUndoBar =
    !aiState.isAgenticLoopRunning &&
    hasMutatingSuccess &&
    (pendingDiffCount > 0 || hasNonDiffMutation || !hadDiffsThisTurn)

  // Auto-finalize a diff-only turn on the last resolved hunk. The
  // `toolStatuses.length` gate stops Keep/Undo's own clearing from re-triggering a save.
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

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {/* `overflow-anchor:none`: browser scroll anchoring fights our own tail pin. */}
        <div
          ref={messagesContainerRef}
          // Focusable so the hook's PageUp/Home/ArrowUp detach actually receives keydown.
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

      {/* Where the build opens the sign-in dialog by itself, no second one is offered. */}
      {needsSignIn && (
        <AIChatSignInNotice
          reason={signInReason}
          onSignIn={capabilities.requiresEdgeAccount ? undefined : () => setSignInOpen(true)}
        />
      )}

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
