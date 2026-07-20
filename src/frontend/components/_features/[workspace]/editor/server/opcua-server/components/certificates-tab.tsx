import { PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type { OpcUaServerConfig, OpcUaTrustedCertificate } from '@root/middleware/shared/ports/types'
import { useCallback, useMemo, useState } from 'react'

import { Label } from '../../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../../_atoms/select'
import { CertificateModal } from './certificate-modal'

interface CertificatesTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

const textareaStyles =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-2 font-mono text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

type CertificateStrategy = 'auto_self_signed' | 'custom'

export const CertificatesTab = ({ config, serverName, onConfigChange }: CertificatesTabProps) => {
  const {
    projectActions: { updateOpcUaServerCertificateStrategy, addOpcUaTrustedCertificate, removeOpcUaTrustedCertificate },
  } = useOpenPLCStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [customCert, setCustomCert] = useState(config.security.serverCertificateCustom ?? '')
  const [customKey, setCustomKey] = useState(config.security.serverPrivateKeyCustom ?? '')

  // Get existing certificate IDs for validation
  const existingCertificateIds = useMemo(
    () => config.security.trustedClientCertificates.map((c) => c.id),
    [config.security.trustedClientCertificates],
  )

  // Handle strategy change
  const handleStrategyChange = useCallback(
    (strategy: CertificateStrategy) => {
      if (strategy === 'custom') {
        updateOpcUaServerCertificateStrategy(serverName, strategy, customCert || null, customKey || null)
      } else {
        updateOpcUaServerCertificateStrategy(serverName, strategy, null, null)
      }
      onConfigChange()
    },
    [serverName, customCert, customKey, updateOpcUaServerCertificateStrategy, onConfigChange],
  )

  // Handle custom certificate change
  const handleCustomCertChange = useCallback(
    (cert: string) => {
      setCustomCert(cert)
      if (config.security.serverCertificateStrategy === 'custom') {
        updateOpcUaServerCertificateStrategy(serverName, 'custom', cert || null, customKey || null)
        onConfigChange()
      }
    },
    [
      serverName,
      customKey,
      config.security.serverCertificateStrategy,
      updateOpcUaServerCertificateStrategy,
      onConfigChange,
    ],
  )

  // Handle custom key change
  const handleCustomKeyChange = useCallback(
    (key: string) => {
      setCustomKey(key)
      if (config.security.serverCertificateStrategy === 'custom') {
        updateOpcUaServerCertificateStrategy(serverName, 'custom', customCert || null, key || null)
        onConfigChange()
      }
    },
    [
      serverName,
      customCert,
      config.security.serverCertificateStrategy,
      updateOpcUaServerCertificateStrategy,
      onConfigChange,
    ],
  )

  // Handle file browse for certificate
  const handleBrowseCertFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pem,.crt,.cer'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        void file.text().then((content) => {
          handleCustomCertChange(content)
        })
      }
    }
    input.click()
  }, [handleCustomCertChange])

  // Handle file browse for key
  const handleBrowseKeyFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pem,.key'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        void file.text().then((content) => {
          handleCustomKeyChange(content)
        })
      }
    }
    input.click()
  }, [handleCustomKeyChange])

  // Handle adding a trusted certificate
  const handleAddCertificate = useCallback(() => {
    setIsModalOpen(true)
  }, [])

  // Handle saving a trusted certificate
  const handleSaveCertificate = useCallback(
    (certificate: OpcUaTrustedCertificate) => {
      addOpcUaTrustedCertificate(serverName, certificate)
      onConfigChange()
    },
    [serverName, addOpcUaTrustedCertificate, onConfigChange],
  )

  // Handle deleting a trusted certificate
  const handleDeleteCertificate = useCallback(
    (certificateId: string) => {
      const result = removeOpcUaTrustedCertificate(serverName, certificateId)
      if (result.ok) {
        onConfigChange()
      }
    },
    [serverName, removeOpcUaTrustedCertificate, onConfigChange],
  )

  return (
    <div className='flex flex-col gap-6'>
      {/* Server Certificate Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Server Certificate</h3>

        {/* Certificate Strategy */}
        <div className='flex flex-col gap-2'>
          <Label className='text-xs text-neutral-950 dark:text-white'>Certificate Strategy</Label>
          <Select
            value={config.security.serverCertificateStrategy}
            onValueChange={(v) => handleStrategyChange(v as CertificateStrategy)}
          >
            <SelectTrigger
              withIndicator
              placeholder='Select strategy'
              className='flex h-[30px] w-full max-w-[300px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
            <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
              <SelectItem
                value='auto_self_signed'
                className={cn(
                  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                  'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                )}
              >
                <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Auto-generate Self-Signed
                </span>
              </SelectItem>
              <SelectItem
                value='custom'
                className={cn(
                  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                  'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                )}
              >
                <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Use Custom Certificate
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            {config.security.serverCertificateStrategy === 'auto_self_signed'
              ? 'The runtime will automatically generate a self-signed certificate'
              : 'Provide your own certificate and private key'}
          </span>
        </div>

        {/* Custom Certificate Fields */}
        {config.security.serverCertificateStrategy === 'custom' && (
          <div className='flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800'>
            {/* Server Certificate */}
            <div className='flex flex-col gap-2'>
              <Label className='text-xs text-neutral-950 dark:text-white'>Server Certificate (PEM format)</Label>
              <textarea
                value={customCert}
                onChange={(e) => handleCustomCertChange(e.target.value)}
                placeholder={`-----BEGIN CERTIFICATE-----
MIIEpDCCAowCCQC7...
-----END CERTIFICATE-----`}
                rows={6}
                className={textareaStyles}
              />
              <button
                type='button'
                onClick={handleBrowseCertFile}
                className='h-[32px] w-fit rounded-md border border-neutral-300 bg-white px-4 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              >
                Browse File...
              </button>
            </div>

            {/* Server Private Key */}
            <div className='flex flex-col gap-2'>
              <Label className='text-xs text-neutral-950 dark:text-white'>Server Private Key (PEM format)</Label>
              <textarea
                value={customKey}
                onChange={(e) => handleCustomKeyChange(e.target.value)}
                placeholder={`-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBg...
-----END PRIVATE KEY-----`}
                rows={6}
                className={textareaStyles}
              />
              <button
                type='button'
                onClick={handleBrowseKeyFile}
                className='h-[32px] w-fit rounded-md border border-neutral-300 bg-white px-4 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              >
                Browse File...
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trusted Client Certificates Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
          Trusted Client Certificates
        </h3>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Client certificates that are trusted for certificate authentication.
        </p>

        {/* Add Certificate Button */}
        <button
          type='button'
          onClick={handleAddCertificate}
          className='flex w-fit items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
        >
          <PlusIcon className='h-4 w-4' />
          Add Trusted Certificate
        </button>

        {/* Certificates Table */}
        {config.security.trustedClientCertificates.length === 0 ? (
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>
            No trusted certificates configured. Add certificates to enable certificate-based authentication.
          </p>
        ) : (
          <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
            <table className='w-full'>
              <thead className='bg-neutral-100 dark:bg-neutral-900'>
                <tr>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>ID</th>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Subject
                  </th>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Valid
                  </th>
                  <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Fingerprint
                  </th>
                  <th className='px-3 py-2 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {config.security.trustedClientCertificates.map((cert) => (
                  <tr key={cert.id} className='border-t border-neutral-200 dark:border-neutral-700'>
                    <td className='px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100'>{cert.id}</td>
                    <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>{cert.subject || '-'}</td>
                    <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                      {cert.validFrom && cert.validTo ? `${cert.validFrom} to ${cert.validTo}` : '-'}
                    </td>
                    <td className='px-3 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-500'>
                      {cert.fingerprint || '-'}
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <div className='flex justify-end gap-2'>
                        <button
                          type='button'
                          onClick={() => handleDeleteCertificate(cert.id)}
                          className='rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                          title='Delete'
                        >
                          <TrashIcon className='h-4 w-4' />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for adding certificates */}
      <CertificateModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveCertificate}
        existingCertificateIds={existingCertificateIds}
      />
    </div>
  )
}
