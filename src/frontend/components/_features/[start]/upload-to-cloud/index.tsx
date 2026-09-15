/** Publishing a project from this machine to Autonomy Edge, archiving it here instead of asking the user to zip it. */

import { CloudUpload, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { CloudFoldersResult, UploadProjectFailure } from '../../../../../middleware/shared/ports/project-port'
import { useProject } from '../../../../../middleware/shared/providers'
import { cn } from '../../../../utils/cn'
import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'

export type UploadToCloudModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absolute path of the project on this machine. */
  projectPath: string
  /** Its local name, offered as the default. */
  projectName: string
  /** Published successfully — the caller decides what to refresh. */
  onUploaded: (projectId: string | null) => void
}

/** What to say for each way this can fail. One sentence, and something to do about it. */
function describeFailure(failure: UploadProjectFailure): string {
  switch (failure.reason) {
    case 'no-manifest':
      return 'This folder has no project.json, so it is not an OpenPLC project the importer can read.'
    case 'empty':
      return 'This folder has no project files in it.'
    case 'too-many-files':
      return `This project has ${failure.count} files, which is more than the importer accepts.`
    case 'too-deep':
      return 'This project nests folders deeper than the importer accepts.'
    case 'file-too-large':
      return `${failure.relativePath} is ${Math.round(failure.bytes / (1024 * 1024))}MB, which is over the 50MB limit for a single file.`
    case 'too-large':
      return `This project is ${Math.round(failure.bytes / (1024 * 1024))}MB, which is over the 100MB limit.`
    case 'unreadable':
      return failure.message
    case 'signed-out':
      return 'Your Autonomy Edge session ended. Sign in again and retry.'
    case 'unreachable':
      // Deliberately not "the upload failed": it may well have succeeded.
      return 'Autonomy Edge could not be reached, so it is unclear whether the project was created. Check Autonomy Edge before trying again.'
    case 'rejected':
      return failure.message
    default: {
      const exhaustive: never = failure

      return `Publishing failed: ${JSON.stringify(exhaustive)}`
    }
  }
}

/** The branch drawn to the left of a folder's name, matching Edge's own import dialog. */
function folderConnector(depth: number): string {
  return depth === 0 ? '' : `${'    '.repeat(depth - 1)}└── `
}

