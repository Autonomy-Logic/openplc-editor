/**
 * One commit, file by file, with the diff for whichever file is selected.
 *
 * Reached from the source-control panel's "View all files". It is a whole screen rather
 * than a panel because that is what the content needs: a graphical diff of a ladder or
 * FBD program next to its previous version does not fit in a sidebar.
 *
 * PLATFORM-FREE ON PURPOSE. This owns the tree, the statuses, the search and the restore
 * flow, and it takes `onBack`/`onRestored` instead of navigating. The web wraps it in a
 * router page at `/history`; the desktop, which has no router, renders it as a full-screen
 * layer over the workspace. Both get the same screen from the same code — which is the
 * only way the two stay identical as this grows.
 *
 * `h-full w-full` rather than `h-screen w-screen` for that reason: the viewport is the
 * host's business, and a screen-sized child inside a layered container overflows it.
 */

import { ArrowLeft, File, Folder, FolderOpen, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { CommitFile, CommitInfo } from '../../../../../middleware/shared/ports/version-control-port'
import { useTheme, useVersionControl } from '../../../../../middleware/shared/providers'
import { cn } from '../../../../utils/cn'
import { isSystemFile } from '../../../../utils/system-files'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../../_organisms/panel'
import { FileDiffView, isGraphicalFile } from '../editor/diff-viewer'
import { RestoreConfirmationModal } from '../source-control/modals/restore-confirmation-modal'

// ---------------------------------------------------------------------------
// File tree types & helpers
// ---------------------------------------------------------------------------

type FileStatus = 'A' | 'M' | 'D' | 'U'

const FILE_STATUS_CONFIG: Record<FileStatus, { label: string; color: string }> = {
  A: { label: 'Added', color: 'text-green-500' },
  M: { label: 'Modified', color: 'text-yellow-500' },
  D: { label: 'Deleted', color: 'text-red-500' },
  U: { label: 'Unchanged', color: 'text-neutral-400' },
}

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  status?: FileStatus
  children?: FileTreeNode[]
}

