/**
 * The Edge account, on the start screen.
 *
 * The workspace has the activity bar's account slot, but the activity bar only exists
 * once a project is open. This is the same account, the same dropdown and the same
 * sign-in dialog, reachable from the screen the user actually lands on.
 *
 * IT NEVER OPENS BY ITSELF, on either build. `workspace-activity-bar` opens the dialog
 * unprompted where `requiresEdgeAccount` is set, and that is right there: a project was
 * asked for and could not be reached without a session. Here nothing has been asked
 * for. The start screen lists local projects on the desktop and explains itself on the
 * web, and both are usable with no account at all — so the way in is offered, not
 * imposed.
 */

import { LogIn } from 'lucide-react'
import { useState } from 'react'

import { useCapabilities, useEdgeAccountPort } from '../../../../../middleware/shared/providers'
import { useEdgeAccount } from '../../../../hooks/use-edge-account'
import { cn } from '../../../../utils/cn'
import { EdgeAccountMenu } from '../../../_organisms/edge-account-menu'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { MenuItem } from '../menu'

/**
 * The row geometry every item in this menu shares, from the `Button` atom `MenuItem`
 * wraps: `h-12 gap-3 px-5 py-3` at `text-xl`. Kept as a constant so a signed-in row and
 * a signed-out one cannot drift apart.
 *
 * `w-full min-w-48` rather than the `w-48` the other rows use: what makes this line up
 * is the left edge and the icon column, not the width, and a fixed 192px left barely
 * 120px for the name — enough to clip most real ones. The menu column caps it at 240px
 * either way.
 */
const ROW_CLASSES =
  'flex h-12 w-full min-w-48 items-center gap-3 px-5 py-3 font-caption text-xl font-medium text-neutral-1000 dark:text-white'

/**
 * The size of whatever leads a row here — the sign-in icon, or the avatar once someone
 * is signed in.
 *
 * `size-5` matches the 20px interface icons this menu uses, and is deliberately NOT the
 * avatar's own `size-7` default. That default is right in the activity bar, where the
 * avatar is the whole control; here it has to line up with a folder and a video icon.
 */
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

  // `hasEdgeAccount`, NOT `hasAuthentication`: the autonomy-node build is also
  // authenticated but talks to its own API, where Edge's account endpoints do not
  // exist — this would offer a sign-in that cannot work.
  if (!caps.hasEdgeAccount || !edgeAccount) {
    return null
  }

  // Nothing while the first read is in flight. A "Sign in" row that appears and then
  // vanishes is worse than a beat of nothing, and a returning user's stored session is
  // usually about to resolve.
  if (status === 'loading') {
    return null
  }

  if (status === 'signed-in' && user) {
    return (
      // The WHOLE ROW is the trigger, avatar and name together. The name is what a
      // person aims at here, and having it outside the trigger meant clicking the
      // obvious place did nothing.
      //
      // `triggerClassName` carries the geometry of a `MenuItem` so the row sits on the
      // same grid as Open, Tutorials and Exit. It cannot BE a `MenuItem`, because the
      // trigger is already a button and nesting buttons is invalid HTML.
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
        // Same width rule as the signed-in row, so the slot does not change shape
        // when someone signs in or out.
        className='w-full min-w-48'
      >
        {/* An icon, not an avatar with nobody in it: the avatar falls back to `?`
            when it has no name, and a question mark beside "Sign in" reads as
            something being wrong rather than as an invitation. */}
        <LogIn className={cn(LEADING_GLYPH_CLASSES, 'text-brand')} />
        {/* Someone whose session died under them is not being welcomed; they are being
            told what happened. */}
        {signedOutReason === 'expired' ? 'Session ended' : 'Sign in'}
      </MenuItem>

      <EdgeSignInModal
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={edgeAccount}
        reason={signedOutReason === 'expired' ? 'expired-reloaded' : 'signed-out'}
        onSignedIn={() => {
          setDialogOpen(false)
          // The hook owns the profile and has no way to know a sign-in happened inside
          // a dialog it did not open.
          void refresh()
        }}
      />
    </>
  )
}

export { StartAccountSection }
