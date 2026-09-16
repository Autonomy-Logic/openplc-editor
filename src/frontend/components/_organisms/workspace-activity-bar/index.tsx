import { Files, GitBranch, LogIn } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useCapabilities, useEdgeAccountPort, useNavigation } from '../../../../middleware/shared/providers'
import { useEdgeAccount } from '../../../hooks/use-edge-account'
import { useIsNinetiesTheme } from '../../../hooks/use-nineties-theme'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { ActivityBarButton } from '../../_atoms/buttons/activity-bar'
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
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const editor = useOpenPLCStore(useCallback((s) => s.editor, []))
  const { closeProject } = useOpenPLCStore(useCallback((s) => s.sharedWorkspaceActions, []))
  const navigation = useNavigation()

  // Deliberately a build property, not "is someone signed in": that would move the exit arrow on every sign-in/out.
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
      {/* Bottom padding follows the account slot: a build with no Edge account keeps the
          exit arrow's original pb-10, so adding the slot never shifts it for that build. */}
      <div className={cn('flex w-full shrink-0 flex-col items-center gap-4', hasAccountSlot ? 'pb-3' : 'pb-10')}>
        <TooltipSidebarWrapperButton tooltipContent='Exit'>
          <ExitButton onClick={handleExitApplication} />
        </TooltipSidebarWrapperButton>

        {/* hasEdgeAccount, not hasAuthentication: autonomy-node is authenticated but talks to its own
            API, where Edge's account endpoints don't exist. No tooltip: the menu already shows name/email. */}
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

        {/* Same slot, for a build that doesn't demand an account: never rendered where the dialog
            already opens itself, so the web build is untouched. */}
        {caps.hasEdgeAccount && edgeAccount && !caps.requiresEdgeAccount && accountStatus === 'signed-out' && (
          <TooltipSidebarWrapperButton tooltipContent='Sign in to Autonomy Edge'>
            {/* size-5 and #B4D0FE match ExitButton above it; an icon rather than an empty-avatar '?'. */}
            <ActivityBarButton aria-label='Sign in to Autonomy Edge' onClick={() => setSignInDialogOpen(true)}>
              <LogIn className='size-5 text-[#B4D0FE]' />
            </ActivityBarButton>
          </TooltipSidebarWrapperButton>
        )}
      </div>

      {/* Gated on signed-out rather than !user, so a slow /auth/me never flashes a prompt at
          someone already signed in. `open` follows requiresEdgeAccount: forced open on web,
          opened on request on desktop, which works offline. */}
      {caps.hasEdgeAccount && edgeAccount && accountStatus === 'signed-out' && (
        <EdgeSignInModal
          open={caps.requiresEdgeAccount || signInDialogOpen}
          onOpenChange={setSignInDialogOpen}
          account={edgeAccount}
          reason={accountSignedOutReason}
          onSignedIn={() => {
            // Cleared, not left standing: the flag must not force the dialog back open on a later expiry.
            setSignInDialogOpen(false)
            void refreshAccount()
          }}
        />
      )}
    </>
  )
}
