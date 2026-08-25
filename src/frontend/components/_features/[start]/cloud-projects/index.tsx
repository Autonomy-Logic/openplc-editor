/**
 * The signed-in user's Autonomy Edge projects, on the start screen.
 *
 * Sits above the local Projects section so the two are visible together: this is the
 * only place in either product where a person sees what is on their machine and what is
 * on their account side by side, and reaching one from the other is the point.
 *
 * Opening one goes through `openProjectByPath` exactly as a local project does. The
 * editor's adapter decides which world the identifier belongs to, so nothing here — and
 * nothing in the save flow afterwards — has to know the project came from the cloud.
 *
 * THE SPACE IS RESERVED, always. Once a build has an Edge account the heading stays put
 * whether or not anyone is signed in, so the start screen does not reflow underneath the
 * user the moment a session resolves — and so someone who has never signed in still
 * learns that the space is theirs to fill.
 *
 * WHY IT DOES NOT ASK WHO IS SIGNED IN. Mounting a second account hook beside the menu's
 * would mean a second `/auth/me` on every start. The list request already reports which
 * kind of nothing it found, which is enough. What it does subscribe to is the session's
 * own restored/expired signal — which is what makes the projects appear the moment
 * someone signs in through the menu, and go away when they sign out, with no polling and
 * no extra request.
 */

import { useCallback, useEffect, useState } from 'react'

import type { CloudProjectsResult, CloudProjectSummary } from '../../../../../middleware/shared/ports/project-port'
import { useCapabilities, useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { File } from '../../../_atoms/file'
import { toast } from '../../[app]/toast/use-toast'

/**
 * Five, as the product asks. It is a shortcut to recent work, not a project browser —
 * Edge's own SPA is where someone goes to see everything.
 */
const RECENT_LIMIT = 5

export type StartCloudProjectsProps = {
  /** Same filter box the local list uses, so one search covers both sections. */
  searchNameFilterValue: string
}

const StartCloudProjects = ({ searchNameFilterValue }: StartCloudProjectsProps) => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const project = useProject()
  const {
    sharedWorkspaceActions: { handleOpenProjectResponse },
  } = useOpenPLCStore()

  /** `null` until the first answer lands — which is not the same as having none. */
  const [result, setResult] = useState<CloudProjectsResult | null>(null)

  const available = caps.hasEdgeAccount && project.listRecentCloudProjects !== undefined

  const load = useCallback(async () => {
    if (!project.listRecentCloudProjects) {
      return
    }

    // `catch` because this is the ONLY thing standing between a failed IPC call and the
    // start screen: a rejection inside this effect takes the whole renderer down, which
    // is exactly what happened when the list was called against a main process that did
    // not have the channel yet. A cloud list nobody asked for must never cost someone
    // their local projects.
    setResult(
      await project.listRecentCloudProjects(RECENT_LIMIT).catch((): CloudProjectsResult => ({ status: 'unreachable' })),
    )
  }, [project])

  useEffect(() => {
    if (!available) {
      return
    }

    void load()
  }, [available, load])

  // The session's own signal, not a poll: signing in through the menu makes the list
  // appear, and signing out empties it, without either component knowing about the other.
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
      // The adapter's own message, which distinguishes "not signed in" from "Edge
      // answered 403" from "could not reach Edge" — all three are actionable and all
      // three are different.
      description: result.error?.description ?? `${summary.name} could not be opened.`,
      variant: 'fail',
    })
  }

  const filter = searchNameFilterValue.trim().toLowerCase()
  const projects = result?.status === 'ok' ? result.projects : []
  const visible = filter ? projects.filter((summary) => summary.name.toLowerCase().includes(filter)) : projects

  // Nothing at all only where there is no Edge account to speak of — the autonomy-node
  // build, or a platform with no such channel. Everywhere else the space is reserved.
  if (!available || result?.status === 'unavailable') {
    return null
  }

  return (
    // `mb-10` is the only spacing this section adds. The heading-to-cards rhythm is
    // `mb-6` (24px), so the gap BETWEEN the two sections has to be larger than that or
    // the local "Projects" heading reads as a label for the cloud cards above it.
    <section className='mb-10 flex w-full select-none flex-col pr-9 4xl:pr-0'>
      <h2 className='mb-6 flex cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Autonomy Edge Cloud Projects
      </h2>

      {/* One line for each kind of nothing, because they are not the same thing to say.
          Telling someone to sign in when they already are and are merely offline sends
          them to fix the wrong problem — which is why the list request reports which
          case it hit rather than answering with an empty array. */}
      {result === null ? (
        // Deliberately blank while the first answer is in flight: a returning user's
        // stored session is usually about to resolve, and flashing "Sign in" at them
        // first would be worse than a beat of nothing. The heading holds the space.
        <div className='h-[52px]' />
      ) : result.status === 'signed-out' ? (
        <p className='max-w-xl text-base text-neutral-600 dark:text-neutral-400'>
          Sign in with your Autonomy Edge account to access Edge features — your cloud projects, open here and saved
          straight back.
        </p>
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
              // The card's second line. A cloud project has no path on this machine, so
              // it says where it does live rather than inventing a local one.
              projectPath='Autonomy Edge'
              lastModified={new Date(summary.updatedAt).toLocaleString()}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export { StartCloudProjects }
