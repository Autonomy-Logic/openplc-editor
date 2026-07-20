import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * Returns a stable-identity function that always invokes the latest `fn`,
 * for handlers passed to identity-sensitive consumers (e.g. ReactFlow props).
 * Must not be called during render — the ref is synced in an effect.
 */
export function useStableCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const fnRef = useRef(fn)

  useInsertionEffect(() => {
    fnRef.current = fn
  })

  return useCallback((...args: Args) => fnRef.current(...args), [])
}
