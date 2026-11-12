import { type FormEvent, useEffect, useRef, useState } from 'react'

import type {
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPhase,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'
import { useDevice, useRuntime, useRuntimeProvisioning } from '../../../../middleware/shared/providers/platform-context'
import { parseSshPortInput } from '../../../../middleware/shared/utils/runtime-provisioning'
import {
  cancelProvisioning,
  declineProvisioningOffer,
  hideProvisioningDialog,
  submitProvisioningRun,
} from '../../../services/runtime-provisioning'
import { type OpenPLCStore, useOpenPLCStore, useOpenPLCStoreApi } from '../../../store'
import type {
  RuntimeProvisioningNotice,
  RuntimeProvisioningView,
} from '../../../store/slices/runtime-provisioning/types'
import {
  type ProvisioningMessage,
  provisioningMessage,
  type ProvisioningMessageFacts,
  WHAT_WILL_BE_DONE,
} from '../../../utils/runtime-provisioning-messages'
import { Label } from '../../_atoms/label'
import { toast } from '../../_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type OfferView = Extract<RuntimeProvisioningView, { stage: 'offer' }>
type RunningView = Extract<RuntimeProvisioningView, { stage: 'running' }>
type EndedView = Extract<RuntimeProvisioningView, { stage: 'ended' }>

type ProvisioningForm = {
  username: string
  password: string
  portText: string
}

const LAST_LINES_SHOWN = 200
const ELAPSED_REFRESH_MS = 1_000

const INPUT_CLASS =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
const PRIMARY_BUTTON_CLASS =
  'flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
const SECONDARY_BUTTON_CLASS =
  'flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'

const OPERATION_NAMES: Record<RuntimeProvisioningOperation, string> = {
  install: 'installed',
  start: 'started',
}

function emptyForm(sshPort: number | null): ProvisioningForm {
  return { username: '', password: '', portText: sshPort === null ? '' : String(sshPort) }
}

function phaseLabel(phase: RuntimeProvisioningPhase, operation: RuntimeProvisioningOperation | null): string {
  switch (phase) {
    case 'connecting':
      return 'Logging in to the device over SSH'
    case 'inspecting':
      return 'Inspecting the device'
    case 'starting':
      return 'Starting the OpenPLC Runtime'
    case 'installing':
      return 'Installing the OpenPLC Runtime'
    case 'waiting-runtime':
      return operation === null
        ? 'Waiting for the OpenPLC Runtime to answer'
        : `Waiting for the ${OPERATION_NAMES[operation]} OpenPLC Runtime to answer`
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function outcomeFacts(view: EndedView): ProvisioningMessageFacts {
  const base: ProvisioningMessageFacts = { host: view.host, sshPort: view.sshPort }
  const outcome = view.outcome
  switch (outcome.kind) {
    case 'connected-ready':
    case 'not-started':
      return { ...base, operation: outcome.operation }
    case 'host-key-changed':
      return { ...base, target: outcome.target }
    case 'unsupported':
      return { ...base, reason: outcome.reason, detail: outcome.detail }
    case 'download-failed':
      return { ...base, dockerPresent: outcome.dockerPresent }
    case 'invalid-input':
      return { ...base, field: outcome.field }
    default:
      return base
  }
}

function lastLinesOf(outcome: RuntimeProvisioningOutcome): string[] {
  if (outcome.kind === 'installer-failed' || outcome.kind === 'start-failed') {
    return outcome.lastLines.slice(-LAST_LINES_SHOWN)
  }
  if (outcome.kind === 'not-started' && outcome.operation === 'install') {
    return outcome.lastLines.slice(-LAST_LINES_SHOWN)
  }
  return []
}

function noticeMessage(notice: RuntimeProvisioningNotice, view: OfferView): ProvisioningMessage {
  if (notice.kind === 'login-rejected') {
    return provisioningMessage('auth-rejected', { host: view.host, sshPort: view.sshPort })
  }
  return provisioningMessage('input-refused', { field: notice.field })
}

function announceEnding(view: EndedView): void {
  if (view.outcome.kind === 'cancelled') return
  const { title, body } = provisioningMessage(view.outcome.kind, outcomeFacts(view))
  toast({
    title,
    description: body,
    variant: view.outcome.kind === 'connected-ready' ? 'default' : 'fail',
  })
}

function dismissDialog(store: OpenPLCStore): void {
  const { runtimeProvisioning, runtimeProvisioningActions } = store.getState()
  const { view } = runtimeProvisioning
  if (view.stage === 'offer') declineProvisioningOffer(store)
  else if (view.stage === 'running' && runtimeProvisioning.dialogVisible) hideProvisioningDialog(store)
  else if (view.stage === 'ended') runtimeProvisioningActions.acknowledgeEnding()
}

const MessageText = ({
  message,
  tone = 'neutral',
  withTitle = true,
}: {
  message: ProvisioningMessage
  tone?: 'neutral' | 'alert'
  withTitle?: boolean
}) => {
  const paragraphs = message.body.split('\n').filter((line) => line.trim() !== '')
  return (
    <div
      className={
        tone === 'alert'
          ? 'flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
          : 'flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300'
      }
    >
      {withTitle && <p className='font-semibold'>{message.title}</p>}
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

const ElapsedTime = ({ startedAt }: { startedAt: number }) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <p className='text-sm text-neutral-600 dark:text-neutral-400'>
      Elapsed time: <span data-testid='runtime-provisioning-elapsed'>{formatElapsed(now - startedAt)}</span>
    </p>
  )
}

const WhatWillBeDone = () => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div data-testid='runtime-provisioning-what-will-be-done' className='flex flex-col gap-2 text-sm'>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className='self-start text-sm font-medium text-brand hover:underline'
      >
        What will be done on the device
      </button>
      {expanded && (
        <div className='flex flex-col gap-1 text-neutral-700 dark:text-neutral-300'>
          <p>{WHAT_WILL_BE_DONE.ifInstalled}</p>
          <p>Otherwise the OpenPLC Runtime is installed:</p>
          <ul className='list-disc pl-5'>
            {WHAT_WILL_BE_DONE.install.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type OfferStageProps = {
  view: OfferView
  form: ProvisioningForm
  onFormChange: (change: Partial<ProvisioningForm>) => void
  onSubmit: () => void
  onDecline: () => void
}

const OfferStage = ({ view, form, onFormChange, onSubmit, onDecline }: OfferStageProps) => {
  const offer = provisioningMessage('offer', { host: view.host, sshPort: view.sshPort })
  const explanation = offer.body.split('\n').filter((line) => line.trim() !== '')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <>
      <ModalTitle className='text-xl font-semibold'>{offer.title}</ModalTitle>
      {view.notice !== null && <MessageText message={noticeMessage(view.notice, view)} tone='alert' />}
      <div className='flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300'>
        {explanation.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <WhatWillBeDone />
      <form autoComplete='off' onSubmit={handleSubmit} className='flex w-full flex-col gap-4'>
        <div>
          <Label
            htmlFor='runtime-provisioning-username'
            className='mb-2 block text-sm text-neutral-950 dark:text-white'
          >
            Device username
          </Label>
          <input
            id='runtime-provisioning-username'
            data-testid='runtime-provisioning-username'
            type='text'
            autoComplete='off'
            autoCapitalize='none'
            spellCheck={false}
            value={form.username}
            onChange={(event) => onFormChange({ username: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <Label
            htmlFor='runtime-provisioning-password'
            className='mb-2 block text-sm text-neutral-950 dark:text-white'
          >
            Device password
          </Label>
          <input
            id='runtime-provisioning-password'
            data-testid='runtime-provisioning-password'
            type='password'
            autoComplete='off'
            value={form.password}
            onChange={(event) => onFormChange({ password: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <Label
            htmlFor='runtime-provisioning-ssh-port'
            className='mb-2 block text-sm text-neutral-950 dark:text-white'
          >
            SSH port
          </Label>
          <input
            id='runtime-provisioning-ssh-port'
            data-testid='runtime-provisioning-ssh-port'
            type='text'
            inputMode='numeric'
            autoComplete='off'
            value={form.portText}
            onChange={(event) => onFormChange({ portText: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div className='mt-2 flex gap-3'>
          <button
            type='submit'
            data-testid='runtime-provisioning-submit'
            disabled={form.username === '' || form.password === ''}
            className={PRIMARY_BUTTON_CLASS}
          >
            Install
          </button>
          <button
            type='button'
            data-testid='runtime-provisioning-decline'
            onClick={onDecline}
            className={SECONDARY_BUTTON_CLASS}
          >
            Decline
          </button>
        </div>
      </form>
    </>
  )
}

type RunningStageProps = {
  view: RunningView
  onCancel: () => void
  onHide: () => void
}

const RunningStage = ({ view, onCancel, onHide }: RunningStageProps) => (
  <>
    <ModalTitle className='text-xl font-semibold'>OpenPLC Runtime on {view.host}</ModalTitle>
    <p className='text-sm font-medium text-neutral-850 dark:text-neutral-100'>
      {phaseLabel(view.phase, view.operation)}
    </p>
    <p
      data-testid='runtime-provisioning-latest-line'
      className='whitespace-pre-wrap break-all rounded-md bg-neutral-100 p-2 font-mono text-xs text-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
    >
      {view.latestLine ?? ''}
    </p>
    <ElapsedTime startedAt={view.startedAt} />
    <div className='mt-2 flex gap-3'>
      {view.cancellable && (
        <button
          type='button'
          data-testid='runtime-provisioning-cancel'
          onClick={onCancel}
          className={SECONDARY_BUTTON_CLASS}
        >
          Cancel
        </button>
      )}
      <button type='button' data-testid='runtime-provisioning-hide' onClick={onHide} className={PRIMARY_BUTTON_CLASS}>
        Hide
      </button>
    </div>
  </>
)

const EndedStage = ({ view, onClose }: { view: EndedView; onClose: () => void }) => {
  const { title, body } = provisioningMessage(view.outcome.kind, outcomeFacts(view))
  const lastLines = lastLinesOf(view.outcome)

  return (
    <>
      <ModalTitle className='text-xl font-semibold'>{title}</ModalTitle>
      <MessageText message={{ title, body }} withTitle={false} />
      {lastLines.length > 0 && (
        <pre
          data-testid='runtime-provisioning-last-lines'
          className='max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-neutral-100 p-2 font-mono text-xs text-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
        >
          {lastLines.join('\n')}
        </pre>
      )}
      <div className='mt-2 flex gap-3'>
        <button
          type='button'
          data-testid='runtime-provisioning-close'
          onClick={onClose}
          className={PRIMARY_BUTTON_CLASS}
        >
          Close
        </button>
      </div>
    </>
  )
}

const RuntimeProvisioningDialog = () => {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const device = useDevice()
  const runtimeProvisioning = useRuntimeProvisioning()
  const view = useOpenPLCStore((state) => state.runtimeProvisioning.view)
  const dialogVisible = useOpenPLCStore((state) => state.runtimeProvisioning.dialogVisible)
  const [form, setForm] = useState<ProvisioningForm>(() => emptyForm(view.stage === 'offer' ? view.sshPort : null))
  const previousStage = useRef(view.stage)
  const announcedOperation = useRef<number | null>(view.stage === 'ended' ? view.operationId : null)

  useEffect(() => {
    const previous = previousStage.current
    previousStage.current = view.stage
    if (view.stage === 'offer') {
      if (previous !== 'offer' && previous !== 'running') setForm(emptyForm(view.sshPort))
      return
    }
    setForm((current) => (current.password === '' ? current : { ...current, password: '' }))
  }, [view])

  useEffect(() => {
    if (view.stage !== 'ended' || announcedOperation.current === view.operationId) return
    announcedOperation.current = view.operationId
    announceEnding(view)
  }, [view])

  const updateForm = (change: Partial<ProvisioningForm>) => setForm((current) => ({ ...current, ...change }))

  const submit = () => {
    const parsed = parseSshPortInput(form.portText)
    if (!parsed.ok) {
      store.getState().runtimeProvisioningActions.setOfferNotice({ kind: 'input-refused', field: 'port' })
      return
    }
    void submitProvisioningRun(
      store,
      { runtime, device, runtimeProvisioning },
      { username: form.username, password: form.password, sshPort: parsed.port },
    )
    setForm((current) => ({ ...current, password: '' }))
  }

  const decline = () => {
    declineProvisioningOffer(store)
    setForm(emptyForm(null))
  }

  const dismiss = () => {
    if (store.getState().runtimeProvisioning.view.stage === 'offer') setForm(emptyForm(null))
    dismissDialog(store)
  }

  const cancel = () => {
    if (runtimeProvisioning !== undefined) void cancelProvisioning(store, runtimeProvisioning)
  }

  return (
    <Modal
      open={dialogVisible && view.stage !== 'idle'}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <ModalContent
        data-testid='runtime-provisioning-dialog'
        onClose={dismiss}
        className='flex w-[480px] select-text flex-col gap-4 rounded-lg p-6'
      >
        {view.stage === 'offer' && (
          <OfferStage view={view} form={form} onFormChange={updateForm} onSubmit={submit} onDecline={decline} />
        )}
        {view.stage === 'running' && (
          <RunningStage view={view} onCancel={cancel} onHide={() => hideProvisioningDialog(store)} />
        )}
        {view.stage === 'ended' && (
          <EndedStage view={view} onClose={() => store.getState().runtimeProvisioningActions.acknowledgeEnding()} />
        )}
      </ModalContent>
    </Modal>
  )
}

export { RuntimeProvisioningDialog }
