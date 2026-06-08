/**
 * Project README modal — GitHub-style viewer/editor for the project's
 * versioned `README.md`.
 *
 * Three sub-screens driven by `mode`:
 *   - 'view'   → read-only render of `savedContent` (Markdown).
 *                Owners see Edit + Delete affordances; viewers see read-only.
 *   - 'edit'   → textarea / preview tabs + commit-message override.
 *                Save commits via `saveReadme`.
 *   - 'delete' → confirmation panel with its own commit-message field.
 *                Confirm removes the file (`saveReadme(null)`).
 *
 * State lives in the `readme` slice so the panel can survive a brief
 * close/reopen without losing the draft. The mode is local state — it's
 * a UI-only transition that doesn't matter outside the open panel.
 */

import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { useProject } from '../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type Mode = 'view' | 'edit' | 'delete'

/**
 * Default commit subject for each action. Mirrors the backend defaults
 * so the user sees exactly what would be committed if they leave the
 * field untouched.
 */
function defaultCommitMessage(action: 'create' | 'update' | 'remove'): string {
  if (action === 'create') return 'docs: create README'
  if (action === 'remove') return 'docs: remove README'
  return 'docs: update README'
}

const ProjectReadmeModal = () => {
  const isOpen = useOpenPLCStore((s) => s.modals['project-readme']?.open ?? false)
  const closeModal = useOpenPLCStore((s) => s.modalActions.closeModal)
  const onOpenChange = useOpenPLCStore((s) => s.modalActions.onOpenChange)

  const savedContent = useOpenPLCStore((s) => s.readme.savedContent)
  const draftContent = useOpenPLCStore((s) => s.readme.draftContent)
  const commitMessage = useOpenPLCStore((s) => s.readme.commitMessage)
  const status = useOpenPLCStore((s) => s.readme.status)
  const error = useOpenPLCStore((s) => s.readme.error)

  const beginEdit = useOpenPLCStore((s) => s.readmeActions.beginEdit)
  const cancelEdit = useOpenPLCStore((s) => s.readmeActions.cancelEdit)
  const setDraft = useOpenPLCStore((s) => s.readmeActions.setDraft)
  const setCommitMessage = useOpenPLCStore((s) => s.readmeActions.setCommitMessage)
  const setStatus = useOpenPLCStore((s) => s.readmeActions.setStatus)
  const commitSaved = useOpenPLCStore((s) => s.readmeActions.commitSaved)

  const projectCanEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const projectId = useOpenPLCStore((s) => s.project.meta.path)
  const projectName = useOpenPLCStore((s) => s.project.meta.name)
  const projectPort = useProject()

  const [mode, setMode] = useState<Mode>('view')
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [deleteCommitMessage, setDeleteCommitMessage] = useState('docs: remove README')

  // Reset transient UI state every time the modal closes so a reopen
  // doesn't resume on the delete step with a half-typed message.
  useEffect(() => {
    if (!isOpen) {
      setMode('view')
      setActiveTab('edit')
      setDeleteCommitMessage('docs: remove README')
    }
  }, [isOpen])

  const canEdit = projectCanEdit && savedContent !== undefined

  const handleStartEdit = (defaultContent?: string) => {
    beginEdit(defaultContent)
    setMode('edit')
    setActiveTab('edit')
  }

  const handleCancelEdit = () => {
    cancelEdit()
    setMode('view')
    setActiveTab('edit')
  }

  const handleSave = async () => {
    if (!projectId || !projectPort.saveReadme) return
    setStatus('saving', null)
    const result = await projectPort.saveReadme(projectId, draftContent, {
      commitMessage: commitMessage.trim() || undefined,
    })
    if (!result.success) {
      setStatus('idle', result.error ?? 'Failed to save README.')
      return
    }
    commitSaved(draftContent)
    setMode('view')
    setActiveTab('edit')
  }

  const handleConfirmDelete = async () => {
    if (!projectId || !projectPort.saveReadme) return
    setStatus('deleting', null)
    const result = await projectPort.saveReadme(projectId, null, {
      commitMessage: deleteCommitMessage.trim() || undefined,
    })
    if (!result.success) {
      setStatus('idle', result.error ?? 'Failed to delete README.')
      return
    }
    commitSaved(null)
    setMode('view')
    setActiveTab('edit')
  }

  const isPending = status === 'saving' || status === 'deleting'

  const headerSubtitle = useMemo(() => projectName || 'Project', [projectName])

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) {
          // Clean up the draft on close — same as Cancel.
          cancelEdit()
          closeModal()
          return
        }
        onOpenChange('project-readme', open)
      }}
    >
      <ModalContent className='flex max-h-[90vh] w-[760px] flex-col gap-4 overflow-hidden rounded-xl p-6'>
        <ModalTitle className='flex items-center gap-2 text-base font-semibold text-neutral-1000 dark:text-neutral-100'>
          <span className='text-neutral-500'>{headerSubtitle}</span>
          <span className='text-neutral-400'>/</span>
          <span>README.md</span>
        </ModalTitle>

        {mode === 'view' && (
          <ViewMode
            savedContent={savedContent}
            canEdit={canEdit}
            onEdit={handleStartEdit}
            onDelete={() => setMode('delete')}
            onClose={closeModal}
          />
        )}

        {mode === 'edit' && (
          <EditMode
            draftContent={draftContent}
            commitMessage={commitMessage}
            activeTab={activeTab}
            isPending={isPending}
            error={error}
            isCreate={savedContent == null}
            onDraftChange={setDraft}
            onCommitMessageChange={setCommitMessage}
            onTabChange={setActiveTab}
            onSave={handleSave}
            onCancel={handleCancelEdit}
          />
        )}

        {mode === 'delete' && (
          <DeleteMode
            deleteCommitMessage={deleteCommitMessage}
            isPending={isPending}
            error={error}
            onCommitMessageChange={setDeleteCommitMessage}
            onConfirm={handleConfirmDelete}
            onCancel={() => setMode('view')}
          />
        )}
      </ModalContent>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

