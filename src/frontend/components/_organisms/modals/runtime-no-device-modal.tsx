import { type FormEvent, useEffect, useState } from 'react'

import { useDevice, useRuntime, useRuntimeProvisioning } from '../../../../middleware/shared/providers/platform-context'
import { parseSshPortInput } from '../../../../middleware/shared/utils/runtime-provisioning'
import { retryWithSshPort } from '../../../services/runtime-provisioning'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../store'
import { type ProvisioningMessage, provisioningMessage } from '../../../utils/runtime-provisioning-messages'
import { Label } from '../../_atoms/label'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type NoDeviceTarget = { host: string; sshPort: number }

function noDeviceTarget(data: unknown): NoDeviceTarget | null {
  if (typeof data !== 'object' || data === null || !('host' in data) || !('sshPort' in data)) return null
  const { host, sshPort } = data
  if (typeof host !== 'string' || typeof sshPort !== 'number') return null
  return { host, sshPort }
}

const MessageParagraphs = ({ message }: { message: ProvisioningMessage }) => (
  <>
    {message.body
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line, index) => (
        <p key={index}>{line}</p>
      ))}
  </>
)

const RuntimeNoDeviceModal = () => {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const device = useDevice()
  const runtimeProvisioning = useRuntimeProvisioning()
  const modal = useOpenPLCStore((state) => state.modals['runtime-no-device'])
  const onOpenChange = useOpenPLCStore((state) => state.modalActions.onOpenChange)
  const [portText, setPortText] = useState('')
  const [portRefused, setPortRefused] = useState(false)
  const [checking, setChecking] = useState(false)

  const target = noDeviceTarget(modal.data)
  const message = provisioningMessage('no-device', target ?? {})
  const refusal = provisioningMessage('input-refused', { field: 'port' })

  useEffect(() => {
    if (modal.open) return
    setPortText('')
    setPortRefused(false)
  }, [modal.open])

  const close = () => {
    onOpenChange('runtime-no-device', false)
  }

  const tryPort = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (target === null) return
    const parsed = parseSshPortInput(portText)
    if (!parsed.ok) {
      setPortRefused(true)
      return
    }
    setPortRefused(false)
    setChecking(true)
    try {
      await retryWithSshPort(store, { runtime, device, runtimeProvisioning }, target.host, parsed.port)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={modal.open && target !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <ModalContent
        data-testid='runtime-no-device-modal'
        onClose={close}
        className='flex w-[440px] flex-col gap-4 rounded-lg p-6'
      >
        <ModalTitle className='text-xl font-semibold'>{message.title}</ModalTitle>
        <div className='flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300'>
          <MessageParagraphs message={message} />
        </div>
        <form autoComplete='off' onSubmit={(event) => void tryPort(event)} className='flex flex-col gap-2'>
          <Label htmlFor='runtime-no-device-port-input' className='block text-sm text-neutral-950 dark:text-white'>
            Try another SSH port
          </Label>
          <div className='flex gap-2'>
            <input
              id='runtime-no-device-port-input'
              data-testid='runtime-no-device-port-input'
              type='text'
              inputMode='numeric'
              autoComplete='off'
              value={portText}
              onChange={(event) => {
                setPortText(event.target.value)
                setPortRefused(false)
              }}
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
            />
            <button
              type='submit'
              data-testid='runtime-no-device-try-port'
              disabled={checking}
              className='rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Check
            </button>
          </div>
          {portRefused && (
            <div className='flex flex-col gap-1 text-sm text-red-600 dark:text-red-400'>
              <p className='font-semibold'>{refusal.title}</p>
              <MessageParagraphs message={refusal} />
            </div>
          )}
        </form>
        <button
          type='button'
          onClick={close}
          className='w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
        >
          OK
        </button>
      </ModalContent>
    </Modal>
  )
}

export { RuntimeNoDeviceModal }
