import { useEffect, useState } from 'react'

import type {
  RuntimeIdentityPin,
  RuntimeIdentityPort,
} from '../../../../../../../middleware/shared/ports/runtime-identity-port'
import {
  formatRuntimeCertificateFingerprint,
  normalizeRuntimeCertificateFingerprint,
} from '../../../../../../utils/mqtt/credentials/runtime-identity'
import { buttonClass, hintClass, inputClass, labelClass, primaryButtonClass } from './fields'

interface RuntimeIdentityPanelProps {
  port: RuntimeIdentityPort
  targetKey: string
}

type PinState = { key: string; pin: RuntimeIdentityPin | null } | null

export const RuntimeIdentityPanel = ({ port, targetKey }: RuntimeIdentityPanelProps) => {
  const [state, setState] = useState<PinState>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setState(null)
    setDraft('')
    setError(null)
    port
      .getPin(targetKey)
      .then((pin) => {
        if (active) setState({ key: targetKey, pin })
      })
      .catch(() => {
        if (active) setState({ key: targetKey, pin: null })
      })
    return () => {
      active = false
    }
  }, [port, targetKey])

  const current = state !== null && state.key === targetKey ? state : null

  const trust = async () => {
    if (normalizeRuntimeCertificateFingerprint(draft) === null) {
      setError('Enter the SHA-256 fingerprint of the runtime certificate (64 hexadecimal digits).')
      return
    }
    setBusy(true)
    try {
      const result = await port.setPin(targetKey, draft)
      if (result.ok) {
        setState({ key: targetKey, pin: result.pin })
        setDraft('')
        setError(null)
      } else {
        setError(result.message)
      }
    } catch {
      setError('The trusted runtime could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    setBusy(true)
    try {
      await port.removePin(targetKey)
      setState({ key: targetKey, pin: null })
    } catch {
      setError('The trusted runtime could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label='Runtime identity'
      className='flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800'
    >
      <h3 className={labelClass}>Runtime identity</h3>
      {current === null ? (
        <p className={hintClass}>Checking the trusted runtime certificate...</p>
      ) : current.pin === null ? (
        <p className={hintClass} data-testid='runtime-identity-state' data-state='untrusted'>
          Not verified. The credential is sent only to a runtime whose certificate matches a fingerprint you confirm
          here. Read it on the device, for example with: openssl x509 -in webserver/certOPENPLC.pem -noout -fingerprint
          -sha256
        </p>
      ) : (
        <p className={hintClass} data-testid='runtime-identity-state' data-state='trusted'>
          Trusted certificate SHA-256 {formatRuntimeCertificateFingerprint(current.pin.sha256)} (since{' '}
          {current.pin.updatedAt}).
        </p>
      )}
      <div className='flex flex-col gap-1'>
        <label htmlFor='mqtt-runtime-fingerprint' className={labelClass}>
          Runtime certificate SHA-256 fingerprint
        </label>
        <input
          id='mqtt-runtime-fingerprint'
          className={inputClass}
          value={draft}
          autoComplete='off'
          spellCheck={false}
          placeholder='AB:CD:...'
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {error !== null && (
        <p role='alert' className='font-caption text-xs text-red-500'>
          {error}
        </p>
      )}
      <div className='flex gap-2'>
        <button
          type='button'
          className={primaryButtonClass}
          disabled={busy || current === null || draft.trim() === ''}
          onClick={() => void trust()}
        >
          Trust this runtime
        </button>
        {current?.pin && (
          <button type='button' className={buttonClass} disabled={busy} onClick={() => void forget()}>
            Forget trusted runtime
          </button>
        )}
      </div>
    </section>
  )
}
