import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AIConversationDetail } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'

/**
 * Creates an empty conversation for a project. The first chat turn sent with
 * this conversation's id persists the user turn and the streamed assistant turn.
 *
 * In the typical flow the conversation is created implicitly by the chat
 * endpoint (which announces it with a `conversation_started` frame) — this hook
 * covers the explicit "+ New chat" path, or any case where the UI wants to
 * reserve an id before the first message.
 */
export function useCreateConversation() {
  const conversations = useAI()?.conversations
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { projectId: string; title?: string }): Promise<AIConversationDetail> => {
      if (!conversations) return Promise.reject(new Error('This platform has no conversation store.'))
      return conversations.create(input)
    },
    onSuccess: (_conversation, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['ai-conversations', variables.projectId],
      })
    },
  })
}
