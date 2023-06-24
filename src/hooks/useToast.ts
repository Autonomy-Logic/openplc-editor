import { useContext } from 'react'

import { ToastContext } from '@/contexts'
import { ToastContextData } from '@/contexts/Toast'

const useToast = (): ToastContextData => {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

export default useToast
