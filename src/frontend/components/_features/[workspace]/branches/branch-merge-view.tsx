/**
 * Merging one branch into another, file by file.
 *
 * Reached from the branch switcher. It is a whole screen because the decision needs one:
 * a three-way view of source, target and their common ancestor, a diff per file, and a
 * conflict resolver for the files the server says will collide.
 *
 * PLATFORM-FREE ON PURPOSE. It talks to the version-control port and takes
 * `onBack`/`onMerged` instead of navigating. The web wraps it in a router page at
 * `/merge`; the desktop, which has no router, lays it over the workspace. Both get the
 * same screen from the same code, which is the only way the two stay identical, and the
 * reason the desktop could not have this feature before: the page was wired straight to
 * the web own API layer, which the editor does not have.
 */

import { DiffEditor } from '@monaco-editor/react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@root/frontend/components/_organisms/panel'
import { cn } from '@root/frontend/utils/cn'
import type { Branch, BranchDiffWithBase } from '@root/middleware/shared/ports/version-control-port'
import { MergeConflictError } from '@root/middleware/shared/ports/version-control-port'
import { useTheme, useVersionControl } from '@root/middleware/shared/providers'
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  File,
  Folder,
  FolderOpen,
  GitMerge,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { GraphicalDiffViewer, isGraphicalFile } from '../editor/diff-viewer'
import { useDiffEditorTeardown, useDiffModelPaths } from '../editor/diff-viewer/use-diff-editor-teardown'
import { TextConflictResolver } from './merge-text-conflict-resolver'

// ---------------------------------------------------------------------------
// File tree types & helpers (same shape as history-page so the look matches)
// ---------------------------------------------------------------------------

type FileStatus = 'A' | 'M' | 'D' | 'U' | 'C' | 'R'

const FILE_STATUS_CONFIG: Record<FileStatus, { label: string; color: string }> = {
  A: { label: 'Added', color: 'text-green-500' },
  M: { label: 'Modified', color: 'text-yellow-500' },
  D: { label: 'Deleted', color: 'text-red-500' },
  U: { label: 'Unchanged', color: 'text-neutral-400' },
  C: { label: 'Conflict', color: 'text-amber-500' },
  R: { label: 'Resolved', color: 'text-green-500' },
}

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  status?: FileStatus
  children?: FileTreeNode[]
}

