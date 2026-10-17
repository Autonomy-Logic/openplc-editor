import { useSyncExternalStore } from 'react'

import type { ReadModel } from '../contracts/presentation'

/**
 * Subscribes a component to any `ReadModel`. React re-renders only when `getSnapshot` returns a different
 * object, which is why read models must keep the same reference while nothing changed.
 */
export function useReadModel<T>(model: ReadModel<T>): T {
  return useSyncExternalStore(model.subscribe, model.getSnapshot)
}
