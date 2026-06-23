import * as Tabs from '@radix-ui/react-tabs'
import type {
  OpcUaClientConfig,
  OpcUaClientDirection,
  OpcUaClientMapping,
  OpcUaClientSecurity,
} from '@root/middleware/shared/ports/types'
import { useMemo, useState } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import { InputWithRef } from '../../../../../_atoms/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../../../../../_molecules/modal'
import { useProjectVariables, type VariableTreeNode } from '../../server/opcua-server/hooks/use-project-variables'

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const SECURITY_POLICIES: OpcUaClientConfig['security']['securityPolicy'][] = [
  'None',
  'Basic256Sha256',
  'Aes128_Sha256_RsaOaep',
  'Aes256_Sha256_RsaPss',
]
const SECURITY_MODES: OpcUaClientSecurity['securityMode'][] = ['None', 'Sign', 'SignAndEncrypt']
const AUTH_MODES: OpcUaClientSecurity['authMode'][] = ['anonymous', 'username', 'certificate']
const DIRECTIONS: { value: OpcUaClientDirection; label: string }[] = [
  { value: 'remote_to_plc', label: 'Remote -> PLC (read)' },
  { value: 'plc_to_remote', label: 'PLC -> Remote (write)' },
]

const TabItem = ({ value, label, isActive }: { value: string; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption text-xs font-medium transition-colors',
      'border-b-2 border-transparent',
      'hover:text-brand-medium dark:hover:text-brand-light',
      isActive
        ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
        : 'text-neutral-500 dark:text-neutral-400',
    )}
  >
    {label}
  </Tabs.Trigger>
)

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <label className='mb-1 block font-caption text-xs font-medium text-neutral-700 dark:text-neutral-300'>
    {children}
  </label>
)

