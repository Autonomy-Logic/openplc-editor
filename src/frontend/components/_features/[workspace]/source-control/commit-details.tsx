import { ChevronDown, ChevronRight, File } from 'lucide-react'
import { useState } from 'react'

import type { Commit, CommitFile } from '../../../../../middleware/shared/ports/version-control-port'
import { useNavigation, useProject, useVersionControl } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'
import { toast } from '../../../../utils/toast'
import { RestoreConfirmationModal } from './modals/restore-confirmation-modal'

type CommitDetailsProps = {
  commit: Commit
  projectId: string
}

export function CommitDetails({ commit, projectId }: CommitDetailsProps) {
  const versionControl = useVersionControl()
  const navigation = useNavigation()
  const {
    project: {
      meta: { path: storedProjectId },
    },
    sharedWorkspaceActions,
  } = useOpenPLCStore()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const projectPort = useProject()

  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [files, setFiles] = useState<CommitFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)

  const effectiveProjectId = projectId || storedProjectId

  const formattedDate = new Date(commit.timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const handleToggleFiles = () => {
    const next = !showFiles
    setShowFiles(next)

    if (next && files.length === 0 && versionControl) {
      setFilesLoading(true)
      versionControl
        .getCommitFiles(effectiveProjectId, commit.hash)
        .then(({ files: f }) => setFiles(f))
        .catch(() => setFiles([]))
        .finally(() => setFilesLoading(false))
    }
  }

  const handleViewFiles = () => {
    navigation.openInNewWindow('/history', {
      project_id: effectiveProjectId,
      commit_hash: commit.hash,
    })
  }

  const handleFileClick = (filePath: string) => {
    navigation.openInNewWindow('/history', {
      project_id: effectiveProjectId,
      commit_hash: commit.hash,
      file: filePath,
    })
  }

  const handleRestore = async () => {
    if (!versionControl) return
    // Restore overwrites the working tree from a past commit — a backend
    // write.  No write permission ⇒ skip it and warn.
    if (!canEdit) {
      notifyNoWritePermission('restore commits in')
      return
    }

    setIsRestoring(true)
    try {
      await versionControl.restoreCommit(effectiveProjectId, commit.hash)
      setShowRestoreModal(false)

      // Reload project data in-place (no hard page reload)
      const result = await projectPort.openProjectByPath(effectiveProjectId)
      if (result.success && result.data) {
        sharedWorkspaceActions.handleOpenProjectResponse(result.data)
        toast({ title: 'Restored to commit', description: commit.shortHash, variant: 'default' })
      }
    } catch {
      toast({ title: 'Failed to restore commit', variant: 'fail' })
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className='border-t border-neutral-200 bg-neutral-50 px-3 py-3 dark:border-neutral-700 dark:bg-neutral-900'>
      <p className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Commit Details</p>
      <div className='mb-3 space-y-1.5'>
        <div className='flex gap-2'>
          <span className='w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400'>Hash</span>
          <span className='truncate font-mono text-xs text-blue-500 dark:text-blue-400'>{commit.hash}</span>
        </div>
        <div className='flex gap-2'>
          <span className='w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400'>Author</span>
          <span className='truncate text-xs text-neutral-700 dark:text-neutral-300'>{commit.author}</span>
        </div>
        <div className='flex gap-2'>
          <span className='w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400'>Date</span>
          <span className='text-xs text-neutral-700 dark:text-neutral-300'>{formattedDate}</span>
        </div>
        <div className='flex gap-2'>
          <span className='w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400'>Message</span>
          <span className='break-words text-xs text-neutral-700 dark:text-neutral-300'>{commit.message}</span>
        </div>
      </div>

      {/* File list toggle */}
      <button onClick={handleToggleFiles} className='group mb-2 flex w-full items-center gap-1 text-left'>
        {showFiles ? (
          <ChevronDown className='h-3 w-3 text-neutral-400 dark:text-neutral-500' />
        ) : (
          <ChevronRight className='h-3 w-3 text-neutral-400 dark:text-neutral-500' />
        )}
        <span className='text-xs font-medium text-neutral-600 transition-colors group-hover:text-neutral-800 dark:text-neutral-400 dark:group-hover:text-neutral-200'>
          Files{files.length > 0 ? ` (${files.length})` : ''}
        </span>
      </button>

      {showFiles && (
        <div className='mb-3 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
          {filesLoading ? (
            <div className='space-y-1 p-2'>
              {[...Array(3)].map((_, i) => (
                <div key={i} className='h-4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800' />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className='px-2 py-2 text-center text-xs text-neutral-400 dark:text-neutral-500'>No files</p>
          ) : (
            <ul className='max-h-40 overflow-y-auto'>
              {files.map((file) => {
                const fileName = file.path.split('/').pop() ?? file.path
                const dirPath = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') + '/' : ''
                return (
                  <li key={file.path}>
                    <button
                      onClick={() => handleFileClick(file.path)}
                      title={file.path}
                      className={cn(
                        'flex w-full items-center gap-1.5 px-2 py-1 text-left',
                        'transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20',
                      )}
                    >
                      <File className='h-3 w-3 shrink-0 text-neutral-400' />
                      <span className='shrink-0 text-xs text-neutral-700 dark:text-neutral-300'>{fileName}</span>
                      <span className='ml-auto truncate text-right text-xs text-neutral-400 dark:text-neutral-500'>
                        {dirPath}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className='flex flex-col gap-1.5'>
        <button
          onClick={handleViewFiles}
          className='w-full rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-blue-600'
        >
          View All Files
        </button>
        <button
          onClick={() => setShowRestoreModal(true)}
          className='w-full rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors duration-150 hover:bg-yellow-50 hover:text-yellow-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-400'
        >
          Restore to This Version
        </button>
      </div>

      <RestoreConfirmationModal
        isOpen={showRestoreModal}
        isLoading={isRestoring}
        commitHash={commit.hash}
        commitMessage={commit.message}
        onConfirm={handleRestore}
        onCancel={() => setShowRestoreModal(false)}
      />
    </div>
  )
}
