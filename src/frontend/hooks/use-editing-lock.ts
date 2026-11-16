import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'
import { selectIsEditingLocked } from '../store/slices/workspace/selectors'

export function useIsEditingLocked(): boolean {
  return useOpenPLCStore(useCallback(selectIsEditingLocked, []))
}
