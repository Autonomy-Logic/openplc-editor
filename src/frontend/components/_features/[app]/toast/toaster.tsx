import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '.'
import { useToast } from './use-toast'

// Auto-dismiss after 3s.  Radix-UI pauses the timer while the
// pointer hovers over the toast and restarts the full 3s once the
// pointer leaves, so the user can read longer messages without
// fighting the dismissal.  Failure / warning toasts inherit the
// same duration — the call sites that need a longer dwell can
// override per-toast via the `duration` prop on `toast()`.
const TOAST_AUTO_DISMISS_MS = 3000

const Toaster = () => {
  const { toasts } = useToast()
  return (
    <ToastProvider swipeDirection='right' duration={TOAST_AUTO_DISMISS_MS}>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          {title && <ToastTitle>{title}</ToastTitle>}
          {description && <ToastDescription>{description}</ToastDescription>}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

export default Toaster
