import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AIConversationDetail } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'

/** Reserves a conversation id up front, for the explicit "+ New chat" path. */
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
