import { DiffEditor, Editor } from '@monaco-editor/react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@root/frontend/components/_organisms/panel'
import { cn } from '@root/frontend/utils/cn'
import { ArrowLeftRight, Check, Minus } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import {
  useDiffEditorTeardown,
  useDiffModelPaths,
} from '../editor/diff-viewer/use-diff-editor-teardown'

const CONFLICT_MARKER_RE = /^(<<<<<<<|=======|>>>>>>>)/m

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

/**
 * Build the initial resolution content with git-style conflict markers,
 * pre-populated for the user to edit.
 */
function buildInitialResolution(
  _filePath: string,
  sourceContent: string,
  targetContent: string,
  _baseContent: string | null,
  sourceBranch: string,
  targetBranch: string,
): string {
  // Simple line-based conflict markers (real git would do hunks; this is a
  // pragmatic version that gives the user both versions to edit freely).
  return [
    `<<<<<<< ${sourceBranch} (source)`,
    sourceContent.trimEnd(),
    '=======',
    targetContent.trimEnd(),
    `>>>>>>> ${targetBranch} (target)`,
    '',
  ].join('\n')
  // Note: baseContent could be used in a 3-way diff display; not needed for
  // the editable resolution panel itself.
}

type TextConflictResolverProps = {
  filePath: string
  sourceContent: string
  targetContent: string
  baseContent: string | null
  sourceBranch: string
  targetBranch: string
  /** The current resolution content (controlled). */
  resolution: string | undefined
  isResolved: boolean
  isDark: boolean
  onChange: (content: string) => void
  onMarkResolved: () => void
  onUnresolve: () => void
}

export function TextConflictResolver({
  filePath,
  sourceContent,
  targetContent,
  baseContent,
  sourceBranch,
  targetBranch,
  resolution,
  isResolved,
  isDark,
  onChange,
  onMarkResolved,
  onUnresolve,
}: TextConflictResolverProps) {
  // Same reversed teardown as everywhere Monaco is mounted directly — see the hook.
  const diffEditorRef = useDiffEditorTeardown()
  const diffModelPaths = useDiffModelPaths()

  const language = getLanguageFromPath(filePath)

  const initialResolution = useMemo(
    () => buildInitialResolution(filePath, sourceContent, targetContent, baseContent, sourceBranch, targetBranch),
    [filePath, sourceContent, targetContent, baseContent, sourceBranch, targetBranch],
  )

  // Initialize the resolution if not set yet
  useEffect(() => {
    if (resolution === undefined) {
      onChange(initialResolution)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const currentValue = resolution ?? initialResolution
  const hasMarkers = CONFLICT_MARKER_RE.test(currentValue)

  return (
    <div className='flex h-full flex-col'>
      {/* Header bar */}
      <div className='flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
        <div className='flex min-w-0 items-center gap-2'>
          <p className='truncate font-mono text-xs text-neutral-700 dark:text-neutral-300'>{filePath}</p>
          {isResolved ? (
            <span className='shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-500'>
              RESOLVED
            </span>
          ) : (
            <span className='shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500'>
              CONFLICT
            </span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            onClick={() => onChange(sourceContent)}
            disabled={isResolved}
            className='flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            title='Replace resolution with source content'
          >
            Use source
          </button>
          <button
            onClick={() => onChange(targetContent)}
            disabled={isResolved}
            className='flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            title='Replace resolution with target content'
          >
            Use target
          </button>
          {isResolved ? (
            <button
              onClick={onUnresolve}
              className='flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            >
              <Minus className='h-3 w-3' />
              Unresolve
            </button>
          ) : (
            <button
              onClick={onMarkResolved}
              disabled={hasMarkers}
              className='flex items-center gap-1 rounded-md bg-green-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50'
              title={
                hasMarkers
                  ? 'Remove all conflict markers (<<<<<<<, =======, >>>>>>>) before marking as resolved'
                  : 'Mark this conflict as resolved'
              }
            >
              <Check className='h-3 w-3' />
              Mark as resolved
            </button>
          )}
        </div>
      </div>

      {/* Top: side-by-side source vs target (read-only diff) */}
      <ResizablePanelGroup id={`text-resolver-${filePath}`} direction='vertical' className='min-h-0 flex-1'>
        <ResizablePanel id='compare-pane' order={1} defaultSize={45} minSize={25}>
          <div className='flex h-full flex-col'>
            <div className='flex shrink-0 items-center justify-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-[10px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400'>
              <span>
                <span className='font-mono'>{sourceBranch}</span> (source)
              </span>
              <ArrowLeftRight className='h-3 w-3' />
              <span>
                <span className='font-mono'>{targetBranch}</span> (target)
              </span>
            </div>
            <div className='min-h-0 flex-1'>
              <DiffEditor
                original={sourceContent}
                modified={targetContent}
                language={language}
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
                  renderSideBySide: true,
                  originalEditable: false,
                }}
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle
          id='resolver-resize'
          hitAreaMargins={{ coarse: 12, fine: 3 }}
          className='h-[4px] transition-colors data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light'
        />

        {/* Bottom: editable resolution */}
        <ResizablePanel id='resolution-pane' order={2} defaultSize={55} minSize={20}>
          <div className='flex h-full flex-col'>
            <div className='flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-[10px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400'>
              <span>YOUR RESOLUTION (edit freely)</span>
              {hasMarkers && (
                <span className='text-amber-500'>
                  ⚠ Remove all `&lt;&lt;&lt;&lt;&lt;&lt;&lt;`, `=======`, `&gt;&gt;&gt;&gt;&gt;&gt;&gt;` markers to
                  enable &quot;Mark as resolved&quot;
                </span>
              )}
            </div>
            <div className='min-h-0 flex-1'>
              <Editor
                value={currentValue}
                onChange={(v) => onChange(v ?? '')}
                language={language}
                theme={isDark ? 'vs-dark' : 'vs'}
                options={{
                  readOnly: isResolved,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                }}
                className={cn(isResolved && 'opacity-80')}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
