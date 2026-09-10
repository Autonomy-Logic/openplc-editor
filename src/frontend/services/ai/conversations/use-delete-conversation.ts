import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AIConversationSummary } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'
import { trackConversationDeleted } from '../telemetry'

/**
 * Hard-delete a conversation. Optimistic: the row leaves the list cache
 * immediately and is put back if the call fails.
 */
export function useDeleteConversation(projectId: string | null | undefined) {
  const ai = useAI()
  const conversations = ai?.conversations
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string): Promise<void> => {
      if (!conversations) return Promise.reject(new Error('This platform has no conversation store.'))
      return conversations.remove(id)
    },
    onMutate: async (id) => {
      if (!projectId) return { previous: undefined }
      const queryKey = ['ai-conversations', projectId] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AIConversationSummary[]>(queryKey)
      if (previous) {
        queryClient.setQueryData<AIConversationSummary[]>(
          queryKey,
          previous.filter((c) => c.id !== id),
        )
      }
      return { previous }
    },
    onSuccess: (_data, id) => {
      if (ai) trackConversationDeleted(ai, { conversationId: id })
    },
    onError: (_error, _id, context) => {
      if (projectId && context?.previous) {
        queryClient.setQueryData(['ai-conversations', projectId], context.previous)
      }
    },
    onSettled: () => {
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: ['ai-conversations', projectId] })
      }
    },
  })
}
