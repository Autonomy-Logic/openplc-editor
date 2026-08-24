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
 * WHY IT DOES NOT ASK WHO IS SIGNED IN. Mounting a second account hook beside the menu's
 * would mean a second `/auth/me` on every start. An empty list already means "nothing to
 * show", signed out included, so the section simply hides itself. What it does subscribe
 * to is the session's own restored/expired signal — which is what makes the list appear
 * the moment someone signs in through the menu, and vanish when they sign out, with no
 * polling and no extra request.
 */

import { useCallback, useEffect, useState } from 'react'

import type { CloudProjectSummary } from '../../../../../middleware/shared/ports/project-port'
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

  const [projects, setProjects] = useState<CloudProjectSummary[]>([])

  const available = caps.hasEdgeAccount && project.listRecentCloudProjects !== undefined

  const load = useCallback(async () => {
    if (!project.listRecentCloudProjects) {
      return
    }

    // Resolves empty for every "nothing to show" — signed out, offline, or an account
    // with no projects yet. None of those is worth a message on a screen the user came
    // to for their local work.
    //
    // `catch` because this is the ONLY thing standing between a failed IPC call and the
    // start screen: a rejection inside this effect takes the whole renderer down, which
    // is exactly what happened when the list was called against a main process that did
    // not have the channel yet. A cloud list nobody asked for must never cost someone
    // their local projects.
    setProjects(await project.listRecentCloudProjects(RECENT_LIMIT).catch(() => []))
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
    const unsubscribeExpired = edgeAccount.session.onExpired(() => setProjects([]))

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
  const visible = filter ? projects.filter((summary) => summary.name.toLowerCase().includes(filter)) : projects

  // Nothing at all rather than an empty heading. On a build with no Edge account, or with
  // nobody signed in, this section has nothing to say and should not take up the space
  // above someone's local projects.
  if (!available || visible.length === 0) {
    return null
  }

  return (
    <section className='flex w-full select-none flex-col pr-9 4xl:pr-0'>
      <h2 className='mb-6 flex cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Autonomy Edge projects
      </h2>
      <div className='flex h-auto w-full flex-wrap gap-[25px]'>
        {visible.map((summary) => (
          <File
            key={summary.id}
            onClick={() => void openProject(summary)}
            className='overflow-hidden'
            projectName={summary.name}
            // The card's second line. A cloud project has no path on this machine, so it
            // says where it does live rather than inventing a local one.
            projectPath='Autonomy Edge'
            lastModified={new Date(summary.updatedAt).toLocaleString()}
          />
        ))}
      </div>
    </section>
  )
}

export { StartCloudProjects }
