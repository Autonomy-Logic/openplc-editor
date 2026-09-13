/**
 * The signed-in user's Autonomy Edge projects, on the start screen. The heading's space
 * stays reserved whether or not anyone is signed in, so the layout never reflows.
 */

import { CloudUpload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { CloudProjectsResult, CloudProjectSummary } from '../../../../../middleware/shared/ports/project-port'
import { useCapabilities, useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { File } from '../../../_atoms/file'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { toast } from '../../[app]/toast/use-toast'

/** A shortcut to recent work, not a project browser — Edge's own SPA covers everything. */
const RECENT_LIMIT = 5

export type StartCloudProjectsProps = {
  /** Same filter box the local list uses, so one search covers both sections. */
  searchNameFilterValue: string
  /** Bumped to force a re-read; a counter keeps it an ordinary effect dependency. */
  revision?: number
}

const StartCloudProjects = ({ searchNameFilterValue, revision = 0 }: StartCloudProjectsProps) => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const project = useProject()
  // Selected narrowly so this list doesn't re-render on unrelated store changes.
  const handleOpenProjectResponse = useOpenPLCStore(
    useCallback((state) => state.sharedWorkspaceActions.handleOpenProjectResponse, []),
  )

  /** `null` until the first answer lands — which is not the same as having none. */
  const [result, setResult] = useState<CloudProjectsResult | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  const available = caps.hasEdgeAccount && project.listRecentCloudProjects !== undefined

  const load = useCallback(async () => {
    if (!project.listRecentCloudProjects) {
      return
    }

    // An unhandled rejection here takes down the whole renderer, not just this section.
    setResult(
      await project.listRecentCloudProjects(RECENT_LIMIT).catch((): CloudProjectsResult => ({ status: 'unreachable' })),
    )
  }, [project])

  useEffect(() => {
    if (!available) {
      return
    }

    void load()
    // `revision` is never read; changing it is the whole signal.
  }, [available, load, revision])

  // The session's own restored/expired signal, not a poll.
  useEffect(() => {
    if (!available || !edgeAccount) {
      return
    }

    const unsubscribeRestored = edgeAccount.session.onRestored(() => void load())
    const unsubscribeExpired = edgeAccount.session.onExpired(() => setResult({ status: 'signed-out' }))

    return () => {
      unsubscribeRestored()
      unsubscribeExpired()
    }
  }, [available, edgeAccount, load])

  const openProject = async (summary: CloudProjectSummary) => {
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

  const filter = searchNameFilterValue.trim().toLowerCase()
  const projects = result?.status === 'ok' ? result.projects : []
  const visible = filter ? projects.filter((summary) => summary.name.toLowerCase().includes(filter)) : projects

  // `edgeAccount` is checked here, once, so the rest of the render can use it without a null check.
  if (!available || !edgeAccount || result?.status === 'unavailable') {
    return null
  }

  return (
    // `mb-10` must exceed the `mb-6` heading-to-cards rhythm, or the local "Projects"
    // heading below reads as a label for these cards.
    <section className='mb-10 flex w-full select-none flex-col pr-9 4xl:pr-0'>
      <h2 className='mb-6 flex cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Autonomy Edge Cloud Projects
      </h2>

      {result === null ? (
        // Placeholder cards sized like the real ones, so the layout doesn't jump on arrival.
        <div className='flex h-auto w-full flex-wrap gap-[25px]' role='status' aria-label='Loading cloud projects'>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              aria-hidden
              className='h-[160px] w-[224px] animate-pulse overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800'
            >
              {/* Mirrors the real folder card's layout so it resolves in place. */}
              <div className='h-[33px] w-[60%] rounded-br-lg bg-neutral-300 dark:bg-neutral-700' />
              <div className='flex h-[127px] flex-col justify-end gap-2 p-3'>
                <div className='h-3 w-[55%] rounded bg-neutral-300 dark:bg-neutral-700' />
                <div className='h-2 w-[75%] rounded bg-neutral-300/70 dark:bg-neutral-700/70' />
                <div className='h-2 w-[40%] rounded bg-neutral-300/50 dark:bg-neutral-700/50' />
              </div>
            </div>
          ))}
        </div>
      ) : result.status === 'signed-out' ? (
        // `blue-500`, not `brand`: the brand token is a hex `var()` and Tailwind 3 can't apply an opacity modifier to it.
        <div className='flex w-full flex-col items-center gap-4 rounded-xl border border-blue-500/25 bg-blue-500/5 px-6 py-8 text-center'>
          <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-brand'>
            <CloudUpload className='size-5' />
          </span>
          <div className='flex flex-col items-center gap-1'>
            <h3 className='font-caption text-base font-semibold text-neutral-1000 dark:text-white'>
              Bring your cloud projects here
            </h3>
            <p className='max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400'>
              Sign in with your Autonomy Edge account to access Edge features. Open your cloud projects in this editor
              and save straight back to them.
            </p>
          </div>

          <div className='flex items-center gap-4'>
            <button
              type='button'
              onClick={() => setSignInOpen(true)}
              className='cursor-pointer rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark'
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
      ) : result.status === 'unreachable' ? (
        <p className='max-w-xl text-base text-neutral-600 dark:text-neutral-400'>
          Could not reach Autonomy Edge. Your local projects below are unaffected.
        </p>
      ) : visible.length === 0 ? (
        <p className='max-w-xl text-base text-neutral-600 dark:text-neutral-400'>
          {filter
            ? 'No cloud project matches that search.'
            : 'No cloud projects yet. Create one on Autonomy Edge and it will show up here.'}
        </p>
      ) : (
        <div className='flex h-auto w-full flex-wrap gap-[25px]'>
          {visible.map((summary) => (
            <File
              key={summary.id}
              onClick={() => void openProject(summary)}
              className='overflow-hidden'
              projectName={summary.name}
              projectPath='Autonomy Edge'
              lastModified={new Date(summary.updatedAt).toLocaleString()}
            />
          ))}
        </div>
      )}

      <EdgeSignInModal
        open={signInOpen}
        onOpenChange={setSignInOpen}
        account={edgeAccount}
        reason='signed-out'
        onSignedIn={() => {
          setSignInOpen(false)
          void load()
        }}
      />
    </section>
  )
}

export { StartCloudProjects }
