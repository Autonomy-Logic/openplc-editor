import { File, Folder, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PendingChange } from '../../../../../middleware/shared/ports/version-control-port'
import { useProject, useVersionControl } from '../../../../../middleware/shared/providers'
import { buildAllProjectFileContents, buildAllProjectFileContentsPure } from '../../../../services/save-actions'
import { useOpenPLCStore } from '../../../../store'
import type { TabsProps } from '../../../../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../../../../store/slices/tabs/utils'
import type { PendingChangeStatus } from '../../../../store/slices/version-control/types'
import { cn } from '../../../../utils/cn'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'
import { isSystemFile } from '../../../../utils/system-files'
import { toast } from '../../../../utils/toast'
import { DiscardConfirmationModal } from './modals/discard-confirmation-modal'
import { StashCreateModal } from './modals/stash-create-modal'

type ChangesSectionProps = {
  projectId: string
}

const STATUS_LABEL: Record<PendingChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
}

const STATUS_COLOR: Record<PendingChangeStatus, string> = {
  modified: 'text-yellow-500 dark:text-yellow-400',
  added: 'text-green-500 dark:text-green-400',
  deleted: 'text-red-500 dark:text-red-400',
}

const STATUS_TOOLTIP: Record<PendingChangeStatus, string> = {
  modified: 'Modified -- File has been changed since last commit',
  added: 'Added -- New file not in previous commit',
  deleted: 'Deleted -- File has been removed',
}

// ---------------------------------------------------------------------------
// Tree types & helpers
// ---------------------------------------------------------------------------

type ChangedFile = { path: string; status: PendingChangeStatus }

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  status?: PendingChangeStatus
  children?: FileTreeNode[]
}

function buildChangesTree(files: ChangedFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isFile = i === parts.length - 1

      let existing = current.find((n) => n.name === name)
      if (!existing) {
        existing = {
          name,
          path: parts.slice(0, i + 1).join('/'),
          type: isFile ? 'file' : 'folder',
          status: isFile ? file.status : undefined,
          children: isFile ? undefined : [],
        }
        current.push(existing)
      }
      if (!isFile) {
        if (!existing.children) {
          existing.children = []
          existing.type = 'folder'
        }
        current = existing.children
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }
  sortNodes(root)
  return root
}

function collectFilePaths(node: FileTreeNode): string[] {
  if (node.type === 'file') return [node.path]
  return node.children?.flatMap(collectFilePaths) ?? []
}

// ---------------------------------------------------------------------------
// Tree item component
// ---------------------------------------------------------------------------

