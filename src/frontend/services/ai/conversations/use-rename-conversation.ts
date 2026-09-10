import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { AIConversationSummary } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'
import { trackConversationRenamed } from '../telemetry'

/**
 * Rename a conversation. Optimistic: the list cache is patched in place so the
 * new title shows up immediately, and rolled back if the call fails.
 */
export function useRenameConversation(projectId: string | null | undefined) {
  const ai = useAI()
  const conversations = ai?.conversations
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; title: string }): Promise<{ id: string; title: string }> => {
      if (!conversations) return Promise.reject(new Error('This platform has no conversation store.'))
      return conversations.rename(input.id, input.title)
    },
    onMutate: async (variables) => {
      if (!projectId) return { previous: undefined }
      const queryKey = ['ai-conversations', projectId] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AIConversationSummary[]>(queryKey)
      if (previous) {
        queryClient.setQueryData<AIConversationSummary[]>(
          queryKey,
          previous.map((c) => (c.id === variables.id ? { ...c, title: variables.title } : c)),
        )
      }
      return { previous }
    },
    onSuccess: (data) => {
      if (ai) trackConversationRenamed(ai, { conversationId: data.id, newTitleLength: data.title.length })
    },
    onError: (_error, _variables, context) => {
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
