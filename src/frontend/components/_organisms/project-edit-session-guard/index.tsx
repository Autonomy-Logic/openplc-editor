import { useCallback, useId, useMemo, useRef, useState } from 'react'

import type { EditSessionSummary } from '../../../../middleware/shared/ports/edit-session-port'
import { isRemoteProjectPath } from '../../../../middleware/shared/ports/types'
import { useCapabilities, useEditSession, useNavigation } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { useProjectEditSession } from '../../../hooks/use-project-edit-session'
import { useOpenPLCStore } from '../../../store'
import { describeEditSessionClient } from '../../../utils/describe-edit-session-client'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

/**
 * One project, one place (EDGE-652).
 *
 * Mounted once in the app layout. While an editable cloud project is open it
 * holds this place's edit session, and when the same project is open anywhere
 * else with the same account it shows a warning that cannot be dismissed
 * until the user closes all but one session. Autonomy Edge refuses saves in
 * the meantime, so nothing is overwritten while the warning is up.
 *
 * Renders its own dialog instead of going through the modal store:
 * `closeModal()` closes every modal at once, and this one must stay up until
 * the conflict is actually resolved.
 */
export function ProjectEditSessionGuard() {
  const port = useEditSession()
  const navigation = useNavigation()
  const { isNativeApplication } = useCapabilities()

  const projectPath = useOpenPLCStore(useCallback((s) => s.project.meta.path, []))
  const projectName = useOpenPLCStore(useCallback((s) => s.project.meta.name, []))
  const canEdit = useOpenPLCStore(useCallback((s) => s.workspace.canEdit, []))
  const isEphemeral = useOpenPLCStore(useCallback((s) => s.workspace.isEphemeralProject, []))
  const { clearStatesOnCloseProject } = useOpenPLCStore(useCallback((s) => s.sharedWorkspaceActions, []))

  // Read-only viewers cannot save, so they cannot overwrite anything. Partner
  // integration sessions keep their own save path.
  const projectId = canEdit && !isEphemeral && isRemoteProjectPath(projectPath) ? projectPath : null

  const client = useMemo(
    () => describeEditSessionClient(isNativeApplication, typeof navigator === 'undefined' ? '' : navigator.userAgent),
    [isNativeApplication],
  )

  const { state, closeOtherSession, closeThisSession } = useProjectEditSession({ port, projectId, client })

  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const leaveProject = useCallback(() => {
    clearStatesOnCloseProject()
    navigation.exitToHost()
  }, [clearStatesOnCloseProject, navigation])

  const handleCloseOther = async (sessionId: string) => {
    setBusySessionId(sessionId)
    setFailed(false)
    const closed = await closeOtherSession(sessionId)
    setBusySessionId(null)
    setFailed(!closed)
  }

  const handleCloseThis = async () => {
    if (state.phase !== 'active') {
      return
    }
    setBusySessionId(state.sessionId)
    await closeThisSession()
    setBusySessionId(null)
    leaveProject()
  }

  if (state.phase === 'closed-elsewhere') {
    return <ClosedElsewhereDialog projectName={projectName} onLeave={leaveProject} />
  }

  if (state.phase !== 'active' || state.otherSessions.length === 0) {
    return null
  }

  return (
    <ConflictDialog
      projectName={projectName}
      current={{ label: client.label, kind: client.kind }}
      otherSessions={state.otherSessions}
      busySessionId={busySessionId}
      currentSessionId={state.sessionId}
      failed={failed}
      onCloseOther={(id) => void handleCloseOther(id)}
      onCloseThis={() => void handleCloseThis()}
    />
  )
}

// Neither dialog can be dismissed by Escape or a click outside: the only ways
// out are the actions that actually resolve the situation.
const blockDismiss = (event: Event) => event.preventDefault()

/**
 * Focus the dialog itself on open, not its first button. Radix focuses the
 * first focusable element by default, which in the conflict dialog is "Close
 * this one": a stray Enter would close this session and leave the project.
 */
function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null)
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    ref.current?.focus()
  }
  return { ref, onOpenAutoFocus }
}

interface ConflictDialogProps {
  projectName: string
  current: { label: string; kind: 'web' | 'desktop' }
  currentSessionId: string
  otherSessions: EditSessionSummary[]
  busySessionId: string | null
  failed: boolean
  onCloseOther(sessionId: string): void
  onCloseThis(): void
}