function ChangesTreeItem({
  node,
  depth,
  selectedFiles,
  onToggleFile,
  onToggleFolder,
  expandedFolders,
  onExpandToggle,
  onFileClick,
}: {
  node: FileTreeNode
  depth: number
  selectedFiles: Set<string>
  onToggleFile: (path: string) => void
  onToggleFolder: (paths: string[], select: boolean) => void
  expandedFolders: Set<string>
  onExpandToggle: (path: string) => void
  onFileClick: (path: string) => void
}) {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders.has(node.path)
    const childPaths = collectFilePaths(node)
    const allChildrenSelected = childPaths.length > 0 && childPaths.every((p) => selectedFiles.has(p))
    const someChildrenSelected = childPaths.some((p) => selectedFiles.has(p))

    return (
      <div>
        <div
          className='flex items-center gap-1.5 rounded py-0.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800'
          style={{ paddingLeft: `${depth * 14 + 4}px`, paddingRight: '8px' }}
        >
          <input
            type='checkbox'
            checked={allChildrenSelected}
            ref={(el) => {
              if (el) el.indeterminate = someChildrenSelected && !allChildrenSelected
            }}
            onChange={() => onToggleFolder(childPaths, !allChildrenSelected)}
            onClick={(e) => e.stopPropagation()}
            className='h-3 w-3 shrink-0 cursor-pointer rounded border-neutral-300 accent-blue-500 dark:border-neutral-600'
          />
          <button onClick={() => onExpandToggle(node.path)} className='flex min-w-0 flex-1 items-center gap-1'>
            {isExpanded ? (
              <FolderOpen className='h-3.5 w-3.5 shrink-0 text-brand-light' />
            ) : (
              <Folder className='h-3.5 w-3.5 shrink-0 text-brand-light' />
            )}
            <span className='truncate text-xs font-medium text-neutral-600 dark:text-neutral-400'>{node.name}</span>
          </button>
          <span className='shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500'>{childPaths.length}</span>
        </div>
        {isExpanded &&
          node.children?.map((child) => (
            <ChangesTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFiles={selectedFiles}
              onToggleFile={onToggleFile}
              onToggleFolder={onToggleFolder}
              expandedFolders={expandedFolders}
              onExpandToggle={onExpandToggle}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    )
  }

  return (
    <div
      className='flex items-center gap-1.5 rounded py-0.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800'
      style={{ paddingLeft: `${depth * 14 + 4}px`, paddingRight: '8px' }}
    >
      <input
        type='checkbox'
        checked={selectedFiles.has(node.path)}
        onChange={() => onToggleFile(node.path)}
        onClick={(e) => e.stopPropagation()}
        className='h-3 w-3 shrink-0 cursor-pointer rounded border-neutral-300 accent-blue-500 dark:border-neutral-600'
      />
      <File className='h-3 w-3 shrink-0 text-neutral-400' />
      <button
        onClick={() => onFileClick(node.path)}
        className='min-w-0 flex-1 truncate text-left text-xs text-neutral-700 hover:underline dark:text-neutral-300'
      >
        {node.name}
      </button>
      <span
        className={cn(
          'w-4 shrink-0 text-right font-mono text-[10px] font-bold',
          node.status ? STATUS_COLOR[node.status] : 'text-neutral-500',
        )}
        title={node.status ? STATUS_TOOLTIP[node.status] : undefined}
      >
        {node.status ? STATUS_LABEL[node.status] : ''}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChangesSection({ projectId }: ChangesSectionProps) {
  const versionControl = useVersionControl()
  const projectPort = useProject()
  const {
    versionControlActions,
    sharedWorkspaceActions,
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors },
  } = useOpenPLCStore()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)

  // System files (e.g. legacy `git-data.tar.gz` from migration) ride along on
  // commits silently — they're never shown, never selectable, never discardable.
  // We keep them in a separate bucket so the UI never has to filter them out
  // again, and the commit path can pass them straight through.
  const [pendingFiles, setPendingFiles] = useState<{ visible: PendingChange[]; system: PendingChange[] }>({
    visible: [],
    system: [],
  })
  const visibleFiles = pendingFiles.visible
  const [isLoading, setIsLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [message, setMessage] = useState('')
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCommitting, setIsCommitting] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [showStashModal, setShowStashModal] = useState(false)
  const [isStashing, setIsStashing] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildChangesTree(visibleFiles), [visibleFiles])

  // Auto-expand all folders
  const folderKey = useMemo(() => {
    const folders = new Set<string>()
    for (const file of visibleFiles) {
      const parts = file.path.split('/').filter(Boolean)
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'))
      }
    }
    return folders
  }, [visibleFiles])

  const prevFolderKeyRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (folderKey.size > 0 && folderKey.size !== prevFolderKeyRef.current.size) {
      setExpandedFolders(folderKey)
      prevFolderKeyRef.current = folderKey
    }
  }, [folderKey])

  // Fetch changes
  const fetchChanges = useCallback(async () => {
    if (!versionControl) return
    setIsFetching(true)
    try {
      const data = await versionControl.getChanges(projectId)
      // Split into visible (user-facing) and system (silent passengers) once,
      // so subsequent renders and the commit path can read them directly
      // without re-filtering.
      const visible: PendingChange[] = []
      const system: PendingChange[] = []
      for (const c of data.changes) {
        if (isSystemFile(c.path)) system.push(c)
        else visible.push(c)
      }
      setPendingFiles({ visible, system })
      versionControlActions.syncFromChanges(visible.map((c) => ({ path: c.path, status: c.status })))
    } catch {
      setPendingFiles({ visible: [], system: [] })
    } finally {
      setIsLoading(false)
      setIsFetching(false)
    }
  }, [projectId, versionControl, versionControlActions])

  useEffect(() => {
    void fetchChanges()
  }, [fetchChanges])

  // Auto-select all files on initial load or when file list changes.
  // Only visible files are tracked in `selectedFiles`; system files are auto-
  // included at commit time regardless of selection.
  const fileListKey = useMemo(
    () =>
      visibleFiles
        .map((f) => f.path)
        .sort()
        .join('\n'),
    [visibleFiles],
  )
  const prevFileListKey = useRef(fileListKey)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (isInitialLoad.current || fileListKey !== prevFileListKey.current) {
      setSelectedFiles(new Set(visibleFiles.map((f) => f.path)))
      prevFileListKey.current = fileListKey
      isInitialLoad.current = false
    }
  }, [fileListKey, visibleFiles])

  const allSelected = visibleFiles.length > 0 && selectedFiles.size === visibleFiles.length
  const someSelected = selectedFiles.size > 0 && selectedFiles.size < visibleFiles.length

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleFolderFiles = (paths: string[], select: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      for (const p of paths) {
        if (select) next.add(p)
        else next.delete(p)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) setSelectedFiles(new Set())
    else setSelectedFiles(new Set(visibleFiles.map((f) => f.path)))
  }

  const toggleExpand = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Clicking any changed file opens a read-only diff tab in the editor area
  // (Working Tree ↔ HEAD), reusing the same diff view as the history page.
  // The tab name is namespaced with `Diff: ` so it never collides with the
  // editable POU tab of the same POU.
  const handleFileClick = useCallback(
    (filePath: string) => {
      const tab: TabsProps = {
        name: `Diff: ${filePath}`,
        elementType: { type: 'diff-viewer', filePath },
      }

      updateTabs(tab)
      const existing = getEditorFromEditors(tab.name)
      if (existing) {
        setEditor(existing)
        return
      }
      const model = CreateEditorObjectFromTab(tab)
      addModel(model)
      setEditor(model)
    },
    [updateTabs, getEditorFromEditors, addModel, setEditor],
  )

  const hasChanges = visibleFiles.length > 0
  const canCommit = message.trim().length > 0 && selectedFiles.size > 0

  const handleCommit = async () => {
    if (!canCommit || !versionControl) return
    // No write permission ⇒ skip the doomed backend commit and warn.
    if (!canEdit) {
      notifyNoWritePermission('commit to')
      return
    }

    setIsCommitting(true)
    setErrorMessage(null)

    try {
      // Re-fetch to avoid stale state. Split into visible/system once so the
      // commit path doesn't re-filter and so we can detect whether the user
      // selected literally everything (passing `undefined` lets the backend
      // commit all pending changes in one shot).
      const freshData = await versionControl.getChanges(projectId)
      const freshVisible: PendingChange[] = []
      const freshSystem: PendingChange[] = []
      for (const c of freshData.changes) {
        if (isSystemFile(c.path)) freshSystem.push(c)
        else freshVisible.push(c)
      }
      if (freshVisible.length + freshSystem.length === 0) {
        setIsCommitting(false)
        return
      }

      const validUserPaths = [...selectedFiles].filter((p) => freshVisible.some((f) => f.path === p))
      if (validUserPaths.length === 0) {
        setIsCommitting(false)
        return
      }

      // Always include system-file changes — the user never sees or controls
      // them, but they ride along on whatever the user commits so they don't
      // pile up as ghost pending changes.
      const freshSystemPaths = freshSystem.map((f) => f.path)
      const pathsToCommit = [...validUserPaths, ...freshSystemPaths]
      const totalFresh = freshVisible.length + freshSystem.length

      await versionControl.createCommit(
        projectId,
        message.trim(),
        pathsToCommit.length === totalFresh ? undefined : pathsToCommit,
      )

      // Commit landed: S3 == HEAD again. Refresh the version-control
      // baseline to the just-committed state and clear all pending lists.
      // We pass two snapshots: the actual upload (mixed raw + serialized,
      // for diff baseline) and the pure serialization of current state
      // (for the save flow's "state == sync state?" detection).
      versionControlActions.commitBaseline({
        newBaseline: buildAllProjectFileContents(),
        loadedSerialized: buildAllProjectFileContentsPure(),
      })

      setMessage('')
      setSelectedFiles(new Set())
      await fetchChanges()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create commit'
      setErrorMessage(msg)
    } finally {
      setIsCommitting(false)
    }
  }

  const handleDiscard = async () => {
    if (!versionControl) return
    // No write permission ⇒ skip the doomed backend discard and warn.
    if (!canEdit) {
      notifyNoWritePermission('discard changes in')
      return
    }

    setIsDiscarding(true)
    setErrorMessage(null)

    try {
      // Discard only what the user explicitly selected — never `undefined`
      // (which would also discard system-file changes the user can't see).
      const selectedPaths = [...selectedFiles]
      await versionControl.discardChanges(projectId, selectedPaths)
      setShowDiscardModal(false)

      // Reload project data in-place (no hard page reload)
      try {
        const result = await projectPort.openProjectByPath(projectId)
        if (result.success && result.data) {
          sharedWorkspaceActions.handleOpenProjectResponse(result.data)
        }
      } catch {
        toast({ title: 'Failed to reload project after discard', variant: 'fail' })
      }
      await fetchChanges()
    } catch (error) {
      setShowDiscardModal(false)
      const msg = error instanceof Error ? error.message : 'Failed to discard changes'
      setErrorMessage(msg)
    } finally {
      setIsDiscarding(false)
    }
  }

  const handleStash = async (stashMessage: string) => {
    if (!versionControl) return
    // No write permission ⇒ skip the doomed backend stash and warn.
    if (!canEdit) {
      notifyNoWritePermission('stash changes in')
      return
    }

    setIsStashing(true)
    setErrorMessage(null)

    try {
      // Stash only the explicitly selected visible files — same rationale as
      // discard: never sweep in system-file changes the user can't see.
      const selectedPaths = [...selectedFiles]
      await versionControl.createStash(projectId, stashMessage || undefined, selectedPaths)
      setShowStashModal(false)

      // Stashing reverts the working tree to HEAD — reload in place so the
      // editor reflects the reverted files, then re-sync the changes badge.
      try {
        const result = await projectPort.openProjectByPath(projectId)
        if (result.success && result.data) {
          sharedWorkspaceActions.handleOpenProjectResponse(result.data)
        }
      } catch {
        toast({ title: 'Failed to reload project after stash', variant: 'fail' })
      }
      await fetchChanges()
      toast({ title: 'Changes stashed' })
    } catch (error) {
      setShowStashModal(false)
      const msg = error instanceof Error ? error.message : 'Failed to stash changes'
      setErrorMessage(msg)
    } finally {
      setIsStashing(false)
    }
  }

  if (isLoading) {
    return (
      <div className='space-y-2 p-3'>
        {[...Array(3)].map((_, i) => (
          <div key={i} className='h-5 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800' />
        ))}
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {/* Subheader */}
      <div className='flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-700'>
        <div className='flex items-center gap-2'>
          {hasChanges && (
            <input
              type='checkbox'
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected
              }}
              onChange={toggleAll}
              title={allSelected ? 'Deselect all' : 'Select all'}
              className='h-3 w-3 cursor-pointer rounded border-neutral-300 accent-blue-500 dark:border-neutral-600'
            />
          )}
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            {!hasChanges
              ? 'No changes'
              : someSelected
                ? `${selectedFiles.size} of ${visibleFiles.length} selected`
                : `${visibleFiles.length} file${visibleFiles.length > 1 ? 's' : ''} changed`}
          </span>
        </div>
        <button
          onClick={() => {
            setSelectedFiles(new Set())
            void fetchChanges()
          }}
          disabled={isFetching}
          title='Sync changes'
          className='rounded p-1 transition-colors duration-150 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800'
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='13'
            height='13'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            className={cn('text-neutral-500 dark:text-neutral-400', isFetching && 'animate-spin')}
          >
            <path d='M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' />
            <path d='M3 3v5h5' />
            <path d='M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' />
            <path d='M16 21h5v-5' />
          </svg>
        </button>
      </div>

      {/* File tree */}
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {!hasChanges ? (
          <p className='px-3 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400'>No changes to commit</p>
        ) : (
          <div className='py-1'>
            {tree.map((node) => (
              <ChangesTreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedFiles={selectedFiles}
                onToggleFile={toggleFile}
                onToggleFolder={toggleFolderFiles}
                expandedFolders={expandedFolders}
                onExpandToggle={toggleExpand}
                onFileClick={handleFileClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {errorMessage && (
        <div className='mx-3 mt-2 shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-800 dark:bg-red-900/20'>
          <div className='flex items-start justify-between gap-1'>
            <p className='text-xs text-red-600 dark:text-red-400'>{errorMessage}</p>
            <button
              onClick={() => setErrorMessage(null)}
              className='shrink-0 text-xs text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300'
            >
              {'\u2715'}
            </button>
          </div>
        </div>
      )}

      {/* Commit form */}
      <div className='shrink-0 space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-700'>
        <div className='relative'>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 500))}
            placeholder='Commit message...'
            rows={3}
            className='w-full resize-none rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:placeholder-neutral-500'
          />
          <span className='absolute bottom-2 right-2 text-xs text-neutral-400 dark:text-neutral-500'>
            {message.length}/500
          </span>
        </div>
        <div className='flex gap-2'>
          <button
            onClick={() => void handleCommit()}
            disabled={!canCommit || isCommitting}
            className='flex-1 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
          <button
            onClick={() => setShowStashModal(true)}
            disabled={selectedFiles.size === 0 || isStashing}
            title='Stash selected changes for later'
            className='rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors duration-150 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-400'
          >
            {isStashing ? 'Stashing...' : 'Stash'}
          </button>
          <button
            onClick={() => setShowDiscardModal(true)}
            disabled={selectedFiles.size === 0 || isDiscarding}
            className='rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-red-900/30 dark:hover:text-red-400'
          >
            Discard
          </button>
        </div>
      </div>

      <DiscardConfirmationModal
        isOpen={showDiscardModal}
        isLoading={isDiscarding}
        fileCount={selectedFiles.size}
        totalCount={visibleFiles.length}
        onConfirm={() => void handleDiscard()}
        onCancel={() => setShowDiscardModal(false)}
      />

      <StashCreateModal
        isOpen={showStashModal}
        isLoading={isStashing}
        fileCount={selectedFiles.size}
        totalCount={visibleFiles.length}
        onConfirm={(stashMessage) => void handleStash(stashMessage)}
        onCancel={() => setShowStashModal(false)}
      />
    </div>
  )
}