function buildTree(files: { path: string; status?: FileStatus }[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isFile = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')
      let existing = current.find((n) => n.name === name)
      if (!existing) {
        existing = {
          name,
          path: fullPath,
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

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'json':
      return 'json'
    case 'st':
    case 'il':
    case 'sfc':
      return 'st'
    case 'py':
      return 'python'
    case 'c':
      return 'c'
    case 'cpp':
      return 'cpp'
    default:
      return 'plaintext'
  }
}

function formatContentForDisplay(path: string, content: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext !== 'ld' && ext !== 'fbd') return content
  const endMatch = content.match(/\b(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\b/i)
  if (!endMatch || endMatch.index === undefined) return content
  const endKeyword = endMatch[0]
  const beforeEnd = content.slice(0, endMatch.index)
  const endVarIdx = beforeEnd.lastIndexOf('END_VAR')
  if (endVarIdx === -1) return content
  const declaration = beforeEnd.slice(0, endVarIdx + 'END_VAR'.length)
  return `${declaration}\n\n(* ${ext.toUpperCase()} graphical data omitted *)\n\n${endKeyword}`
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
          ? 'bg-brand-light/10 dark:bg-brand-light/20 text-brand dark:text-brand-light'
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
// Merge page
// ---------------------------------------------------------------------------

export type BranchMergeViewProps = {
  projectId: string
  /** The branch being merged in. */
  sourceBranch: string
  /** Where it lands. Omitted when opened from the branch you are on — the default branch then wins. */
  targetParam?: string
  /** Leave without merging. */
  onBack: () => void
  /**
   * The merge landed. The project on the server has moved, so the host has to reload it —
   * this view cannot, and leaving the user on a stale copy would be worse than closing.
   */
  onMerged: () => void
}

export function BranchMergeView({ projectId, sourceBranch, targetParam, onBack, onMerged }: BranchMergeViewProps) {
  const versionControl = useVersionControl()
  // Monaco is mounted directly here, so the library's reversed teardown applies: without
  // this, closing the screen raises "TextModel got disposed before DiffEditorWidget model
  // got reset" as an uncaught error. Measured in the running app before the fix.
  const diffEditorRef = useDiffEditorTeardown()
  const diffModelPaths = useDiffModelPaths()

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [showMergeOptionsModal, setShowMergeOptionsModal] = useState(false)
  const [postMergeError, setPostMergeError] = useState<string | null>(null)

  // Per-file resolution content (path → user-edited resolved content).
  // A path present here AND in `resolvedFiles` means the user marked it as resolved.
  const [resolutions, setResolutions] = useState<Record<string, string>>({})
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set())

  // Editable commit message — pre-filled with the default template when the
  // diff loads. User can override it before clicking "Merge".
  const [commitMessage, setCommitMessage] = useState<string>('')
  const [showCommitMessageEdit, setShowCommitMessageEdit] = useState(false)

  const [branches, setBranches] = useState<Branch[]>([])

  // The list is needed for two things only: resolving the default target when none was
  // given, and finding the source branch's id so it can be offered for deletion after a
  // merge. A failure leaves it empty, which degrades both gracefully.
  useEffect(() => {
    if (!versionControl) return
    let alive = true
    versionControl
      .listBranches(projectId)
      .then(({ branches: list }) => {
        if (alive) setBranches(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId, versionControl])

  // `target` may be omitted when the user opens merge from the same branch
  // they're on. Fall back to the repo's default branch (skipping source so
  // the page never tries to merge a branch into itself).
  const targetBranch = useMemo(() => {
    if (targetParam && targetParam !== sourceBranch) return targetParam
    const defaultBranch = branches.find((b) => b.isDefault && b.name !== sourceBranch)
    return defaultBranch?.name ?? targetParam ?? ''
  }, [targetParam, sourceBranch, branches])

  const [data, setData] = useState<BranchDiffWithBase | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  // Its own flag, so the button can say which of the two steps is running. The web build
  // read this from a second mutation; here the distinction is kept by hand.
  const [isDeletingSource, setIsDeletingSource] = useState(false)

  // Re-runs when either branch changes, and drops a late answer for a pair the user has
  // already moved off — otherwise switching target twice quickly can leave the first
  // response on screen under the second one's heading.
  useEffect(() => {
    if (!versionControl?.getBranchDiffWithBase || !sourceBranch || !targetBranch || sourceBranch === targetBranch) {
      setIsLoading(false)
      return
    }

    let alive = true
    setIsLoading(true)
    setError(null)

    versionControl
      .getBranchDiffWithBase(projectId, sourceBranch, targetBranch)
      .then((result) => {
        if (!alive) return
        setData(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err : new Error('Failed to load the branch diff'))
        setIsLoading(false)
      })

    return () => {
      alive = false
    }
  }, [projectId, sourceBranch, targetBranch, versionControl])

  const conflictedPaths = useMemo(() => new Set(data?.conflicts ?? []), [data?.conflicts])

  // Initialize commit message with default template once branch names are known
  useEffect(() => {
    if (commitMessage === '' && sourceBranch && targetBranch) {
      setCommitMessage(`Merge branch '${sourceBranch}' into ${targetBranch}`)
    }
  }, [sourceBranch, targetBranch, commitMessage])

  // Default branch can't be deleted; the prompt is hidden for it.
  // Double-guard: rely on isDefault flag AND on well-known default names
  // (in case the branch metadata hasn't been loaded yet or isDefault is stale).
  const sourceBranchEntry = branches.find((b) => b.name === sourceBranch)
  const sourceBranchIsDefault = sourceBranchEntry?.isDefault ?? false
  const sourceLooksLikeDefault = sourceBranch === 'main' || sourceBranch === 'master'
  const canDeleteSource = !!sourceBranchEntry && !sourceBranchIsDefault && !sourceLooksLikeDefault

  // Theme handling — this page can load standalone without DisplayMenu
  const themePort = useTheme()
  const isDark = themePort.getCurrentTheme() === 'dark'
  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [isDark])

  // Build per-file status: target is the "original" (we're merging INTO target),
  // source is the "modified" (changes coming from source branch).
  // Also marks files as 'C' (conflict) when listed in data.conflicts.
  const filesWithStatus = useMemo(() => {
    if (!data)
      return [] as Array<{
        path: string
        sourceContent: string
        targetContent: string
        baseContent: string | null
        status: FileStatus
      }>

    const sourceFiles = data.source.files.filter((f) => f.type === 'file')
    const targetFiles = data.target.files.filter((f) => f.type === 'file')
    const baseFiles = data.base?.files.filter((f) => f.type === 'file') ?? []

    const sourceMap = new Map(sourceFiles.map((f) => [f.path, f.content]))
    const targetMap = new Map(targetFiles.map((f) => [f.path, f.content]))
    const baseMap = new Map(baseFiles.map((f) => [f.path, f.content]))
    const allPaths = new Set<string>([...sourceMap.keys(), ...targetMap.keys()])

    const result: Array<{
      path: string
      sourceContent: string
      targetContent: string
      baseContent: string | null
      status: FileStatus
    }> = []

    for (const path of allPaths) {
      if (path.startsWith('.git/')) continue

      const sourceContent = sourceMap.get(path) ?? ''
      const targetContent = targetMap.get(path) ?? ''
      const baseContent = baseMap.has(path) ? (baseMap.get(path) ?? null) : null

      let status: FileStatus
      if (conflictedPaths.has(path)) {
        status = resolvedFiles.has(path) ? 'R' : 'C'
      } else if (!targetMap.has(path)) {
        status = 'A'
      } else if (!sourceMap.has(path)) {
        status = 'D'
      } else if (sourceContent !== targetContent) {
        status = 'M'
      } else {
        status = 'U'
      }

      result.push({ path, sourceContent, targetContent, baseContent, status })
    }
    return result
  }, [data, conflictedPaths, resolvedFiles])

  const unresolvedConflictCount = useMemo(
    () => filesWithStatus.filter((f) => f.status === 'C').length,
    [filesWithStatus],
  )

  const changedFiles = filesWithStatus.filter((f) => f.status !== 'U')
  const filteredFiles = searchQuery
    ? changedFiles.filter((f) => f.path.toLowerCase().includes(searchQuery.toLowerCase()))
    : changedFiles
  const fileCount = changedFiles.length
  const filteredFileCount = filteredFiles.length
  const tree = buildTree(filteredFiles)

  const selected = filesWithStatus.find((f) => f.path === selectedFile)

  // Auto-expand all folders once on first render of changed files
  useEffect(() => {
    if (changedFiles.length > 0 && expandedFolders.size === 0) {
      const allFolders = new Set<string>()
      for (const file of changedFiles) {
        const parts = file.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          allFolders.add(parts.slice(0, i).join('/'))
        }
      }
      if (allFolders.size > 0) setExpandedFolders(allFolders)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedFiles.length])

  // Auto-select first changed file
  useEffect(() => {
    if (!selectedFile && changedFiles.length > 0) {
      setSelectedFile(changedFiles[0].path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedFiles.length])

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const goBack = onBack
  const finishAndClose = onMerged

  const runMerge = async (shouldDelete: boolean) => {
    if (!versionControl?.mergeBranches) return

    setMergeError(null)
    setPostMergeError(null)
    setShowMergeOptionsModal(false)

    // Only files the user actually marked resolved. Sending a half-edited one would merge
    // content nobody approved.
    const resolutionsToSend: Record<string, string> = {}
    for (const path of resolvedFiles) {
      if (path in resolutions) resolutionsToSend[path] = resolutions[path]
    }

    setIsMerging(true)

    try {
      await versionControl.mergeBranches({
        projectId,
        sourceBranch,
        targetBranch,
        commitMessage: commitMessage.trim() || undefined,
        ...(Object.keys(resolutionsToSend).length > 0 ? { resolutions: resolutionsToSend } : {}),
      })
    } catch (err: unknown) {
      setIsMerging(false)

      if (err instanceof MergeConflictError) {
        // The server still sees unresolved conflicts. Usually drift: the branches moved
        // since this screen loaded, so reloading is the honest advice rather than letting
        // the user re-press a button that will refuse again.
        setMergeError(
          `Conflicts remain in: ${err.conflictedFiles.join(', ')}. ` +
            `The branches may have changed since you opened this page — please reload.`,
        )
        return
      }

      setMergeError(err instanceof Error ? err.message : 'Unknown error')
      return
    }

    // Merged. Deleting the source is a courtesy, so its failure must not read as the merge
    // having failed — it warns and still lets the user close.
    if (shouldDelete && sourceBranchEntry && canDeleteSource) {
      setIsDeletingSource(true)

      try {
        await versionControl.deleteBranch(projectId, sourceBranchEntry.id)
      } catch (err: unknown) {
        setIsDeletingSource(false)
        setIsMerging(false)
        setPostMergeError(
          `Merge succeeded, but failed to delete source branch '${sourceBranch}': ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        )
        return
      }
    }

    setIsDeletingSource(false)
    setIsMerging(false)
    finishAndClose()
  }

  if (isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-900'>
        <div className='flex flex-col items-center gap-3'>
          <div className='h-6 w-6 animate-spin rounded-full border-2 border-brand-light border-t-transparent' />
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>Loading branch diff...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-900'>
        <div className='flex flex-col items-center gap-3'>
          <p className='text-sm text-red-500'>Failed to load branch diff</p>
          <button onClick={goBack} className='text-xs text-brand-light hover:underline'>
            Back to workspace
          </button>
        </div>
      </div>
    )
  }

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
            <GitMerge className='h-4 w-4 shrink-0 text-blue-500' />
            <span className='truncate font-mono text-xs text-neutral-700 dark:text-neutral-300'>{sourceBranch}</span>
            <span className='text-xs text-neutral-400'>→</span>
            <span className='truncate font-mono text-xs text-neutral-700 dark:text-neutral-300'>{targetBranch}</span>
            <span className='text-xs text-neutral-400 dark:text-neutral-600'>·</span>
            <span className='shrink-0 text-xs text-neutral-500'>
              {fileCount} file{fileCount !== 1 ? 's' : ''} changed
            </span>
            {unresolvedConflictCount > 0 && (
              <>
                <span className='text-xs text-neutral-400 dark:text-neutral-600'>·</span>
                <span className='flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-500'>
                  <AlertCircle className='h-3 w-3' />
                  {unresolvedConflictCount} conflict{unresolvedConflictCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            onClick={() => setShowCommitMessageEdit((prev) => !prev)}
            className='flex items-center gap-1 rounded-md bg-neutral-100 px-2.5 py-1.5 text-[11px] text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            title='Edit commit message'
          >
            Message
            {showCommitMessageEdit ? <ChevronUp className='h-3 w-3' /> : <ChevronDown className='h-3 w-3' />}
          </button>
          <button
            onClick={() => setShowMergeOptionsModal(true)}
            disabled={isMerging || fileCount === 0 || unresolvedConflictCount > 0}
            className='flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
            title={
              unresolvedConflictCount > 0
                ? `Resolve ${unresolvedConflictCount} conflict(s) before merging`
                : `Merge into ${targetBranch}`
            }
          >
            <GitMerge className='h-3.5 w-3.5' />
            {isDeletingSource ? 'Deleting branch...' : isMerging ? 'Merging...' : `Merge into ${targetBranch}`}
          </button>
        </div>
      </div>

      {/* Commit message editor (collapsible) */}
      {showCommitMessageEdit && (
        <div className='shrink-0 border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900'>
          <label className='mb-1 block text-[11px] font-medium text-neutral-600 dark:text-neutral-400'>
            Merge commit message
          </label>
          <input
            type='text'
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder={`Merge branch '${sourceBranch}' into ${targetBranch}`}
            className='w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:border-brand-light focus:outline-none focus:ring-1 focus:ring-brand-light dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'
          />
        </div>
      )}

      {mergeError && (
        <div className='shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-800 dark:bg-red-950/40'>
          <p className='text-xs text-red-700 dark:text-red-300'>{mergeError}</p>
        </div>
      )}
      {postMergeError && (
        <div className='flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/40'>
          <p className='text-xs text-amber-700 dark:text-amber-300'>{postMergeError}</p>
          <button
            onClick={finishAndClose}
            className='shrink-0 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600'
          >
            Continue
          </button>
        </div>
      )}

      {/* Main content */}
      <div className='min-h-0 flex-1 p-2'>
        <ResizablePanelGroup id='mergePanelGroup' direction='horizontal' className='h-full gap-2'>
          {/* File tree */}
          <ResizablePanel
            id='mergeFileTree'
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
                    ? `${filteredFileCount} of ${fileCount} file${fileCount !== 1 ? 's' : ''}`
                    : `${fileCount} file${fileCount !== 1 ? 's' : ''}`}
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
                {fileCount === 0 ? (
                  <p className='px-3 py-3 text-xs text-neutral-400 dark:text-neutral-500'>
                    No differences. The branches are already in sync.
                  </p>
                ) : (
                  tree.map((node) => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedFile}
                      onSelect={setSelectedFile}
                      expandedFolders={expandedFolders}
                      onToggleFolder={toggleFolder}
                    />
                  ))
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle
            id='mergeResizeHandle'
            hitAreaMargins={{ coarse: 12, fine: 3 }}
            className='w-[4px] transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700'
          />

          {/* Diff viewer */}
          <ResizablePanel
            id='mergeContentViewer'
            order={2}
            className='overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950'
          >
            <div className='flex h-full flex-col'>
              {selected ? (
                selected.status === 'C' || selected.status === 'R' ? (
                  isGraphicalFile(selected.path) ? (
                    /* Graphical file conflict — pick one branch's version wholesale.
                       Per-rung/per-node semantic merge is Phase 2/3. */
                    (() => {
                      const isResolved = resolvedFiles.has(selected.path)
                      const chosen = resolutions[selected.path]
                      const chosenSide =
                        chosen === selected.sourceContent
                          ? 'source'
                          : chosen === selected.targetContent
                            ? 'target'
                            : null
                      const pick = (side: 'source' | 'target') => {
                        const content = side === 'source' ? selected.sourceContent : selected.targetContent
                        setResolutions((prev) => ({ ...prev, [selected.path]: content }))
                        setResolvedFiles((prev) => new Set(prev).add(selected.path))
                      }
                      const reset = () => {
                        setResolvedFiles((prev) => {
                          const next = new Set(prev)
                          next.delete(selected.path)
                          return next
                        })
                        setResolutions((prev) => {
                          const next = { ...prev }
                          delete next[selected.path]
                          return next
                        })
                      }
                      // Per-file conflict navigation — placeholder for when Phase 2
                      // introduces per-rung conflict detection. For now each file
                      // shows as a single conflict (1/1).
                      const conflictIndex = 1
                      const conflictTotal = 1
                      const SideHeader = ({ side, branch }: { side: 'source' | 'target'; branch: string }) => (
                        <div className='sticky top-0 z-10 flex items-center justify-between gap-2 bg-brand-light px-3 py-1 dark:bg-brand-medium-dark'>
                          <div className='flex min-w-0 items-baseline gap-2'>
                            <span className='truncate font-mono text-sm font-semibold text-brand-dark dark:text-white'>
                              {branch}
                            </span>
                            <span className='text-brand-dark/70 text-[10px] uppercase tracking-wide dark:text-white/70'>
                              {side}
                            </span>
                          </div>
                          <label className='flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-brand-dark dark:text-white'>
                            <input
                              type='checkbox'
                              checked={chosenSide === side}
                              onChange={() => (chosenSide === side ? reset() : pick(side))}
                              className='h-3.5 w-3.5 cursor-pointer accent-brand'
                            />
                            Use this version
                          </label>
                        </div>
                      )
                      return (
                        <div className='flex h-full flex-col'>
                          <div className='flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
                            <div className='flex min-w-0 items-center gap-2'>
                              <p className='truncate font-mono text-xs text-neutral-700 dark:text-neutral-300'>
                                {selected.path}
                              </p>
                              {isResolved ? (
                                <span className='shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-500'>
                                  RESOLVED ({chosenSide})
                                </span>
                              ) : (
                                <span className='shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500'>
                                  CONFLICT
                                </span>
                              )}
                            </div>
                            <div className='flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-900'>
                              <button
                                type='button'
                                disabled={conflictIndex <= 1}
                                className='rounded p-0.5 text-neutral-500 transition-colors hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800'
                                title='Previous conflict'
                              >
                                <ChevronLeft className='h-3.5 w-3.5' />
                              </button>
                              <span className='px-1 text-[11px] font-medium tabular-nums text-neutral-600 dark:text-neutral-300'>
                                {conflictIndex}/{conflictTotal}
                              </span>
                              <button
                                type='button'
                                disabled={conflictIndex >= conflictTotal}
                                className='rounded p-0.5 text-neutral-500 transition-colors hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800'
                                title='Next conflict'
                              >
                                <ChevronRight className='h-3.5 w-3.5' />
                              </button>
                            </div>
                          </div>
                          <div className='min-h-0 flex-1 overflow-y-auto'>
                            {selected.baseContent !== null ? (
                              <>
                                <SideHeader side='source' branch={sourceBranch} />
                                <GraphicalDiffViewer
                                  originalContent={selected.baseContent}
                                  currentContent={selected.sourceContent}
                                  filePath={selected.path}
                                  isDark={isDark}
                                  showOriginalSide={false}
                                />
                                <SideHeader side='target' branch={targetBranch} />
                                <GraphicalDiffViewer
                                  originalContent={selected.baseContent}
                                  currentContent={selected.targetContent}
                                  filePath={selected.path}
                                  isDark={isDark}
                                  showOriginalSide={false}
                                />
                              </>
                            ) : (
                              <GraphicalDiffViewer
                                originalContent={selected.targetContent}
                                currentContent={selected.sourceContent}
                                filePath={selected.path}
                                isDark={isDark}
                                originalLabel={`${targetBranch} (target)`}
                                currentLabel={`${sourceBranch} (source)`}
                              />
                            )}
                          </div>
                        </div>
                      )
                    })()
                  ) : (
                    <TextConflictResolver
                      filePath={selected.path}
                      sourceContent={selected.sourceContent}
                      targetContent={selected.targetContent}
                      baseContent={selected.baseContent}
                      sourceBranch={sourceBranch}
                      targetBranch={targetBranch}
                      resolution={resolutions[selected.path]}
                      isResolved={resolvedFiles.has(selected.path)}
                      isDark={isDark}
                      onChange={(content: string) => setResolutions((prev) => ({ ...prev, [selected.path]: content }))}
                      onMarkResolved={() => setResolvedFiles((prev) => new Set(prev).add(selected.path))}
                      onUnresolve={() =>
                        setResolvedFiles((prev) => {
                          const next = new Set(prev)
                          next.delete(selected.path)
                          return next
                        })
                      }
                    />
                  )
                ) : (
                  /* Non-conflict view: just show the diff (read-only) */
                  <>
                    <div className='flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
                      <p className='flex-1 truncate font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                        {selected.path}
                      </p>
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold',
                          selected.status === 'A' && 'bg-green-500/10 text-green-500',
                          selected.status === 'M' && 'bg-yellow-500/10 text-yellow-500',
                          selected.status === 'D' && 'bg-red-500/10 text-red-500',
                          selected.status === 'U' && 'bg-neutral-500/10 text-neutral-400',
                        )}
                      >
                        {FILE_STATUS_CONFIG[selected.status].label}
                      </span>
                      <span className='shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500'>
                        <span className='font-mono'>{targetBranch}</span> ←{' '}
                        <span className='font-mono'>{sourceBranch}</span>
                      </span>
                    </div>
                    <div className='min-h-0 flex-1'>
                      {isGraphicalFile(selected.path) ? (
                        <GraphicalDiffViewer
                          originalContent={selected.targetContent}
                          currentContent={selected.sourceContent}
                          filePath={selected.path}
                          isDark={isDark}
                        />
                      ) : (
                        <DiffEditor
                          original={formatContentForDisplay(selected.path, selected.targetContent)}
                          modified={formatContentForDisplay(selected.path, selected.sourceContent)}
                          language={getLanguageFromPath(selected.path)}
                          theme={isDark ? 'vs-dark' : 'vs'}
                          originalModelPath={diffModelPaths.original}
                          modifiedModelPath={diffModelPaths.modified}
                          keepCurrentOriginalModel
                          keepCurrentModifiedModel
                          onMount={(editor) => {
                            diffEditorRef.current = editor
                          }}
                          options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            fontSize: 12,
                            scrollBeyondLastLine: false,
                            domReadOnly: true,
                            renderSideBySide: true,
                            originalEditable: false,
                          }}
                        />
                      )}
                    </div>
                  </>
                )
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-sm text-neutral-400 dark:text-neutral-500'>
                    {fileCount === 0 ? 'No changes between the selected branches.' : 'Select a file to view the diff'}
                  </p>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Pre-merge: confirm and pick whether to delete the source branch */}
      {showMergeOptionsModal && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <div
            className='absolute inset-0 bg-black/40'
            onClick={() => {
              if (!isMerging) setShowMergeOptionsModal(false)
            }}
          />
          <div className='relative w-[440px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
            <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
              Merge {sourceBranch} into {targetBranch}?
            </h3>
            <p className='mb-4 text-xs text-neutral-600 dark:text-neutral-400'>
              Choose whether to delete{' '}
              <span className='font-mono font-semibold text-neutral-900 dark:text-neutral-100'>{sourceBranch}</span>{' '}
              after the merge. The default branch can&apos;t be deleted.
            </p>
            <div className='flex flex-col-reverse justify-end gap-2 sm:flex-row'>
              <button
                onClick={() => setShowMergeOptionsModal(false)}
                disabled={isMerging}
                className='cursor-pointer rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
              >
                Cancel
              </button>
              <button
                onClick={() => void runMerge(false)}
                disabled={isMerging}
                className='cursor-pointer rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Merge and Don&apos;t Delete
              </button>
              <button
                onClick={() => void runMerge(true)}
                disabled={isMerging || !canDeleteSource}
                title={canDeleteSource ? undefined : `Cannot delete the default branch (${sourceBranch})`}
                className='cursor-pointer rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Merge and Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
