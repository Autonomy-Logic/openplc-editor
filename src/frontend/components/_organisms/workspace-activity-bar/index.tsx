import { Files, GitBranch } from 'lucide-react'
import { useCallback } from 'react'

import { useCapabilities, useEdgeAccountPort, useNavigation } from '../../../../middleware/shared/providers'
import { useEdgeAccount } from '../../../hooks/use-edge-account'
import { useIsNinetiesTheme } from '../../../hooks/use-nineties-theme'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { RetroExplorer, RetroSourceControl } from '../../_atoms/retro-icons'
import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { ExitButton } from '../../_molecules/workspace-activity-bar/default/exit'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'
import { EdgeAccountMenu } from '../edge-account-menu'
import { EdgeSignInModal } from '../edge-sign-in-modal'
import { DefaultWorkspaceActivityBar } from './default'
import { FBDToolbox } from './fbd-toolbox'
import { LadderToolbox } from './ladder-toolbox'

type ActivityBarProps = {
  defaultActivityBar?: {
    zoom?: {
      onClick: () => void
    }
  }
  explorer?: {
    isActive: boolean
    onClick: () => void
  }
  sourceControl?: {
    isActive: boolean
    pendingCount: number
    onClick: () => void
  }
}

export const WorkspaceActivityBar = ({ defaultActivityBar, explorer, sourceControl }: ActivityBarProps) => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const {
    status: accountStatus,
    user: accountUser,
    planCaption: accountPlanCaption,
    signedOutReason: accountSignedOutReason,
    refresh: refreshAccount,
    signOut: signOutOfAccount,
  } = useEdgeAccount(caps.hasEdgeAccount, edgeAccount)
  const editor = useOpenPLCStore(useCallback((s) => s.editor, []))
  const { closeProject } = useOpenPLCStore(useCallback((s) => s.sharedWorkspaceActions, []))
  const navigation = useNavigation()

  /**
   * Whether this build has an account slot at the foot of the bar at all.
   *
   * Deliberately not "is someone signed in": that would move the exit arrow on
   * every sign-in and again on every sign-out. This is a property of the build.
   */
  const hasAccountSlot = caps.hasEdgeAccount && edgeAccount !== undefined

  const isFBDEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'fbd'
  const isLadderEditor = editor?.type === 'plc-graphical' && editor?.meta.language === 'ld'
  const isNineties = useIsNinetiesTheme()

  const handleExitApplication = () => {
    const { pendingConfirmation } = closeProject()
    // When the modal opens, defer exiting to the modal's save/discard
    // path so the user's choice is respected.
    if (!pendingConfirmation) {
      navigation.exitToHost()
    }
  }
  return (
    <>
      <div className='sidebar-scroll my-5 flex min-h-0 w-full flex-1 flex-col items-center gap-5 overflow-y-auto'>
        {explorer && (
          <TooltipSidebarWrapperButton tooltipContent='Explorer'>
            <button
              onClick={explorer.onClick}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded transition-colors duration-150',
                explorer.isActive
                  ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
              aria-label='Explorer'
            >
              {isNineties ? <RetroExplorer /> : <Files className='h-4 w-4' />}
            </button>
          </TooltipSidebarWrapperButton>
        )}
        {sourceControl && (
          <TooltipSidebarWrapperButton tooltipContent='Source Control'>
            <button
              onClick={sourceControl.onClick}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded transition-colors duration-150',
                sourceControl.isActive
                  ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
              aria-label='Source Control'
            >
              {isNineties ? <RetroSourceControl /> : <GitBranch className='h-4 w-4' />}
              {sourceControl.pendingCount > 0 && (
                <span className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white'>
                  {sourceControl.pendingCount > 9 ? '9+' : sourceControl.pendingCount}
                </span>
              )}
            </button>
          </TooltipSidebarWrapperButton>
        )}
        {(explorer || sourceControl) && <DividerActivityBar />}
        <div className='flex w-full flex-col items-center gap-5'>
          <DefaultWorkspaceActivityBar {...defaultActivityBar} />
        </div>
        {isFBDEditor && (
          <>
            <DividerActivityBar />
            <div className='flex w-full flex-col items-center gap-5'>
              <FBDToolbox />
            </div>
          </>
        )}
        {isLadderEditor && (
          <>
            <DividerActivityBar />
            <div className='flex w-full flex-col items-center gap-5'>
              <LadderToolbox />
            </div>
          </>
        )}
      </div>
      {/* Foot of the bar: leaving the project, then who is signed in. The account
          sits below the exit arrow because it is a destination, not a tool — the
          same reasoning that keeps it out of the toolbox above the divider.

          The bottom padding follows the account slot instead of being fixed. Where
          there is no slot — the desktop editor, which mirrors this file and sets
          `hasEdgeAccount` to false — the exit arrow is still the last thing in the
          bar and keeps the `pb-10` it has always had. Making room for a menu that
          build never renders had moved it ~28px down the activity bar, which is a
          visible change to an existing control for no reason. Where the account
          does render it is the last thing, and it wants the smaller gap. */}
      <div className={cn('flex w-full shrink-0 flex-col items-center gap-4', hasAccountSlot ? 'pb-3' : 'pb-10')}>
        <TooltipSidebarWrapperButton tooltipContent='Exit'>
          <ExitButton onClick={handleExitApplication} />
        </TooltipSidebarWrapperButton>

        {/* `hasEdgeAccount`, NOT `hasAuthentication`: the autonomy-node build is
            also authenticated but talks to its own API, where Edge's account
            endpoints do not exist — this would offer a sign-in that cannot work. */}
        {/* No tooltip on this one: the menu it opens already leads with the name
            and email, so a hover label just repeats itself over the open menu. */}
        {caps.hasEdgeAccount && edgeAccount && accountStatus === 'signed-in' && accountUser && (
          <EdgeAccountMenu
            user={accountUser}
            planCaption={accountPlanCaption}
            edgeBaseUrl={edgeAccount.frontendBaseUrl}
            onSignOut={() => {
              void signOutOfAccount()
            }}
          />
        )}
      </div>

      {/* Gated on `signed-out` rather than `!user`, so a slow /auth/me never
          flashes a sign-in prompt at someone who is already signed in. */}
      {caps.hasEdgeAccount && edgeAccount && accountStatus === 'signed-out' && (
        <EdgeSignInModal
          open
          account={edgeAccount}
          reason={accountSignedOutReason}
          onSignedIn={() => {
            void refreshAccount()
          }}
        />
      )}
    </>
  )
}
