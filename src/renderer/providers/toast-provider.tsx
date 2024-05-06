import { ToastProvider as PrimitiveToastProvider, type ToastProviderProps } from '@radix-ui/react-toast'
import { ReactNode } from 'react'

const ToastProvider = (props: ToastProviderProps): ReactNode => {
  const { children, swipeDirection = 'right', ...rest } = props
  return (
    <PrimitiveToastProvider swipeDirection={swipeDirection} {...rest}>
      {children}
    </PrimitiveToastProvider>
  )
}

export default ToastProvider
