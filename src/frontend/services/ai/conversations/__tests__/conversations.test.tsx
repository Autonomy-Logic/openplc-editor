/**
 * The conversation hooks, over a fake `AIPort.conversations`.
 *
 * These used to be five files of axios mocks in the web adapter. Now the HTTP is
 * the platform's business and the hooks are shared, so the fake is the port —
 * which is also what makes this file runnable under both jest and vitest.
 *
 * What is worth pinning: the transcript's opaque content is narrowed (a block a
 * newer backend invented must not reach the renderer), the optimistic list edits
 * roll back when the call fails, and a platform with no conversation store
 * leaves the queries disabled instead of erroring.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from '@jest/globals'
import type { ReactNode } from 'react'

import type {
  AIConversationDetail,
  AIConversationSummary,
  AIPort,
} from '../../../../../middleware/shared/ports/ai-port'
import type { PlatformPorts } from '../../../../../middleware/shared/providers'
import { PlatformProvider } from '../../../../../middleware/shared/providers'
import { toChatMessageContent } from '../conversation-content'
import { useConversation } from '../use-conversation'
import { useConversations } from '../use-conversations'
import { useDeleteConversation } from '../use-delete-conversation'
import { useCreateConversation } from '../use-create-conversation'
import { useRenameConversation } from '../use-rename-conversation'

type ConversationsApi = NonNullable<AIPort['conversations']>

const summary: AIConversationSummary = { id: 'c1', title: 'First', updatedAt: '2026-01-01T00:00:00.000Z' }

function makeConversations(overrides: Partial<ConversationsApi> = {}): ConversationsApi {
  return {
    list: () => Promise.resolve([summary]),
    get: () => Promise.reject(new Error('not stubbed')),
    create: () => Promise.reject(new Error('not stubbed')),
    rename: (id, title) => Promise.resolve({ id, title }),
    remove: () => Promise.resolve(),
    ...overrides,
  }
}

/**
 * Only `ai` is read by anything under test; the rest of the platform is absent
 * on purpose so a hook that starts reaching for another port fails loudly.
 */
function makeWrapper(conversations: ConversationsApi | undefined) {
  // Telemetry rides along on every successful mutation, so the fake port needs a
  // sink even when the test is only interested in the cache.
  const ai = conversations ? { conversations, sendTelemetry: () => undefined } : undefined
  const ports = { ai } as unknown as PlatformPorts
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PlatformProvider>
  )
  return { wrapper, queryClient }
}

describe('toChatMessageContent', () => {
  it('passes prose through unchanged', () => {
    expect(toChatMessageContent('hello')).toBe('hello')
  })

  it('keeps the blocks it understands', () => {
    expect(
      toChatMessageContent([
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 't1', name: 'create_pou', input: { name: 'Foo' } },
        { type: 'tool_result', tool_use_id: 't1', content: 'done', is_error: false },
      ]),
    ).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'create_pou', input: { name: 'Foo' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'done', is_error: false },
    ])
  })

  it('drops a block it does not recognise rather than passing it to the renderer', () => {
    expect(
      toChatMessageContent([{ type: 'text', text: 'kept' }, { type: 'thinking', thought: 'from a newer backend' }, 42]),
    ).toEqual([{ type: 'text', text: 'kept' }])
  })

  it('defaults a tool_result with no string content to an empty string', () => {
    expect(toChatMessageContent([{ type: 'tool_result', tool_use_id: 't1', content: { oops: true } }])).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '' },
    ])
  })

  it('answers an empty string for anything that is neither prose nor a list', () => {
    expect(toChatMessageContent(null)).toBe('')
    expect(toChatMessageContent({ type: 'text' })).toBe('')
  })
})

