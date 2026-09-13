/**
 * The Edge account, on the start screen. Unlike the activity bar's slot, this never
 * opens the sign-in dialog by itself.
 */

import { LogIn } from 'lucide-react'
import { useState } from 'react'

import { useCapabilities, useEdgeAccountPort } from '../../../../../middleware/shared/providers'
import { useEdgeAccount } from '../../../../hooks/use-edge-account'
import { cn } from '../../../../utils/cn'
import { EdgeAccountMenu } from '../../../_organisms/edge-account-menu'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { MenuItem } from '../menu'

/** Shared row geometry so the signed-in and signed-out rows cannot drift apart. */
const ROW_CLASSES =
  'flex h-12 w-full min-w-48 items-center gap-3 px-5 py-3 font-caption text-xl font-medium text-neutral-1000 dark:text-white'

/** `size-5`, not the avatar's own `size-7` default — here it must line up with the other row icons. */
const LEADING_GLYPH_CLASSES = 'size-5'

const StartAccountSection = () => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const {
    status,
    user,
    planCaption,
    signedOutReason,
    refresh,
    signOut: signOutOfAccount,
  } = useEdgeAccount(caps.hasEdgeAccount, edgeAccount)
  const [dialogOpen, setDialogOpen] = useState(false)

  // `hasEdgeAccount`, not `hasAuthentication`: autonomy-node is authenticated too but
  // has no Edge account endpoints.
  if (!caps.hasEdgeAccount || !edgeAccount) {
    return null
  }

  // Nothing while the first read is in flight, rather than a row that flashes and vanishes.
  if (status === 'loading') {
    return null
  }

  if (status === 'signed-in' && user) {
    return (
      // Can't be a MenuItem: the trigger is already a button, and nesting buttons is invalid HTML.
      <EdgeAccountMenu
        user={user}
        planCaption={planCaption}
        edgeBaseUrl={edgeAccount.frontendBaseUrl}
        avatarClassName={LEADING_GLYPH_CLASSES}
        triggerClassName={cn(ROW_CLASSES, 'rounded-md')}
        label={
          <span className='truncate' title={user.email}>
            {user.name}
          </span>
        }
        onSignOut={() => {
          void signOutOfAccount()
        }}
      />
    )
  }

  return (
    <>
      <MenuItem
        ghosted
        onClick={() => setDialogOpen(true)}
        aria-label='Sign in to Autonomy Edge'
        // Same width as the signed-in row so the slot does not change shape.
        className='w-full min-w-48'
      >
        <LogIn className={cn(LEADING_GLYPH_CLASSES, 'text-brand')} />
        {signedOutReason === 'expired' ? 'Session ended' : 'Sign in'}
      </MenuItem>

      <EdgeSignInModal
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={edgeAccount}
        reason={signedOutReason === 'expired' ? 'expired-reloaded' : 'signed-out'}
        onSignedIn={() => {
          setDialogOpen(false)
          // The hook has no way to know a sign-in happened in a dialog it didn't open.
          void refresh()
        }}
      />
    </>
  )
}

export { StartAccountSection }
