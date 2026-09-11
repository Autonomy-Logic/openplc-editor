import { useQuery } from '@tanstack/react-query'

import type { AIConversationDetail } from '../../../../middleware/shared/ports/ai-port'
import type { AIChatContentBlock } from '../../../../middleware/shared/ports/types'
import { useAI } from '../../../../middleware/shared/providers'
import { toChatMessageContent } from './conversation-content'

/** One stored turn, with its content already narrowed to what the store holds. */
export type ConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string | AIChatContentBlock[]
  rating: 'up' | 'down' | null
  createdAt: string
}

/** A stored conversation and its whole transcript. */
export type ConversationDetail = {
  id: string
  title: string
  updatedAt: string
  projectId?: string | null
  messages: ConversationMessage[]
}

function toConversationDetail(detail: AIConversationDetail): ConversationDetail {
  return {
    id: detail.id,
    title: detail.title,
    updatedAt: detail.updatedAt,
    projectId: detail.projectId,
    messages: detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: toChatMessageContent(message.content),
      rating: message.rating ?? null,
      createdAt: message.createdAt,
    })),
  }
}

/**
 * Loads the full transcript of a conversation. Turns come back in the order the
 * backend stored them (text, `tool_use` and `tool_result` blocks all preserved),
 * with each message's opaque content narrowed at this boundary — see
 * `conversation-content.ts` for why that check lives here and not in the store.
 */
export function useConversation(id: string | null | undefined) {
  const conversations = useAI()?.conversations

  return useQuery({
    queryKey: ['ai-conversation', id],
    queryFn: async (): Promise<ConversationDetail | null> => {
      if (!conversations || !id) return null
      return toConversationDetail(await conversations.get(id))
    },
    enabled: !!id && !!conversations,
  })
}