describe('useConversations', () => {
  it('lists the project’s conversations through the port', async () => {
    const { wrapper } = makeWrapper(makeConversations())
    const { result } = renderHook(() => useConversations('p1'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual([summary]))
  })

  it('stays disabled when the platform has no conversation store', () => {
    const { wrapper } = makeWrapper(undefined)
    const { result } = renderHook(() => useConversations('p1'), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('stays disabled with no project id', () => {
    const { wrapper } = makeWrapper(makeConversations())
    const { result } = renderHook(() => useConversations(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useConversation', () => {
  it('narrows every message’s content on the way out of the transport', async () => {
    const detail: AIConversationDetail = {
      ...summary,
      messages: [
        { id: 'm1', role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
        {
          id: 'm2',
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }, { type: 'nonsense' }],
          createdAt: '2026-01-01T00:00:01.000Z',
          rating: 'up',
        },
      ],
    }
    const { wrapper } = makeWrapper(makeConversations({ get: () => Promise.resolve(detail) }))
    const { result } = renderHook(() => useConversation('c1'), { wrapper })

    await waitFor(() => expect(result.current.data).not.toBeUndefined())
    expect(result.current.data?.messages).toEqual([
      { id: 'm1', role: 'user', content: 'hello', rating: null, createdAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        rating: 'up',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ])
  })

  it('stays disabled with no conversation id', () => {
    const { wrapper } = makeWrapper(makeConversations())
    const { result } = renderHook(() => useConversation(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateConversation', () => {
  it("invalidates the project's list so the switcher shows the new chat", async () => {
    const created: AIConversationDetail = { ...summary, id: 'c2', title: 'New chat', messages: [] }
    const { wrapper, queryClient } = makeWrapper(makeConversations({ create: () => Promise.resolve(created) }))
    queryClient.setQueryData(['ai-conversations', 'p1'], [summary])

    const { result } = renderHook(() => useCreateConversation(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'p1', title: 'New chat' })
    })

    // The five per-hook suites this replaced never came back for this one, and the
    // hook gained this invalidation in the same commit. Without it "+ New chat" leaves a
    // switcher that does not list the conversation the user is now typing into.
    expect(queryClient.getQueryState(['ai-conversations', 'p1'])?.isInvalidated).toBe(true)
  })

  it('hands back what the store created', async () => {
    const created: AIConversationDetail = { ...summary, id: 'c2', title: 'New chat', messages: [] }
    const { wrapper } = makeWrapper(makeConversations({ create: () => Promise.resolve(created) }))

    const { result } = renderHook(() => useCreateConversation(), { wrapper })
    let returned: AIConversationDetail | undefined
    await act(async () => {
      returned = await result.current.mutateAsync({ projectId: 'p1' })
    })

    expect(returned?.id).toBe('c2')
  })

  it('rejects rather than pretending, when the platform has no store', async () => {
    const { wrapper } = makeWrapper(undefined)
    const { result } = renderHook(() => useCreateConversation(), { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync({ projectId: 'p1' })
      }),
    ).rejects.toThrow('no conversation store')
  })
})

describe('useRenameConversation', () => {
  it('patches the cached list immediately', async () => {
    const { wrapper, queryClient } = makeWrapper(makeConversations())
    queryClient.setQueryData(['ai-conversations', 'p1'], [summary])

    const { result } = renderHook(() => useRenameConversation('p1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', title: 'Renamed' })
    })

    expect(queryClient.getQueryData<AIConversationSummary[]>(['ai-conversations', 'p1'])?.[0].title).toBe('Renamed')
  })

  it('rolls the list back when the rename fails', async () => {
    const conversations = makeConversations({ rename: () => Promise.reject(new Error('nope')) })
    const { wrapper, queryClient } = makeWrapper(conversations)
    queryClient.setQueryData(['ai-conversations', 'p1'], [summary])

    const { result } = renderHook(() => useRenameConversation('p1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', title: 'Renamed' }).catch(() => undefined)
    })

    await waitFor(() =>
      expect(queryClient.getQueryData<AIConversationSummary[]>(['ai-conversations', 'p1'])?.[0].title).toBe('First'),
    )
  })

  it('rejects rather than pretending, when the platform has no store', async () => {
    const { wrapper } = makeWrapper(undefined)
    const { result } = renderHook(() => useRenameConversation('p1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'c1', title: 'x' })).rejects.toThrow('no conversation store')
    })
  })
})

describe('useDeleteConversation', () => {
  it('removes the row from the cached list immediately', async () => {
    const { wrapper, queryClient } = makeWrapper(makeConversations())
    queryClient.setQueryData(['ai-conversations', 'p1'], [summary])

    const { result } = renderHook(() => useDeleteConversation('p1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('c1')
    })

    expect(queryClient.getQueryData<AIConversationSummary[]>(['ai-conversations', 'p1'])).toEqual([])
  })

  it('puts the row back when the delete fails', async () => {
    const conversations = makeConversations({ remove: () => Promise.reject(new Error('nope')) })
    const { wrapper, queryClient } = makeWrapper(conversations)
    queryClient.setQueryData(['ai-conversations', 'p1'], [summary])

    const { result } = renderHook(() => useDeleteConversation('p1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('c1').catch(() => undefined)
    })

    await waitFor(() => expect(queryClient.getQueryData(['ai-conversations', 'p1'])).toEqual([summary]))
  })
})
