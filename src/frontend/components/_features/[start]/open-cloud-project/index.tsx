/**
 * Browse the Autonomy Edge folder tree and open a project from it — the same
 * structure Edge's own sidebar shows, so a user who filed projects into folders
 * finds them where they put them instead of hunting through "the five most
 * recent" on the start screen.
 *
 * Two panes: folders on the left (the flattened tree the upload flow already
 * reads), the selected folder's projects on the right. Opening goes through the
 * same call the start-screen cards use, so a locked project is refused the same
 * way and with the same words.
 */

import { CloudDownload, FolderOpen, Loader2, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  CloudFolder,
  CloudFoldersResult,
  CloudProjectsResult,
  CloudProjectSummary,
} from '../../../../../middleware/shared/ports/project-port'
import { useCapabilities, useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { EdgeSignInModal } from '../../../_organisms/edge-sign-in-modal'
import { toast } from '../../[app]/toast/use-toast'
import { LOCKED_REASON, LOCKED_TOOLTIP } from '../cloud-projects'

export type OpenCloudProjectModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Same connector the upload flow draws, so the two trees read as one thing. */
function folderConnector(depth: number): string {
  return depth === 0 ? '' : `${'    '.repeat(depth - 1)}└── `
}

const OpenCloudProjectModal = ({ open, onOpenChange }: OpenCloudProjectModalProps) => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const project = useProject()
  const handleOpenProjectResponse = useOpenPLCStore(
    useCallback((state) => state.sharedWorkspaceActions.handleOpenProjectResponse, []),
  )

  /** `null` until the first answer lands — which is not the same as having none. */
  const [folders, setFolders] = useState<CloudFoldersResult | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [projects, setProjects] = useState<CloudProjectsResult | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  const canBrowse =
    caps.hasEdgeAccount && project.listCloudFolders !== undefined && project.listCloudProjectsInFolder !== undefined

  const loadFolders = useCallback(async () => {
    if (!project.listCloudFolders) return

    // An unhandled rejection here takes down the whole renderer, not just this dialog.
    const result = await project.listCloudFolders().catch((): CloudFoldersResult => ({ status: 'unreachable' }))
    setFolders(result)

    // Land on the root, which is what Edge's sidebar opens on too.
    if (result.status === 'ok' && result.folders.length > 0) {
      setSelectedFolderId((current) => current ?? result.folders[0].id)
    }
  }, [project])

  const loadProjects = useCallback(
    async (folderId: string) => {
      if (!project.listCloudProjectsInFolder) return

      setProjects(null)
      setProjects(
        await project
          .listCloudProjectsInFolder(folderId)
          .catch((): CloudProjectsResult => ({ status: 'unreachable' })),
      )
    },
    [project],
  )

  // Fresh on every open: folders and projects change on Edge while the dialog is closed.
  useEffect(() => {
    if (!open || !canBrowse) return

    setFolders(null)
    setProjects(null)
    setSelectedFolderId(null)
    void loadFolders()
  }, [open, canBrowse, loadFolders])

  useEffect(() => {
    if (!open || selectedFolderId === null) return

    void loadProjects(selectedFolderId)
  }, [open, selectedFolderId, loadProjects])

  const openProject = async (summary: CloudProjectSummary) => {
    // Refused here rather than on the way back: Edge answers 403 to every write on
    // this project, so opening it would only lead to a save that fails.
    if (summary.locked) {
      toast({ title: 'This project is locked.', description: LOCKED_REASON, variant: 'fail' })

      return
    }

    setOpening(summary.id)
    const result = await project.openProjectByPath(summary.id)
    setOpening(null)

    if (result.success && result.data) {
      handleOpenProjectResponse(result.data)
      onOpenChange(false)

      return
    }

    toast({
      title: 'Cannot open the project.',
      description: result.error?.description ?? `${summary.name} could not be opened.`,
      variant: 'fail',
    })
  }

  // `edgeAccount` is checked here, once, so the rest of the render can use it without a null check.
  if (!canBrowse || !edgeAccount) {
    return null
  }

  const folderList: CloudFolder[] = folders?.status === 'ok' ? folders.folders : []
  const selectedFolder = folderList.find((folder) => folder.id === selectedFolderId)

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='flex h-[560px] max-h-[92vh] w-[760px] select-none flex-col gap-0 overflow-hidden rounded-xl px-7 py-6'>
        <div className='mb-4 flex items-center gap-3'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-brand'>
            <CloudDownload className='size-5' />
          </span>
          <ModalTitle className='text-xl font-normal text-neutral-900 dark:text-neutral-100'>
            Open from Autonomy Edge
          </ModalTitle>
        </div>

        {folders === null ? (
          <div className='flex flex-1 items-center justify-center gap-2 text-sm text-neutral-500' role='status'>
            <Loader2 className='size-4 animate-spin' /> Loading your folders…
          </div>
        ) : folders.status === 'signed-out' ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 text-center'>
            <p className='max-w-md text-sm text-neutral-600 dark:text-neutral-400'>
              Sign in with your Autonomy Edge account to browse your cloud projects.
            </p>
            <button
              type='button'
              onClick={() => setSignInOpen(true)}
              className='cursor-pointer rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark'
            >
              Sign in
            </button>
          </div>
        ) : folders.status !== 'ok' ? (
          <p className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
            Could not reach Autonomy Edge. Your local projects are unaffected.
          </p>
        ) : (
          <div className='flex min-h-0 flex-1 gap-4'>
            {/* Folders */}
            <nav
              aria-label='Folders'
              className='flex w-[280px] shrink-0 flex-col gap-0.5 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800'
            >
              {folderList.map((folder) => {
                const selected = folder.id === selectedFolderId

                return (
                  <button
                    key={folder.id}
                    type='button'
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={cn(
                      'flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm',
                      // `blue-500`, not `brand`: the brand token is a hex `var()`, and Tailwind 3 can't apply `/10` to it.
                      selected
                        ? 'bg-blue-500/10 font-medium text-neutral-900 dark:bg-blue-500/20 dark:text-neutral-100'
                        : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                    )}
                  >
                    {/* Only the branch is monospaced, so sibling connectors line up. */}
                    {folder.depth > 0 && (
                      <span aria-hidden className='whitespace-pre font-mono text-neutral-400 dark:text-neutral-600'>
                        {folderConnector(folder.depth)}
                      </span>
                    )}
                    <FolderOpen className='size-4 shrink-0 text-brand' />
                    <span className='truncate'>{folder.name}</span>
                  </button>
                )
              })}
            </nav>

            {/* Projects in the selected folder */}
            <section
              aria-label={selectedFolder ? `Projects in ${selectedFolder.name}` : 'Projects'}
              className='flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800'
            >
              {projects === null ? (
                <div className='flex flex-1 items-center justify-center gap-2 text-sm text-neutral-500' role='status'>
                  <Loader2 className='size-4 animate-spin' /> Loading projects…
                </div>
              ) : projects.status !== 'ok' ? (
                <p className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
                  Could not list the projects in this folder.
                </p>
              ) : projects.projects.length === 0 ? (
                <p className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
                  No projects in this folder.
                </p>
              ) : (
                projects.projects.map((summary) => (
                  <button
                    key={summary.id}
                    type='button'
                    disabled={opening !== null}
                    title={summary.locked ? LOCKED_TOOLTIP : undefined}
                    onClick={() => void openProject(summary)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left',
                      'hover:bg-neutral-100 disabled:cursor-wait dark:hover:bg-neutral-800',
                      summary.locked && 'opacity-60',
                    )}
                  >
                    <span className='flex min-w-0 flex-1 flex-col'>
                      <span className='truncate text-sm font-medium text-neutral-900 dark:text-neutral-100'>
                        {summary.name}
                      </span>
                      <span className='text-xs text-neutral-500'>{new Date(summary.updatedAt).toLocaleString()}</span>
                    </span>
                    {summary.locked ? (
                      <Lock aria-label={LOCKED_TOOLTIP} className='size-4 shrink-0 text-neutral-500' />
                    ) : opening === summary.id ? (
                      <Loader2 className='size-4 shrink-0 animate-spin text-brand' />
                    ) : null}
                  </button>
                ))
              )}
            </section>
          </div>
        )}

        <EdgeSignInModal
          open={signInOpen}
          onOpenChange={setSignInOpen}
          account={edgeAccount}
          reason='signed-out'
          onSignedIn={() => {
            setSignInOpen(false)
            void loadFolders()
          }}
        />
      </ModalContent>
    </Modal>
  )
}

export { OpenCloudProjectModal }
