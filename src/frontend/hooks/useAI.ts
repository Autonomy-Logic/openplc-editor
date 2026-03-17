import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { AIRequestError, fetchAICredits, streamAIRequest } from '../services/ai/api-client'
import type { AIChatRequest, AICompleteRequest } from '../services/ai/types'
import { useOpenPLCStore } from '../store'

/**
 * Hook for AI inline completion requests.
 * Returns a function that streams completion tokens and collects them into a string.
 */
export function useAICompletion() {
  const { setAILoading, setAIError, setCredits } = useOpenPLCStore.useAiActions()
  const model = useOpenPLCStore.useAi().model
  const abortRef = useRef<AbortController | null>(null)

  const complete = useCallback(
    async (request: Omit<AICompleteRequest, 'model'>): Promise<string> => {
      // Cancel any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setAILoading(true)
      setAIError(null)

      try {
        let result = ''
        const fullRequest: AICompleteRequest = { ...request, model }

        for await (const token of streamAIRequest('/complete', fullRequest, controller.signal)) {
          result += token
        }

        // Refresh credits after successful completion
        try {
          const credits = await fetchAICredits()
          setCredits(credits.credits_used, credits.credits_total)
        } catch {
          // Non-critical, ignore credit refresh failure
        }

        return result
      } catch (error) {
        if (error instanceof AIRequestError) {
          setAIError(error.message)
        } else if ((error as Error).name !== 'AbortError') {
          setAIError('An unexpected error occurred.')
        }
        return ''
      } finally {
        setAILoading(false)
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      }
    },
    [model, setAILoading, setAIError, setCredits],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { complete, cancel }
}

/**
 * Hook for AI chat requests.
 * Returns a function that streams chat response tokens via a callback.
 */
export function useAIChat() {
  const { setAILoading, setAIError, setCredits } = useOpenPLCStore.useAiActions()
  const model = useOpenPLCStore.useAi().model
  const abortRef = useRef<AbortController | null>(null)

  const chat = useCallback(
    async (request: Omit<AIChatRequest, 'model'>, onToken: (token: string) => void): Promise<void> => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setAILoading(true)
      setAIError(null)

      try {
        const fullRequest: AIChatRequest = { ...request, model }

        for await (const token of streamAIRequest('/chat', fullRequest, controller.signal)) {
          onToken(token)
        }

        // Refresh credits after successful chat
        try {
          const credits = await fetchAICredits()
          setCredits(credits.credits_used, credits.credits_total)
        } catch {
          // Non-critical
        }
      } catch (error) {
        if (error instanceof AIRequestError) {
          setAIError(error.message)
        } else if ((error as Error).name !== 'AbortError') {
          setAIError('An unexpected error occurred.')
        }
      } finally {
        setAILoading(false)
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      }
    },
    [model, setAILoading, setAIError, setCredits],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { chat, cancel }
}

/**
 * Hook for fetching AI credit status with caching.
 */
export function useAICredits() {
  const { setCredits, setTier, setCurrentPeriodEnd } = useOpenPLCStore.useAiActions()
  const aiState = useOpenPLCStore.useAi()

  return useQuery({
    queryKey: ['ai-credits'],
    queryFn: async ({ signal }) => {
      const credits = await fetchAICredits(signal)
      setCredits(credits.credits_used, credits.credits_total)
      setTier(credits.tier)
      setCurrentPeriodEnd(credits.current_period_end)
      return credits
    },
    staleTime: 30000,
    enabled: aiState.isEnabled,
    refetchOnWindowFocus: true,
  })
}
