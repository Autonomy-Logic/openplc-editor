import { useIsEditingLocked } from '../../../hooks/use-editing-lock'

/** The bright green of the runtime's online mode. */
export const DEBUG_SESSION_FRAME_COLOR = '#22c55e'

const DebugSessionFrame = () => {
  const isEditingLocked = useIsEditingLocked()

  if (!isEditingLocked) return null

  return (
    <div
      aria-hidden='true'
      data-debug-session-frame='true'
      style={{ borderColor: DEBUG_SESSION_FRAME_COLOR }}
      className='pointer-events-none fixed inset-0 z-[200] border-[3px]'
    />
  )
}

export { DebugSessionFrame }
