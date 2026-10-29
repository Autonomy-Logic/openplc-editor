import { Cloud, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'

import type { CloudProjectSummary } from '../../../../../middleware/shared/ports/project-port'
import { useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { File } from '../../../_atoms/file'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { toast } from '../../[app]/toast/use-toast'
import type { RecentCloudProjects } from './use-recent-cloud-projects'

/**
 * Word for word what Edge's own SPA says when it refuses to open a locked
 * project. Two screens explaining the same rule differently is how a user
 * concludes one of them is broken.
 */
export const LOCKED_REASON =
  'You need a plan that allows private projects to open this one in the editor. You can still make it public, download it, or delete it.'

export const LOCKED_TOOLTIP = 'Locked, needs a plan with private projects'

export type CloudProjectsNoticeProps = {
  cloud: RecentCloudProjects
  onSignedIn: () => void
}

export const CloudProjectsNotice = ({ cloud, onSignedIn }: CloudProjectsNoticeProps) => {
  const edgeAccount = useEdgeAccountPort()
  const [signInOpen, setSignInOpen] = useState(false)

  if (!edgeAccount || (cloud?.status !== 'signed-out' && cloud?.status !== 'unreachable')) {
    return null
  }

  return (
    <div className='mb-6 flex w-full shrink-0 select-none flex-col pr-9 4xl:pr-0'>
      {cloud.status === 'signed-out' ? (
        // `blue-500`, not `brand`: the brand token is a hex `var()` and Tailwind 3 can't apply an opacity modifier to it.
        <div className='flex w-full flex-col items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/5 px-4 py-3 text-center'>
          <h3 className='font-caption text-sm font-semibold text-neutral-1000 dark:text-white'>
            Sign in with your Autonomy Edge account
          </h3>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={() => setSignInOpen(true)}
              className='cursor-pointer rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark'
            >
              Sign in
            </button>
            {/* Opens Edge: signing up is an email round-trip, not something to do inline here. */}
            <a
              href={new URL('/signup', edgeAccount.frontendBaseUrl).toString()}
              target='_blank'
              rel='noreferrer'
              className='cursor-pointer text-sm font-medium text-brand hover:underline'
            >
              Create an account
            </a>
          </div>
        </div>
      ) : (
        <p className='max-w-xl text-base text-neutral-600 dark:text-neutral-400'>
          Could not reach Autonomy Edge. Your local projects below are unaffected.
        </p>
      )}

      <EdgeSignInModal
        open={signInOpen}
        onOpenChange={setSignInOpen}
        account={edgeAccount}
        reason='signed-out'
        onSignedIn={({ sessionRestored }) => {
          setSignInOpen(false)

          if (!sessionRestored) {
            onSignedIn()
          }
        }}
      />
    </div>
  )
}

export const CloudProjectCard = ({ summary }: { summary: CloudProjectSummary }) => {
  const project = useProject()
  // Selected narrowly so this list doesn't re-render on unrelated store changes.
  const handleOpenProjectResponse = useOpenPLCStore(
    useCallback((state) => state.sharedWorkspaceActions.handleOpenProjectResponse, []),
  )

  const openProject = async () => {
    // Refused here rather than on the way back: Edge now answers 403 to every
    // write on this project, so opening it would only lead to a save that fails.
    if (summary.locked) {
      toast({ title: 'This project is locked.', description: LOCKED_REASON, variant: 'fail' })

      return
    }

    const result = await project.openProjectByPath(summary.id)

    if (result.success && result.data) {
      handleOpenProjectResponse(result.data)

      return
    }

    toast({
      title: 'Cannot open the project.',
      description: result.error?.description ?? `${summary.name} could not be opened.`,
      variant: 'fail',
    })
  }

  return (
    <div className='relative' title={summary.locked ? LOCKED_TOOLTIP : undefined}>
      <File
        onClick={() => void openProject()}
        className={cn('overflow-hidden', summary.locked && 'opacity-50 grayscale')}
        projectName={summary.name}
        projectPath='Autonomy Edge'
        lastModified={new Date(summary.updatedAt).toLocaleString()}
      />
      <span
        aria-label='Autonomy Edge project'
        className='pointer-events-none absolute left-3 top-7 flex size-6 items-center text-white'
      >
        <Cloud className='size-4' />
      </span>
      {summary.locked ? (
        <span
          aria-label={LOCKED_TOOLTIP}
          className='pointer-events-none absolute right-2 top-7 flex size-6 items-center justify-center rounded-md bg-neutral-900/80 text-white'
        >
          <Lock className='size-3.5' />
        </span>
      ) : null}
    </div>
  )
}

export const CloudProjectPlaceholder = () => (
  <div
    aria-hidden
    className='h-[120px] w-[168px] animate-pulse overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800'
  >
    <div className='h-[25px] w-[60%] rounded-br-lg bg-neutral-300 dark:bg-neutral-700' />
    <div className='flex h-[95px] flex-col justify-end gap-2 p-3'>
      <div className='h-3 w-[55%] rounded bg-neutral-300 dark:bg-neutral-700' />
      <div className='h-2 w-[75%] rounded bg-neutral-300/70 dark:bg-neutral-700/70' />
      <div className='h-2 w-[40%] rounded bg-neutral-300/50 dark:bg-neutral-700/50' />
    </div>
  </div>
)
