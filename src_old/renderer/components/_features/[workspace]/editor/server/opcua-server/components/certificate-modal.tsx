import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import type { OpcUaTrustedCertificate } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface CertificateModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (certificate: OpcUaTrustedCertificate) => void
  existingCertificateIds: string[]
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const textareaStyles =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-2 font-mono text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

// Simple PEM validation and info extraction
// Note: For production, consider using a proper certificate parsing library like node-forge
const parsePemCertificate = (pem: string): { valid: boolean; subject?: string; error?: string } => {
  const trimmed = pem.trim()

  if (!trimmed.startsWith('-----BEGIN CERTIFICATE-----')) {
    return { valid: false, error: 'Certificate must start with "-----BEGIN CERTIFICATE-----"' }
  }

  if (!trimmed.endsWith('-----END CERTIFICATE-----')) {
    return { valid: false, error: 'Certificate must end with "-----END CERTIFICATE-----"' }
  }

  // Extract the base64 content, normalizing CRLF line endings from Windows
  const lines = trimmed.split('\n')
  const contentLines = lines.slice(1, -1)
  const base64Content = contentLines.join('').replace(/\r/g, '').trim()

  if (base64Content.length < 100) {
    return { valid: false, error: 'Certificate content appears to be too short' }
  }

  // Try to validate base64
  try {
    atob(base64Content)
  } catch {
    return { valid: false, error: 'Certificate contains invalid base64 content' }
  }

  // Certificate appears valid - we can't parse the details without a proper library
  // but we can indicate it's a valid PEM format
  return { valid: true, subject: '(Certificate details available after adding)' }
}

// Generate a simple fingerprint for display (not cryptographically secure)
const generateSimpleFingerprint = (pem: string): string => {
  const hash = Array.from(pem)
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0')
  return `${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:...`
}

export const CertificateModal = ({ isOpen, onClose, onSave, existingCertificateIds }: CertificateModalProps) => {
  // Form state
  const [certificateId, setCertificateId] = useState('')
  const [pemContent, setPemContent] = useState('')
  const [pemError, setPemError] = useState<string | null>(null)

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCertificateId('')
      setPemContent('')
      setPemError(null)
    }
  }, [isOpen])

  // Validate PEM when content changes
  useEffect(() => {
    if (pemContent.trim()) {
      const result = parsePemCertificate(pemContent)
      if (!result.valid) {
        setPemError(result.error ?? 'Invalid certificate')
      } else {
        setPemError(null)
      }
    } else {
      setPemError(null)
    }
  }, [pemContent])

  // Certificate preview info
  const certificateInfo = useMemo(() => {
    if (!pemContent.trim() || pemError) return null
    return {
      fingerprint: generateSimpleFingerprint(pemContent),
    }
  }, [pemContent, pemError])

  // Validation rules
  const validationErrors = useMemo(() => {
    const errors: string[] = []

    // Certificate ID validation
    if (!certificateId.trim()) {
      errors.push('Certificate ID is required')
    } else if (certificateId.length > 64) {
      errors.push('Certificate ID must be 64 characters or less')
    } else if (!/^[a-zA-Z0-9_-]+$/.test(certificateId.trim())) {
      errors.push('Certificate ID can only contain letters, numbers, hyphens, and underscores')
    } else {
      // Check for duplicate ID
      const isDuplicate = existingCertificateIds.some((id) => id.toLowerCase() === certificateId.trim().toLowerCase())
      if (isDuplicate) {
        errors.push('A certificate with this ID already exists')
      }
    }

    // PEM validation
    if (!pemContent.trim()) {
      errors.push('Certificate PEM content is required')
    } else if (pemError) {
      errors.push(pemError)
    }

    return errors
  }, [certificateId, pemContent, pemError, existingCertificateIds])

  const isValid = validationErrors.length === 0

  // Handle file browse
  const handleBrowseFile = useCallback(() => {
    // Use the file input approach since we're in a web context
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pem,.crt,.cer'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        void file.text().then((content) => {
          setPemContent(content)
        })
      }
    }
    input.click()
  }, [])

  // Handle save
  const handleSave = useCallback(() => {
    if (!isValid) return

    const certificate: OpcUaTrustedCertificate = {
      id: certificateId.trim(),
      pem: pemContent.trim(),
      fingerprint: certificateInfo?.fingerprint,
    }

    onSave(certificate)
    onClose()
  }, [isValid, certificateId, pemContent, certificateInfo, onSave, onClose])

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='h-auto max-h-[90vh] w-[550px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>Add Trusted Client Certificate</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-4 overflow-y-auto'>
          {/* Certificate ID */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Certificate ID</Label>
            <InputWithRef
              type='text'
              value={certificateId}
              onChange={(e) => setCertificateId(e.target.value)}
              placeholder='e.g., engineer_client'
              maxLength={64}
              className={inputStyles}
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              Unique identifier used to reference this certificate in user configuration
            </span>
          </div>

          {/* PEM Content */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Certificate (PEM format)</Label>
            <textarea
              value={pemContent}
              onChange={(e) => setPemContent(e.target.value)}
              placeholder={`-----BEGIN CERTIFICATE-----
MIIEpDCCAowCCQC7...
-----END CERTIFICATE-----`}
              rows={8}
              className={cn(textareaStyles, pemError && 'border-red-500')}
            />
            <button
              type='button'
              onClick={handleBrowseFile}
              className='h-[32px] w-fit rounded-md border border-neutral-300 bg-white px-4 font-caption !text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            >
              Browse File...
            </button>
          </div>

          {/* Certificate Details Preview */}
          {certificateInfo && (
            <div className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
              <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
                Certificate Details
              </h4>
              <div className='space-y-1 text-xs text-neutral-600 dark:text-neutral-400'>
                <p>
                  <span className='font-medium'>Fingerprint:</span> {certificateInfo.fingerprint}
                </p>
                <p className='text-neutral-500'>
                  Note: Full certificate details (subject, validity dates) will be parsed by the runtime.
                </p>
              </div>
            </div>
          )}

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950'>
              <ul className='list-inside list-disc space-y-1'>
                {validationErrors.map((error, index) => (
                  <li key={index} className='text-xs text-red-600 dark:text-red-400'>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <ModalFooter className='mt-4 flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-[32px] rounded-md border border-neutral-300 bg-white px-4 font-caption !text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={handleSave}
            disabled={!isValid}
            className={cn(
              'h-[32px] rounded-md bg-brand px-4 font-caption !text-xs font-medium text-white hover:bg-brand-medium-dark',
              !isValid && 'cursor-not-allowed opacity-50',
            )}
          >
            Add Certificate
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
