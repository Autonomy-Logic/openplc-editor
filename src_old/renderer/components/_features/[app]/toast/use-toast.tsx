/*-----------------------------------------------------------------------------
 * This implementation is provided by the Shadcn/UI collection, which is inspired
 * by the react-hot-toast library
 * Check the following link for more instructions:
 * https://ui.shadcn.com/docs/components/toast#installation
 *------------------------------------------------------------------------------*/
import { ReactNode, useEffect, useState } from 'react'

import type { ToastActionElement, ToastProps } from '.'

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: ReactNode
  description?: ReactNode
  action?: ToastActionElement
}

const _actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const

let count = 0

/**
 * Generates a unique identifier.
 *
 * @return {string} The generated identifier.
 */
function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof _actionTypes

type Action =
  | {
      type: ActionType['ADD_TOAST']
      toast: ToasterToast
    }
  | {
      type: ActionType['UPDATE_TOAST']
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType['DISMISS_TOAST']
      toastId?: ToasterToast['id']
    }
  | {
      type: ActionType['REMOVE_TOAST']
      toastId?: ToasterToast['id']
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Add the toastId to the remove queue if it doesn't exist already.
 *
 * @param {string} toastId - The unique identifier of the toast.
 */
const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: 'REMOVE_TOAST',
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

/**
 * Reducer function for managing state based on different action types related to toasts.
 *
 * @param {State} state - The current state of the application.
 * @param {Action} action - The action object that describes the type of operation to perform.
 * @return {State} The updated state after processing the action.
 */
export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      }

    case 'DISMISS_TOAST': {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      }
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

/**
 * Dispatches an action to update the state using the reducer function and notifies all listeners of the updated state.
 *
 * @param {Action} action - The action object that describes the type of operation to perform.
 * @return {void} This function does not return anything.
 */
function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, 'id'>

type toastReturnType = {
  id: string
  dismiss: () => void
  update: (props: ToasterToast) => void
}

/**
 * Creates a new toast with the given props and dispatches actions to add, update, and dismiss the toast.
 *
 * @param {Toast} props - The props for the toast.
 * @return {toastReturnType} An object containing the id of the toast, a dismiss function to remove the toast, and an update function to update the toast.
 */
function toast({ ...props }: Toast): toastReturnType {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id })

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

type useToastReturnType = {
  toast: ({ ...props }: Toast) => object
  dismiss: (toastId?: string) => void
  toasts: ToasterToast[]
}

/**
 * Custom hook for managing toast notifications.
 *
 * @return {useToastReturnType} An object containing the current state of the toast notifications,
 * the toast function for creating new toast notifications, and the dismiss function
 * for dismissing toast notifications.
 */
function useToast(): useToastReturnType {
  const [state, setState] = useState<State>(memoryState)

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