function ViewMode({
  savedContent,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  savedContent: string | null | undefined
  canEdit: boolean
  onEdit: (defaultContent?: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const hasContent = typeof savedContent === 'string' && savedContent.length > 0

  return (
    <>
      <div className='max-h-[60vh] min-h-[200px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950'>
        {hasContent ? (
          <ReadmePreview content={savedContent} />
        ) : (
          <div className='flex flex-col items-center justify-center py-8 text-center'>
            <p className='mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300'>
              This project has no README yet.
            </p>
            {canEdit && (
              <button
                onClick={() => onEdit(`# Project\n\nDescribe what this project does and how to run it.\n`)}
                className='cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-medium'
              >
                Create README
              </button>
            )}
          </div>
        )}
      </div>

      <div className='flex items-center justify-end gap-2'>
        {canEdit && hasContent && (
          <button
            onClick={onDelete}
            className='cursor-pointer rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800/40 dark:bg-neutral-950 dark:text-red-400 dark:hover:bg-red-950/30'
          >
            Delete README
          </button>
        )}
        {canEdit && hasContent && (
          <button
            onClick={() => onEdit()}
            className='cursor-pointer rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-1000 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
          >
            Edit
          </button>
        )}
        <button
          onClick={onClose}
          className='cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-medium'
        >
          Close
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

function EditMode({
  draftContent,
  commitMessage,
  activeTab,
  isPending,
  error,
  isCreate,
  onDraftChange,
  onCommitMessageChange,
  onTabChange,
  onSave,
  onCancel,
}: {
  draftContent: string
  commitMessage: string
  activeTab: 'edit' | 'preview'
  isPending: boolean
  error: string | null
  isCreate: boolean
  onDraftChange: (content: string) => void
  onCommitMessageChange: (message: string) => void
  onTabChange: (tab: 'edit' | 'preview') => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className='flex items-center gap-0 border-b border-neutral-200 dark:border-neutral-800'>
        <TabButton active={activeTab === 'edit'} onClick={() => onTabChange('edit')}>
          Edit
        </TabButton>
        <TabButton active={activeTab === 'preview'} onClick={() => onTabChange('preview')}>
          Preview
        </TabButton>
      </div>

      {activeTab === 'edit' ? (
        <textarea
          value={draftContent}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder='Write your README in markdown...'
          spellCheck={false}
          className='max-h-[60vh] min-h-[260px] w-full resize-y rounded-lg border border-neutral-200 bg-white p-3 font-mono text-sm leading-relaxed text-neutral-1000 outline-none focus:border-brand dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
        />
      ) : (
        <div className='max-h-[60vh] min-h-[260px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950'>
          {draftContent.trim() ? (
            <ReadmePreview content={draftContent} />
          ) : (
            <p className='text-center text-sm italic text-neutral-400'>Nothing to preview</p>
          )}
        </div>
      )}

      <div className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <label
          htmlFor='readme-commit-message'
          className='text-xs font-semibold text-neutral-1000 dark:text-neutral-200'
        >
          Commit message
        </label>
        <input
          id='readme-commit-message'
          type='text'
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          maxLength={72}
          placeholder={defaultCommitMessage(isCreate ? 'create' : 'update')}
          className='w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-1000 outline-none focus:border-brand dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
        />
        {error && <p className='text-xs text-red-600 dark:text-red-400'>{error}</p>}
        <div className='mt-1 flex items-center justify-end gap-2'>
          <button
            onClick={onCancel}
            disabled={isPending}
            className='cursor-pointer rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-1000 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isPending}
            className='cursor-pointer rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-medium disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isPending ? 'Committing...' : 'Commit changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Delete mode
// ---------------------------------------------------------------------------

function DeleteMode({
  deleteCommitMessage,
  isPending,
  error,
  onCommitMessageChange,
  onConfirm,
  onCancel,
}: {
  deleteCommitMessage: string
  isPending: boolean
  error: string | null
  onCommitMessageChange: (message: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className='rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200'>
        <p className='font-semibold'>Delete README</p>
        <p className='mt-1 text-xs'>
          This creates a commit removing <strong>README.md</strong> from the project. The file stays in the history and
          can be recovered from any prior commit.
        </p>
      </div>

      <div className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <label
          htmlFor='readme-delete-commit-message'
          className='text-xs font-semibold text-neutral-1000 dark:text-neutral-200'
        >
          Commit message
        </label>
        <input
          id='readme-delete-commit-message'
          type='text'
          value={deleteCommitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          maxLength={72}
          placeholder='docs: remove README'
          className='w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-1000 outline-none focus:border-brand dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
        />
        {error && <p className='text-xs text-red-600 dark:text-red-400'>{error}</p>}
        <div className='mt-1 flex items-center justify-end gap-2'>
          <button
            onClick={onCancel}
            disabled={isPending}
            className='cursor-pointer rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-1000 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className='cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isPending ? 'Deleting...' : 'Delete README'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const PROSE_CLASSES =
  'prose prose-sm dark:prose-invert max-w-none prose-h1:text-2xl prose-h1:font-semibold prose-h2:text-xl prose-h3:text-base prose-h3:font-semibold prose-p:text-sm prose-li:text-sm prose-code:bg-neutral-100 dark:prose-code:bg-neutral-800 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-neutral-100 dark:prose-pre:bg-neutral-900 prose-pre:rounded-lg prose-pre:text-xs'

function ReadmePreview({ content }: { content: string }) {
  return (
    <div className={PROSE_CLASSES}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative cursor-pointer px-3 py-2 text-sm transition-colors ${
        active
          ? 'font-medium text-neutral-1000 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-1000 dark:hover:text-neutral-200'
      }`}
    >
      {children}
      {active && <span className='absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-brand' />}
    </button>
  )
}

export { ProjectReadmeModal }