function buildTree(files: { path: string; content: string; status?: FileStatus }[]): FileTreeNode[] {
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

// ---------------------------------------------------------------------------
// File tree item
// ---------------------------------------------------------------------------

function FileStatusBadge({ status }: { status: FileStatus }) {
  const config = FILE_STATUS_CONFIG[status]
  return (
    <span title={config.label} className={cn('shrink-0 text-[10px] font-bold leading-none', config.color)}>
      {status}
    </span>
  )
}

function FileTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  node: FileTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
}) {
  const isExpanded = expandedFolders.has(node.path)
  const isSelected = node.path === selectedPath

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => onToggleFolder(node.path)}
          className='flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800'
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded ? (
            <FolderOpen className='h-3.5 w-3.5 shrink-0 text-brand-light' />
          ) : (
            <Folder className='h-3.5 w-3.5 shrink-0 text-brand-light' />
          )}
          <span className='truncate text-xs text-neutral-700 dark:text-neutral-300'>{node.name}</span>
        </button>
        {isExpanded &&
          node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors',
        isSelected
          ? 'bg-brand-light/10 dark:bg-brand-light/20 text-brand-light'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <File className='h-3.5 w-3.5 shrink-0 text-neutral-400' />
      <span className='flex-1 truncate text-xs'>{node.name}</span>
      {node.status && <FileStatusBadge status={node.status} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// History page
// ---------------------------------------------------------------------------

export type CommitHistoryViewProps = {
  projectId: string
  commitHash: string
  /** Pre-selected file, so clicking one in the panel lands on its diff. */
  initialFile?: string
  /** Leave the screen. The host decides what that means. */
  onBack: () => void
  /**
   * A restore landed, so the project on disk no longer matches what is on screen. The
   * host has to reload it — this component cannot, and pretending otherwise would leave
   * the user editing a stale copy.
   */
  onRestored: () => void
}

export function CommitHistoryView({ projectId, commitHash, initialFile, onBack, onRestored }: CommitHistoryViewProps) {
  const versionControl = useVersionControl()
  const themePort = useTheme()

  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<CommitFile[]>([])
  const [parentFiles, setParentFiles] = useState<CommitFile[]>([])
  const [commit, setCommit] = useState<CommitInfo | null>(null)

  const isDark = themePort.getCurrentTheme() === 'dark'

  // Fetch commit files via port
  useEffect(() => {
    if (!versionControl) return
    setIsLoading(true)
    setError(null)

    versionControl
      .getCommitFiles(projectId, commitHash)
      .then((data) => {
        setFiles(data.files)
        setParentFiles(data.parentFiles)
        setCommit(data.commit)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load commit files')
      })
      .finally(() => setIsLoading(false))
  }, [projectId, commitHash, versionControl])

  const parentFileMap = useMemo(() => new Map(parentFiles.map((f) => [f.path, f.content])), [parentFiles])

  const filesWithStatus = useMemo(() => {
    const currentPaths = new Set(files.map((f) => f.path))
    const parentPaths = new Set(parentFiles.map((f) => f.path))

    const result: { path: string; content: string; status: FileStatus }[] = []

    for (const file of files) {
      const parentContent = parentFileMap.get(file.path)
      let status: FileStatus
      if (!parentPaths.has(file.path)) {
        status = 'A'
      } else if (parentContent !== file.content) {
        // Bytes differ. For graphical files, the difference may be only transient
        // UI state (selectedNodes, dragging, etc.) that leaked into older commits.
        // Run the semantic diff: if nodes/edges/variables match, treat as unchanged.
        if (isGraphicalFile(file.path) && versionControl && parentContent !== undefined) {
          const semantic = versionControl.computeGraphicalDiff(parentContent, file.content, file.path)
          status = semantic.changedIndexes.length === 0 && semantic.variableDiff.length === 0 ? 'U' : 'M'
        } else {
          status = 'M'
        }
      } else {
        status = 'U'
      }
      result.push({ ...file, status })
    }

    for (const pf of parentFiles) {
      if (!currentPaths.has(pf.path)) {
        result.push({ path: pf.path, content: '', status: 'D' })
      }
    }

    return result
  }, [files, parentFiles, parentFileMap, versionControl])

  const changedFiles = useMemo(
    () => filesWithStatus.filter((f) => f.status !== 'U' && !isSystemFile(f.path)),
    [filesWithStatus],
  )
  const filteredFiles = useMemo(
    () =>
      searchQuery ? changedFiles.filter((f) => f.path.toLowerCase().includes(searchQuery.toLowerCase())) : changedFiles,
    [changedFiles, searchQuery],
  )
  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles])

  const selectedCurrent = files.find((f) => f.path === selectedFile)?.content ?? ''
  const selectedOriginal = parentFileMap.get(selectedFile ?? '') ?? ''
  const selectedStatus = filesWithStatus.find((f) => f.path === selectedFile)?.status

  // Auto-expand folders on first load
  useEffect(() => {
    if (filesWithStatus.length > 0 && expandedFolders.size === 0) {
      const allFolders = new Set<string>()
      for (const file of filesWithStatus) {
        const parts = file.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          allFolders.add(parts.slice(0, i).join('/'))
        }
      }
      if (allFolders.size > 0) setExpandedFolders(allFolders)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesWithStatus])

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleRestore = () => {
    if (!versionControl) return
    setIsRestoring(true)
    versionControl
      .restoreCommit(projectId, commitHash)
      .then(() => {
        setShowRestoreModal(false)
        onRestored()
      })
      .catch(() => setIsRestoring(false))
  }

  const goBack = onBack

  if (isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-900'>
        <div className='flex flex-col items-center gap-3'>
          <div className='h-6 w-6 animate-spin rounded-full border-2 border-brand-light border-t-transparent' />
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>Loading commit files...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-900'>
        <div className='flex flex-col items-center gap-3'>
          <p className='text-sm text-red-500'>Failed to load commit files</p>
          <button onClick={goBack} className='text-xs text-brand-light hover:underline'>
            Back to workspace
          </button>
        </div>
      </div>
    )
  }

  const shortHash = commitHash.slice(0, 7)

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-neutral-100 dark:bg-neutral-900'>
      {/* Header */}
      <div className='flex shrink-0 items-center justify-between border-b-2 border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950'>
        <div className='flex min-w-0 items-center gap-3'>
          <button
            onClick={goBack}
            className='flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            <ArrowLeft className='h-3.5 w-3.5' />
            Back
          </button>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='shrink-0 font-mono text-xs text-brand-light'>{shortHash}</span>
            {commit && (
              <>
                <span className='text-xs text-neutral-400 dark:text-neutral-600'>&middot;</span>
                <span className='truncate text-xs text-neutral-600 dark:text-neutral-400'>{commit.message}</span>
                <span className='text-xs text-neutral-400 dark:text-neutral-600'>&middot;</span>
                <span className='shrink-0 text-xs text-neutral-500'>
                  {new Date(commit.timestamp).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowRestoreModal(true)}
          className='flex shrink-0 items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/20 dark:text-blue-400'
        >
          <RotateCcw className='h-3.5 w-3.5' />
          Restore
        </button>
      </div>

      {/* Main content */}
      <div className='min-h-0 flex-1 p-2'>
        <ResizablePanelGroup id='historyPanelGroup' direction='horizontal' className='h-full gap-2'>
          {/* File tree */}
          <ResizablePanel
            id='historyFileTree'
            order={1}
            defaultSize={20}
            minSize={12}
            maxSize={40}
            className='overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950'
          >
            <div className='flex h-full flex-col'>
              <div className='shrink-0 space-y-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
                <p className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>
                  {searchQuery
                    ? `${filteredFiles.length} of ${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}`
                    : `${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}`}
                </p>
                <div className='relative'>
                  <Search className='absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400' />
                  <input
                    type='text'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder='Search files...'
                    className='w-full rounded border border-neutral-200 bg-neutral-50 py-1 pl-6 pr-2 text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-brand-light dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder:text-neutral-500'
                  />
                </div>
              </div>
              <div className='flex-1 overflow-y-auto py-1'>
                {tree.map((node) => (
                  <FileTreeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={selectedFile}
                    onSelect={setSelectedFile}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                  />
                ))}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle
            id='historyResizeHandle'
            hitAreaMargins={{ coarse: 12, fine: 3 }}
            className='w-[4px] transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700'
          />

          {/* Diff viewer */}
          <ResizablePanel
            id='historyContentViewer'
            order={2}
            className='overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950'
          >
            <div className='flex h-full flex-col'>
              {selectedFile ? (
                <>
                  <div className='flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
                    <p className='flex-1 truncate font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                      {selectedFile}
                    </p>
                    {selectedStatus && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold',
                          selectedStatus === 'A' && 'bg-green-500/10 text-green-500',
                          selectedStatus === 'M' && 'bg-yellow-500/10 text-yellow-500',
                          selectedStatus === 'D' && 'bg-red-500/10 text-red-500',
                          selectedStatus === 'U' && 'bg-neutral-500/10 text-neutral-400',
                        )}
                      >
                        {FILE_STATUS_CONFIG[selectedStatus].label}
                      </span>
                    )}
                  </div>
                  <div className='min-h-0 flex-1'>
                    <FileDiffView
                      filePath={selectedFile}
                      original={selectedOriginal}
                      current={selectedCurrent}
                      isDark={isDark}
                    />
                  </div>
                </>
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-sm text-neutral-400 dark:text-neutral-500'>Select a file to view the diff</p>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <RestoreConfirmationModal
        isOpen={showRestoreModal}
        isLoading={isRestoring}
        commitHash={commitHash}
        commitMessage={commit?.message ?? ''}
        onConfirm={handleRestore}
        onCancel={() => setShowRestoreModal(false)}
      />
    </div>
  )
}
