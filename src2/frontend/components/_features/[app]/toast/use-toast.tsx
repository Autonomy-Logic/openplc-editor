/*-----------------------------------------------------------------------------
 * This implementation is provided by the Shadcn/UI collection, which is inspired
 * by the react-hot-toast library
 * Check the following link for more instructions:
 * https://ui.shadcn.com/docs/components/toast#installation
 *------------------------------------------------------------------------------*/
import { useEffect, useState } from 'react'

import type { State, ToasterToast } from '../../../../utils/toast'
import { dispatch, getMemoryState, listeners, toast } from '../../../../utils/toast'

type useToastReturnType = {
  toast: typeof toast
  dismiss: (toastId?: string) => void
  toasts: ToasterToast[]
}

function useToast(): useToastReturnType {
  const [state, setState] = useState<State>(getMemoryState)

  useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  }
}

export { toast, useToast }
export type { ToasterToast }