/** Flatten the project variable tree to its selectable leaves. */
const flattenSelectable = (nodes: VariableTreeNode[]): VariableTreeNode[] => {
  const out: VariableTreeNode[] = []
  const walk = (list: VariableTreeNode[]) => {
    for (const n of list) {
      if (n.isSelectable && n.type !== 'program' && n.type !== 'function_block' && n.type !== 'global') {
        out.push(n)
      }
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// ---------------------------------------------------------------------------
// Mapping modal
// ---------------------------------------------------------------------------

interface MappingModalProps {
  open: boolean
  onClose: () => void
  onSave: (mapping: OpcUaClientMapping) => void
  variables: VariableTreeNode[]
  existing?: OpcUaClientMapping | null
}

const MappingModal = ({ open, onClose, onSave, variables, existing }: MappingModalProps) => {
  const [variableKey, setVariableKey] = useState(existing ? `${existing.pouName}:${existing.variablePath}` : '')
  const [remoteNodeId, setRemoteNodeId] = useState(existing?.remoteNodeId ?? '')
  const [direction, setDirection] = useState<OpcUaClientDirection>(existing?.direction ?? 'remote_to_plc')
  const [cycleTimeMs, setCycleTimeMs] = useState<number>(existing?.cycleTimeMs ?? 100)

  const selected = useMemo(
    () => variables.find((v) => `${v.pouName}:${v.variablePath}` === variableKey),
    [variables, variableKey],
  )

  const isValid = Boolean(selected) && remoteNodeId.trim().length > 0 && cycleTimeMs > 0

  const handleSave = () => {
    if (!selected) return
    onSave({
      id: existing?.id ?? crypto.randomUUID(),
      pouName: selected.pouName,
      variablePath: selected.variablePath,
      variableType: selected.variableType ?? '',
      remoteNodeId: remoteNodeId.trim(),
      direction,
      cycleTimeMs,
    })
    onClose()
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className='h-auto max-h-[90vh] w-[560px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{existing ? 'Edit Mapping' : 'Add Mapping'}</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-3 overflow-y-auto py-2'>
          <div>
            <FieldLabel>Local PLC variable</FieldLabel>
            <Select value={variableKey} onValueChange={setVariableKey}>
              <SelectTrigger className={inputStyles} placeholder='Select a variable' />
              <SelectContent className='max-h-[260px] overflow-y-auto'>
                {variables.map((v) => {
                  const key = `${v.pouName}:${v.variablePath}`
                  return (
                    <SelectItem key={key} value={key}>
                      {`${v.pouName}.${v.variablePath}${v.variableType ? ` (${v.variableType})` : ''}`}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <FieldLabel>Remote NodeId</FieldLabel>
            <InputWithRef
              className={inputStyles}
              placeholder='e.g. ns=2;s=Tag or ns=2;i=5'
              value={remoteNodeId}
              onChange={(e) => setRemoteNodeId(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel>Direction</FieldLabel>
            <Select value={direction} onValueChange={(v) => setDirection(v as OpcUaClientDirection)}>
              <SelectTrigger className={inputStyles} placeholder='Select direction' />
              <SelectContent>
                {DIRECTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <FieldLabel>Cycle time (ms)</FieldLabel>
            <InputWithRef
              className={inputStyles}
              type='number'
              min={1}
              value={String(cycleTimeMs)}
              onChange={(e) => setCycleTimeMs(Number(e.target.value))}
            />
          </div>
        </div>

        <ModalFooter className='mt-2 flex justify-end gap-2'>
          <button
            onClick={onClose}
            className='rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className='rounded-md bg-brand px-3 py-1 text-xs font-medium text-white disabled:opacity-50'
          >
            {existing ? 'Save' : 'Add'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export const OpcUaClientEditor = () => {
  const {
    editor,
    project,
    projectActions: {
      updateOpcUaClientConnection,
      updateOpcUaClientSecurity,
      addOpcUaClientMapping,
      updateOpcUaClientMapping,
      removeOpcUaClientMapping,
    },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const [activeTab, setActiveTab] = useState('connection')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<OpcUaClientMapping | null>(null)

  const deviceName = editor.type === 'plc-remote-device' ? editor.meta.name : ''
  const device = useMemo(
    () => project.data.remoteDevices?.find((d) => d.name === deviceName),
    [project.data.remoteDevices, deviceName],
  )
  const config = device?.opcuaClientConfig

  const allVariables = useProjectVariables()
  const selectableVariables = useMemo(() => flattenSelectable(allVariables), [allVariables])

  const touch = () => handleFileAndWorkspaceSavedState(deviceName)

  if (!config) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>Loading OPC-UA client configuration...</p>
      </div>
    )
  }

  const sec = config.security

  return (
    <div aria-label='OPC-UA client container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>
          OPC-UA Client: {deviceName}
        </h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Connects to a remote OPC-UA server</p>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className='flex min-h-0 flex-1 flex-col'>
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='connection' label='Connection' isActive={activeTab === 'connection'} />
          <TabItem value='security' label='Security' isActive={activeTab === 'security'} />
          <TabItem value='mappings' label='Mappings' isActive={activeTab === 'mappings'} />
        </Tabs.List>

        {/* Connection */}
        <Tabs.Content value='connection' className='min-h-0 flex-1 overflow-auto pt-4 data-[state=inactive]:hidden'>
          <div className='flex max-w-xl flex-col gap-3'>
            <label className='flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              <input
                type='checkbox'
                checked={config.enabled}
                onChange={(e) => {
                  updateOpcUaClientConnection(deviceName, { enabled: e.target.checked })
                  touch()
                }}
              />
              Enabled
            </label>
            <div>
              <FieldLabel>Endpoint URL</FieldLabel>
              <InputWithRef
                className={inputStyles}
                placeholder='opc.tcp://host:4840/path'
                value={config.endpointUrl}
                onChange={(e) => {
                  updateOpcUaClientConnection(deviceName, { endpointUrl: e.target.value })
                  touch()
                }}
              />
            </div>
            <div>
              <FieldLabel>Session timeout (ms)</FieldLabel>
              <InputWithRef
                className={inputStyles}
                type='number'
                min={0}
                value={String(config.sessionTimeoutMs)}
                onChange={(e) => {
                  updateOpcUaClientConnection(deviceName, { sessionTimeoutMs: Number(e.target.value) })
                  touch()
                }}
              />
            </div>
            <label className='flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              <input
                type='checkbox'
                checked={config.reconnect}
                onChange={(e) => {
                  updateOpcUaClientConnection(deviceName, { reconnect: e.target.checked })
                  touch()
                }}
              />
              Reconnect automatically
            </label>
          </div>
        </Tabs.Content>

        {/* Security */}
        <Tabs.Content value='security' className='min-h-0 flex-1 overflow-auto pt-4 data-[state=inactive]:hidden'>
          <div className='flex max-w-xl flex-col gap-3'>
            <div>
              <FieldLabel>Security policy</FieldLabel>
              <Select
                value={sec.securityPolicy}
                onValueChange={(v) => {
                  updateOpcUaClientSecurity(deviceName, {
                    securityPolicy: v as OpcUaClientSecurity['securityPolicy'],
                  })
                  touch()
                }}
              >
                <SelectTrigger className={inputStyles} placeholder='Policy' />
                <SelectContent>
                  {SECURITY_POLICIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Security mode</FieldLabel>
              <Select
                value={sec.securityMode}
                onValueChange={(v) => {
                  updateOpcUaClientSecurity(deviceName, { securityMode: v as OpcUaClientSecurity['securityMode'] })
                  touch()
                }}
              >
                <SelectTrigger className={inputStyles} placeholder='Mode' />
                <SelectContent>
                  {SECURITY_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Authentication</FieldLabel>
              <Select
                value={sec.authMode}
                onValueChange={(v) => {
                  updateOpcUaClientSecurity(deviceName, { authMode: v as OpcUaClientSecurity['authMode'] })
                  touch()
                }}
              >
                <SelectTrigger className={inputStyles} placeholder='Auth mode' />
                <SelectContent>
                  {AUTH_MODES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sec.authMode === 'username' && (
              <>
                <div>
                  <FieldLabel>Username</FieldLabel>
                  <InputWithRef
                    className={inputStyles}
                    value={sec.username ?? ''}
                    onChange={(e) => {
                      updateOpcUaClientSecurity(deviceName, { username: e.target.value || null })
                      touch()
                    }}
                  />
                </div>
                <div>
                  <FieldLabel>Password</FieldLabel>
                  <InputWithRef
                    className={inputStyles}
                    type='password'
                    value={sec.password ?? ''}
                    onChange={(e) => {
                      updateOpcUaClientSecurity(deviceName, { password: e.target.value || null })
                      touch()
                    }}
                  />
                </div>
              </>
            )}

            {sec.authMode === 'certificate' && (
              <>
                <div>
                  <FieldLabel>Client certificate (PEM)</FieldLabel>
                  <textarea
                    className={cn(inputStyles, 'h-24 py-2 font-mono')}
                    value={sec.clientCertPem ?? ''}
                    onChange={(e) => {
                      updateOpcUaClientSecurity(deviceName, { clientCertPem: e.target.value || null })
                      touch()
                    }}
                  />
                </div>
                <div>
                  <FieldLabel>Client private key (PEM)</FieldLabel>
                  <textarea
                    className={cn(inputStyles, 'h-24 py-2 font-mono')}
                    value={sec.clientKeyPem ?? ''}
                    onChange={(e) => {
                      updateOpcUaClientSecurity(deviceName, { clientKeyPem: e.target.value || null })
                      touch()
                    }}
                  />
                </div>
              </>
            )}

            {sec.securityMode !== 'None' && (
              <div>
                <FieldLabel>Server certificate (PEM, optional)</FieldLabel>
                <textarea
                  className={cn(inputStyles, 'h-24 py-2 font-mono')}
                  value={sec.serverCertPem ?? ''}
                  onChange={(e) => {
                    updateOpcUaClientSecurity(deviceName, { serverCertPem: e.target.value || null })
                    touch()
                  }}
                />
              </div>
            )}
          </div>
        </Tabs.Content>

        {/* Mappings */}
        <Tabs.Content value='mappings' className='min-h-0 flex-1 overflow-auto pt-4 data-[state=inactive]:hidden'>
          <div className='mb-3 flex justify-end'>
            <button
              onClick={() => {
                setEditingMapping(null)
                setModalOpen(true)
              }}
              className='rounded-md bg-brand px-3 py-1 text-xs font-medium text-white'
            >
              Add Mapping
            </button>
          </div>

          {config.mappings.length === 0 ? (
            <p className='py-8 text-center text-xs text-neutral-500 dark:text-neutral-400'>
              No mappings yet. Add one to bridge a remote node to a local PLC variable.
            </p>
          ) : (
            <table className='w-full text-xs'>
              <thead>
                <tr className='border-b border-neutral-200 text-left dark:border-neutral-700'>
                  <th className='px-2 py-1 font-medium'>Local variable</th>
                  <th className='px-2 py-1 font-medium'>Remote NodeId</th>
                  <th className='px-2 py-1 font-medium'>Direction</th>
                  <th className='px-2 py-1 font-medium'>Cycle (ms)</th>
                  <th className='px-2 py-1' />
                </tr>
              </thead>
              <tbody>
                {config.mappings.map((m) => (
                  <tr key={m.id} className='border-b border-neutral-100 dark:border-neutral-800'>
                    <td className='px-2 py-1'>{`${m.pouName}.${m.variablePath}`}</td>
                    <td className='px-2 py-1 font-mono'>{m.remoteNodeId}</td>
                    <td className='px-2 py-1'>
                      {m.direction === 'remote_to_plc' ? 'Remote -> PLC' : 'PLC -> Remote'}
                    </td>
                    <td className='px-2 py-1'>{m.cycleTimeMs}</td>
                    <td className='px-2 py-1 text-right'>
                      <button
                        className='mr-2 text-brand-medium hover:underline dark:text-brand-light'
                        onClick={() => {
                          setEditingMapping(m)
                          setModalOpen(true)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className='text-red-500 hover:underline'
                        onClick={() => {
                          removeOpcUaClientMapping(deviceName, m.id)
                          touch()
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {modalOpen && (
        <MappingModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          variables={selectableVariables}
          existing={editingMapping}
          onSave={(mapping) => {
            if (editingMapping) {
              updateOpcUaClientMapping(deviceName, editingMapping.id, mapping)
            } else {
              addOpcUaClientMapping(deviceName, mapping)
            }
            touch()
          }}
        />
      )}
    </div>
  )
}