const UploadToCloudModal = ({ open, onOpenChange, projectPath, projectName, onUploaded }: UploadToCloudModalProps) => {
  const project = useProject()

  const [folders, setFolders] = useState<CloudFoldersResult | null>(null)
  const [parentFolderId, setParentFolderId] = useState('')
  const [name, setName] = useState(projectName)
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFolders = useCallback(async () => {
    if (!project.listCloudFolders) {
      setFolders({ status: 'unreachable' })

      return
    }

    const result = await project.listCloudFolders()

    setFolders(result)

    if (result.status === 'ok' && result.folders.length > 0) {
      // The account root is first, and it is the destination that always exists.
      setParentFolderId(result.folders[0].id)
    }
  }, [project])

  // Loaded on open, not on mount — the modal lives beside every project card.
  useEffect(() => {
    if (!open) {
      return
    }

    setError(null)
    setName(projectName)
    setVisibility('private')
    setFolders(null)
    void loadFolders()
  }, [open, projectName, loadFolders])

  const publish = async () => {
    if (!parentFolderId) {
      return
    }

    if (!project.uploadProjectToCloud) {
      setError('This build of the editor cannot publish to Autonomy Edge.')

      return
    }

    setBusy(true)
    setError(null)

    const trimmed = name.trim()
    const result = await project.uploadProjectToCloud({
      projectPath,
      parentFolderId,
      // Omitted when unchanged, so the importer keeps using the name already in project.json.
      projectName: trimmed && trimmed !== projectName ? trimmed : undefined,
      visibility,
    })

    setBusy(false)

    if (result.status === 'ok') {
      onUploaded(result.projectId)
      onOpenChange(false)

      return
    }

    setError(describeFailure(result.failure))
  }

  const ready = folders?.status === 'ok' && parentFolderId.length > 0

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='flex h-fit max-h-[92vh] w-[440px] select-none flex-col gap-0 overflow-y-auto rounded-xl px-7 py-6'>
        <span className='mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-brand'>
          <CloudUpload className='size-5' />
        </span>
        <ModalTitle className='text-center text-xl font-normal text-neutral-900 dark:text-neutral-100'>
          Upload to Autonomy Edge
        </ModalTitle>
        <p className='mb-5 mt-1 text-center text-sm text-neutral-600 dark:text-neutral-400'>
          This project stays on your computer. A copy is created on Autonomy Edge.
        </p>

        {folders === null ? (
          <div className='flex items-center justify-center gap-2 py-8 text-sm text-neutral-500'>
            <Loader2 className='size-4 animate-spin' />
            Loading your folders...
          </div>
        ) : folders.status === 'signed-out' ? (
          <p className='py-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
            Sign in to your Autonomy Edge account to publish this project.
          </p>
        ) : folders.status === 'unreachable' ? (
          <div className='flex flex-col items-center gap-3 py-6'>
            <p className='text-center text-sm text-neutral-600 dark:text-neutral-400'>
              Autonomy Edge could not be reached. Your project on this computer is unaffected.
            </p>
            <button
              type='button'
              onClick={() => void loadFolders()}
              className='cursor-pointer text-sm font-medium text-brand hover:underline'
            >
              Try again
            </button>
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            <fieldset className='flex flex-col gap-1.5'>
              <legend className='mb-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Destination folder
              </legend>
              {/* Native radios underneath, visually hidden, for arrow-key nav and screen-reader semantics for free. */}
              <div className='max-h-[220px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1.5 dark:border-neutral-700 dark:bg-neutral-900'>
                {folders.folders.map((folder) => {
                  const selected = folder.id === parentFolderId

                  return (
                    <label
                      key={folder.id}
                      className={cn(
                        'flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm transition-colors',
                        // `blue-500`, not `brand`: the brand token is a hex `var()`, and Tailwind 3 can't apply `/10` to it.
                        'focus-within:ring-2 focus-within:ring-blue-500/40',
                        selected
                          ? 'bg-blue-500/10 font-medium text-neutral-900 dark:bg-blue-500/20 dark:text-neutral-100'
                          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                      )}
                    >
                      <input
                        type='radio'
                        name='destination-folder'
                        value={folder.id}
                        checked={selected}
                        onChange={() => setParentFolderId(folder.id)}
                        className='sr-only'
                      />
                      {/* Only the branch is monospaced, so sibling connectors line up. */}
                      {folder.depth > 0 && (
                        <span aria-hidden className='whitespace-pre font-mono text-neutral-400 dark:text-neutral-600'>
                          {folderConnector(folder.depth)}
                        </span>
                      )}
                      <span className='truncate'>{folder.name}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <label className='flex flex-col gap-1.5'>
              <span className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>Project name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className='rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
              />
            </label>

            <fieldset className='flex flex-col gap-1.5'>
              <legend className='mb-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Visibility</legend>
              {/* Private first, and selected: publishing someone's control program to the
                  world is not a default anyone should get by pressing Enter. */}
              {(['private', 'public'] as const).map((option) => (
                <label key={option} className='flex cursor-pointer items-center gap-2 text-sm'>
                  <input
                    type='radio'
                    name='visibility'
                    value={option}
                    checked={visibility === option}
                    onChange={() => setVisibility(option)}
                    className='cursor-pointer'
                  />
                  <span className='text-neutral-800 dark:text-neutral-200'>
                    {option === 'private' ? 'Private' : 'Public'}
                  </span>
                  <span className='text-xs text-neutral-500'>
                    {option === 'private' ? 'Only you and people you share it with' : 'Anyone can find and view it'}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {error && (
          <p className='mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400'>{error}</p>
        )}

        <div className='mt-6 flex items-center justify-end gap-3'>
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className='cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={() => void publish()}
            disabled={!ready || busy}
            className='flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            {busy && <Loader2 className='size-4 animate-spin' />}
            {busy ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { UploadToCloudModal }
