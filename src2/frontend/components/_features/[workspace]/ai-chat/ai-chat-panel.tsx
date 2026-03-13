import { useAIChat } from '../../../../hooks/useAI'
import { collectProjectContext } from '../../../../services/ai/context-collector'
import { trackChatMessage } from '../../../../services/ai/telemetry'
import type { AIChatMessage } from '../../../../services/ai/types'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../store'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { AIChatInput } from './ai-chat-input'
import { AIChatMessage as ChatMessageComponent } from './ai-chat-message'

export const AIChatPanel = () => {
  const aiState = useOpenPLCStore.useAi()
  const editor = useOpenPLCStore.useEditor()
  const { setChatOpen, setActiveConversationPou, addMessage, updateMessageContent, clearConversation } =
    useOpenPLCStore.useAiActions()

  const { chat, cancel } = useAIChat()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [selectedText, setSelectedText] = useState<string | undefined>()
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  // Derive the active POU name from the editor
  const pouName = editor.type === 'plc-textual' || editor.type === 'plc-graphical' ? editor.meta.name : null

  const language = editor.type === 'plc-textual' ? editor.meta.language : undefined

  // Sync active conversation with current POU
  useEffect(() => {
    if (pouName && pouName !== aiState.activeConversationPou) {
      setActiveConversationPou(pouName)
    }
  }, [pouName, aiState.activeConversationPou, setActiveConversationPou])

  // Get current conversation messages
  const conversation = aiState.conversations.find((c) => c.pouName === (pouName ?? aiState.activeConversationPou))
  const messages = conversation?.messages ?? []

  // Auto-scroll to bottom on new messages
  const lastMessageContent = messages[messages.length - 1]?.content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, lastMessageContent])

  // Track selected text in the editor for quick actions
  useEffect(() => {
    const checkSelection = () => {
      const sel = window.getSelection()?.toString()
      setSelectedText(sel && sel.length > 0 ? sel : undefined)
    }

    document.addEventListener('selectionchange', checkSelection)
    return () => document.removeEventListener('selectionchange', checkSelection)
  }, [])

  const handleInsertAtCursor = useCallback((code: string) => {
    // Dispatch a custom event that the Monaco editor can listen to
    window.dispatchEvent(new CustomEvent('ai-insert-at-cursor', { detail: code }))
  }, [])

  const handleSend = useCallback(
    async (userMessage: string) => {
      const activePou = pouName ?? 'general'

      // Add user message to store
      const userMsg = {
        id: uuidv4(),
        role: 'user' as const,
        content: userMessage,
        timestamp: Date.now(),
      }
      addMessage(activePou, userMsg)

      // Create placeholder for assistant response
      const assistantMsgId = uuidv4()
      const assistantMsg = {
        id: assistantMsgId,
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      }
      addMessage(activePou, assistantMsg)
      setStreamingMessageId(assistantMsgId)

      // Build messages array for API (use all messages including the new user message)
      const storeState = openPLCStoreBase.getState()
      const conv = storeState.ai.conversations.find((c) => c.pouName === activePou)
      const apiMessages: AIChatMessage[] = (conv?.messages ?? [])
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map((m) => ({ role: m.role, content: m.content }))

      // Resolve language from POU data (covers graphical editors like FBD/LD)
      const pou = pouName ? storeState.project.data.pous.find((p) => p.name === pouName) : undefined
      const pouLang = pou?.body.language ?? language ?? 'st'

      // Collect project context: POU identity + body + variables/globals/FBs
      let pouContext: string | undefined
      if (pouName) {
        const pouType = pou?.pouType ?? 'program'
        const bodyValue = typeof pou?.body.value === 'string' ? pou.body.value : ''
        const projectCtx = collectProjectContext(storeState, pouName, 4000)

        const parts: string[] = []
        // Always identify which POU the user is working on
        parts.push(`(* Current POU: ${pouName} [${pouType}] language=${pouLang} *)`)
        if (bodyValue) {
          parts.push(bodyValue)
        } else {
          parts.push('(* POU body is empty — no code written yet *)')
        }
        if (projectCtx) {
          parts.push(projectCtx)
        }
        pouContext = parts.join('\n\n')
      }

      // Track telemetry
      trackChatMessage({
        language: pouLang,
        model: aiState.model,
        messageCount: apiMessages.length,
        pouName: activePou,
      })

      // Stream the response
      let accumulated = ''
      await chat(
        {
          messages: apiMessages,
          pouContext,
          language: language as 'st' | 'il' | 'python' | 'cpp' | undefined,
        },
        (token) => {
          accumulated += token
          updateMessageContent(activePou, assistantMsgId, accumulated)
        },
      )

      // If no tokens were received (e.g., request failed), show an error in the placeholder
      if (!accumulated) {
        updateMessageContent(
          activePou,
          assistantMsgId,
          'Unable to get a response from the AI service. Please try again.',
        )
      }

      setStreamingMessageId(null)
    },
    [pouName, language, aiState.model, addMessage, updateMessageContent, chat],
  )

  const handleCancel = useCallback(() => {
    cancel()
    setStreamingMessageId(null)
  }, [cancel])

  const handleClear = useCallback(() => {
    const activePou = pouName ?? aiState.activeConversationPou
    if (activePou) {
      clearConversation(activePou)
    }
  }, [pouName, aiState.activeConversationPou, clearConversation])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden rounded-lg border-2 border-inherit border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'>
      {/* Header */}
      <div className='flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-medium text-neutral-700 dark:text-neutral-200'>AI Chat</span>
          {pouName && (
            <span className='rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'>
              {pouName}
            </span>
          )}
        </div>
        <div className='flex items-center gap-1'>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className='rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
              title='Clear conversation'
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setChatOpen(false)}
            className='rounded p-0.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            title='Close chat'
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path d='M3 3L11 11M11 3L3 11' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className='flex-1 overflow-y-auto p-3'>
        {messages.length === 0 ? (
          <div className='flex h-full items-center justify-center'>
            <p className='text-center text-xs text-neutral-400 dark:text-neutral-500'>
              Ask questions about your PLC code.
              <br />
              <span className='text-[10px]'>Conversations are per-POU and limited to 20 messages.</span>
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            {messages.map((msg) => (
              <ChatMessageComponent
                key={msg.id}
                message={msg}
                pouName={pouName ?? aiState.activeConversationPou ?? 'general'}
                language={language}
                isStreaming={msg.id === streamingMessageId}
                onInsertAtCursor={handleInsertAtCursor}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <AIChatInput
        onSend={(msg) => void handleSend(msg)}
        onCancel={handleCancel}
        isLoading={!!streamingMessageId}
        selectedText={selectedText}
      />
    </div>
  )
}
