/**
 * Publishing a project from this machine to Autonomy Edge.
 *
 * The desktop's answer to Edge's own "Import project" dialog, and it asks for the same
 * three things: where it goes, what it is called, and whether anyone else can see it. The
 * difference is what the user has to do — on the web they are told to zip the folder
 * themselves ("right-click → Compress"), while here the project is already on disk with a
 * path the editor holds, so it makes the archive. Nothing about that belongs on screen.
 *
 * WHY EACH FAILURE GETS ITS OWN SENTENCE. Publishing can fail for reasons with completely
 * different remedies: a folder that was never an OpenPLC project, a project too large for
 * the importer, a name already taken, a dropped connection. The last is the one worth
 * being careful about — the import is not idempotent, so an unanswered request may have
 * created the project anyway, and telling someone it failed would invite a duplicate.
 */

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

/**
 * The branch drawn to the left of a folder's name.
 *
 * Box-drawing characters rather than plain indentation: at one or two levels an indent
 * alone reads as a list that happens to be ragged, while a connector says the thing that
 * matters — this folder is INSIDE that one, and picking it puts the project there. The
 * same shape Edge's own import dialog uses, so the two products describe one hierarchy
 * the same way.
 */
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

  // Loaded on open rather than on mount: the modal lives beside every project card, and
  // asking Edge for folders because a menu exists would be a request per card.
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
    if (!project.uploadProjectToCloud || !parentFolderId) {
      return
    }

    setBusy(true)
    setError(null)

    const trimmed = name.trim()
    const result = await project.uploadProjectToCloud({
      projectPath,
      parentFolderId,
      // Omitted when unchanged, so the importer keeps using the name in project.json
      // rather than being handed the same value twice.
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
              {/* A tree, not a dropdown. The whole hierarchy is worth seeing at once —
                  choosing where a project lands is the decision this dialog exists for,
                  and a collapsed control hides the very structure being chosen from.
                  Scrolls past a handful so a deep account cannot push the buttons off.

                  Native radios underneath, visually hidden: they carry the arrow-key
                  navigation, the focus ring and the screen-reader semantics that a
                  hand-rolled listbox would have to reimplement, usually worse. */}
              <div className='max-h-[220px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1.5 dark:border-neutral-700 dark:bg-neutral-900'>
                {folders.folders.map((folder) => {
                  const selected = folder.id === parentFolderId

                  return (
                    <label
                      key={folder.id}
                      className={cn(
                        'flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm transition-colors',
                        // `blue-500` and not `brand` wherever an opacity modifier is
                        // involved: the brand token is a `var()` holding a hex, and
                        // Tailwind 3 cannot reliably apply `/10` to that. Same colour,
                        // same substitution the cloud-projects card documents.
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
                      {/* Monospaced so the connectors of sibling rows line up. Only the
                          branch is monospaced — the folder's own name stays in the UI
                          font, because a name is text, not a diagram. */}
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
