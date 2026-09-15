import { useQuery } from '@tanstack/react-query'

import type { AIConversationSummary } from '../../../../middleware/shared/ports/ai-port'
import { useAI } from '../../../../middleware/shared/providers'

export type { AIConversationSummary as ConversationSummary }

/** Lists the caller's recent conversations for a project; disabled when the platform has no conversation store. */
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
