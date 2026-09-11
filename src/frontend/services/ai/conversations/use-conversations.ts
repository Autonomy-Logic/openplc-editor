import { useQuery } from '@tanstack/react-query'

import type { AIConversationSummary } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'

export type { AIConversationSummary as ConversationSummary }

/**
 * Lists the caller's recent conversations for a project.
 *
 * Goes through `AIPort.conversations`, which is optional as a group: a platform
 * without a conversation store leaves the query disabled and the switcher hides
 * itself rather than rendering an empty list.
 */
export function useConversations(projectId: string | null | undefined) {
  const conversations = useAI()?.conversations

  return useQuery({
    queryKey: ['ai-conversations', projectId],
    queryFn: (): Promise<AIConversationSummary[]> => {
      if (!conversations || !projectId) return Promise.resolve([])
      return conversations.list({ projectId })
    },
    enabled: !!projectId && !!conversations,
  })
}