export function ConflictDialog({
  projectName,
  current,
  currentSessionId,
  otherSessions,
  busySessionId,
  failed,
  onCloseOther,
  onCloseThis,
}: ConflictDialogProps) {
  const total = otherSessions.length + 1
  const busy = busySessionId !== null
  const focus = useDialogFocus()
  const descriptionId = useId()

  return (
    <Modal open>
      <ModalContent
        ref={focus.ref}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        aria-describedby={descriptionId}
        onEscapeKeyDown={blockDismiss}
        onPointerDownOutside={blockDismiss}
        onInteractOutside={blockDismiss}
        className='h-fit max-h-[90vh] w-[520px] select-none gap-5 overflow-y-auto px-8 py-6'
        data-testid='project-edit-session-conflict'
      >
        <div className='flex flex-col items-center gap-3 text-center'>
          <WarningIcon className='h-14 w-14 stroke-amber-500' />
          <ModalTitle className='text-base font-bold text-gray-700 dark:text-neutral-100'>
            This project is open in more than one place
          </ModalTitle>
        </div>

        <div id={descriptionId} className='flex flex-col gap-3 text-sm text-gray-600 dark:text-neutral-300'>
          <p>
            <strong>{projectName || 'This project'}</strong> is open in {total} places with your account.
          </p>
          <p>
            Every save replaces the whole project, so two open copies would overwrite each other: what you save in one
            place could undo work saved in the other, and could even bring back files that were deleted there.
          </p>
          <p>
            To keep your work safe, <strong>saving is paused</strong> until only one session is left. Choose the session
            you want to close.
          </p>
        </div>

        <ul className='flex flex-col gap-2' aria-label='Open sessions'>
          <SessionRow
            label={current.label}
            kind={current.kind}
            detail='This window'
            actionLabel='Close this one'
            busy={busySessionId === currentSessionId}
            disabled={busy}
            onAction={onCloseThis}
          />
          {otherSessions.map((session) => (
            <SessionRow
              key={session.id}
              label={session.clientLabel}
              kind={session.clientKind}
              detail={`Opened ${formatRelative(session.openedAt)}`}
              actionLabel='Close'
              busy={busySessionId === session.id}
              disabled={busy}
              onAction={() => onCloseOther(session.id)}
            />
          ))}
        </ul>

        {failed && (
          <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
            That session could not be closed. Try again in a moment.
          </p>
        )}

        <p className='text-xs text-gray-500 dark:text-neutral-400'>
          Changes that were not saved in the session you close are lost. The session you keep can save normally again.
        </p>
      </ModalContent>
    </Modal>
  )
}

interface SessionRowProps {
  label: string
  kind: 'web' | 'desktop'
  detail: string
  actionLabel: string
  busy: boolean
  disabled: boolean
  onAction(): void
}

function SessionRow({ label, kind, detail, actionLabel, busy, disabled, onAction }: SessionRowProps) {
  return (
    <li className='flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800'>
      <div className='flex min-w-0 flex-col'>
        <span className='truncate text-sm font-medium text-gray-700 dark:text-neutral-100'>{label}</span>
        <span className='text-xs text-gray-500 dark:text-neutral-400'>
          {kind === 'desktop' ? 'Desktop editor' : 'Web browser'} · {detail}
        </span>
      </div>
      <button
        type='button'
        onClick={onAction}
        disabled={disabled}
        className='shrink-0 cursor-pointer rounded-lg border border-red-500 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950'
      >
        {busy ? 'Closing…' : actionLabel}
      </button>
    </li>
  )
}

export function ClosedElsewhereDialog({ projectName, onLeave }: { projectName: string; onLeave(): void }) {
  const focus = useDialogFocus()
  const descriptionId = useId()

  return (
    <Modal open>
      <ModalContent
        ref={focus.ref}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        aria-describedby={descriptionId}
        onEscapeKeyDown={blockDismiss}
        onPointerDownOutside={blockDismiss}
        onInteractOutside={blockDismiss}
        className='h-fit w-[440px] select-none gap-5 px-8 py-6'
        data-testid='project-edit-session-closed'
      >
        <div className='flex flex-col items-center gap-3 text-center'>
          <WarningIcon className='h-14 w-14 stroke-amber-500' />
          <ModalTitle className='text-base font-bold text-gray-700 dark:text-neutral-100'>
            This project was closed here
          </ModalTitle>
        </div>
        <div id={descriptionId} className='flex flex-col gap-3 text-center text-sm text-gray-600 dark:text-neutral-300'>
          <p>
            You chose to keep editing <strong>{projectName || 'this project'}</strong> in another place, so this copy
            was closed to protect the work there.
          </p>
          <p>Changes made in this window after its last save were not kept.</p>
        </div>
        <button
          type='button'
          onClick={onLeave}
          className='w-full cursor-pointer rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-medium-dark'
        >
          Leave project
        </button>
      </ModalContent>
    </Modal>
  )
}

function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return 'recently'
  }
  const minutes = Math.round((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
