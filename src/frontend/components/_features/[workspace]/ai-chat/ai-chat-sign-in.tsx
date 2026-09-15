/**
 * What the assistant shows in place of an answer while there is no Edge session.
 */

interface AIChatSignInNoticeProps {
  reason: 'expired' | 'signed-out'
  /** Absent where the sign-in dialog opens by itself, so the notice offers no second one. */
  onSignIn?: () => void
}

export const AIChatSignInNotice = ({ reason, onSignIn }: AIChatSignInNoticeProps) => (
  <div
    role='status'
    className='flex shrink-0 items-center gap-3 border-t border-neutral-100 bg-white px-3.5 py-2.5 dark:border-white/5 dark:bg-neutral-950'
  >
    <p className='min-w-0 flex-1 text-[12.5px] leading-[1.45] text-neutral-600 dark:text-neutral-300'>
      {reason === 'expired'
        ? 'Your session ended. Sign in to Autonomy Edge again to keep using the assistant.'
        : 'Sign in to Autonomy Edge to use the assistant.'}
    </p>
    {onSignIn && (
      <button
        type='button'
        onClick={onSignIn}
        className='rounded-md bg-brand px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-medium-dark'
      >
        Sign in
      </button>
    )}
  </div>
)
