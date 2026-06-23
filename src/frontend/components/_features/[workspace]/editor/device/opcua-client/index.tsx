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
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../../../../../_molecules/modal'
import { useProjectVariables, type VariableTreeNode } from '../../server/opcua-server/hooks/use-project-variables'

// Shared field styles — matched to the OPC-UA Server editor.
const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
const selectTriggerStyles =
  'flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
const selectContentStyles =
  'h-fit max-h-[240px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
const selectItemStyles = cn(
  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
  'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
)
const selectItemTextStyles =
  'text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'
const labelStyles = 'w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'

const SECURITY_POLICIES: OpcUaClientSecurity['securityPolicy'][] = [
  'None',
  'Basic256Sha256',
  'Aes128_Sha256_RsaOaep',
  'Aes256_Sha256_RsaPss',
]
const SECURITY_MODES: OpcUaClientSecurity['securityMode'][] = ['None', 'Sign', 'SignAndEncrypt']
const AUTH_MODES: { value: OpcUaClientSecurity['authMode']; label: string }[] = [
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'username', label: 'Username / Password' },
  { value: 'certificate', label: 'Certificate' },
]
const DIRECTIONS: { value: OpcUaClientDirection; label: string }[] = [
  { value: 'remote_to_plc', label: 'Remote -> PLC (read)' },
  { value: 'plc_to_remote', label: 'PLC -> Remote (write)' },
]

// ---------------------------------------------------------------------------
// Layout primitives (mirror the OPC-UA Server editor)
// ---------------------------------------------------------------------------

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

const SectionCard = ({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) => (
  <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
    <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>{title}</h3>
    {description && <p className='text-xs text-neutral-600 dark:text-neutral-400'>{description}</p>}
    {children}
  </div>
)

const Row = ({
  label,
  hint,
  fieldClassName = 'w-64',
  children,
}: {
  label: string
  hint?: string
  fieldClassName?: string
  children: React.ReactNode
}) => (
  <div className='flex items-center gap-4'>
    <Label className={labelStyles}>{label}</Label>
    <div className={fieldClassName}>{children}</div>
    {hint && <span className='text-xs text-neutral-500 dark:text-neutral-400'>{hint}</span>}
  </div>
)

const Toggle = ({
  label,
  checked,
  status,
  onChange,
}: {
  label: string
  checked: boolean
  status: string
  onChange: (checked: boolean) => void
}) => (
  <div className='flex items-center gap-4'>
    <Label className={labelStyles}>{label}</Label>
    <label className='relative inline-flex cursor-pointer items-center'>
      <input type='checkbox' checked={checked} onChange={(e) => onChange(e.target.checked)} className='peer sr-only' />
      <div
        className={cn(
          'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
          'peer-checked:bg-brand peer-checked:after:translate-x-full',
          'dark:bg-neutral-700 dark:peer-checked:bg-brand',
        )}
      />
    </label>
    <span className='text-xs text-neutral-600 dark:text-neutral-400'>{status}</span>
  </div>
)

const SimpleSelect = ({
  value,
  placeholder,
  options,
  onValueChange,
}: {
  value: string
  placeholder: string
  options: { value: string; label: string }[]
  onValueChange: (value: string) => void
}) => (
  <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger withIndicator placeholder={placeholder} className={selectTriggerStyles} />
    <SelectContent className={selectContentStyles}>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value} className={selectItemStyles}>
          <span className={selectItemTextStyles}>{o.label}</span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
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

  const variableOptions = variables.map((v) => ({
    value: `${v.pouName}:${v.variablePath}`,
    label: `${v.pouName}.${v.variablePath}${v.variableType ? ` (${v.variableType})` : ''}`,
  }))

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className='h-auto max-h-[90vh] w-[560px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{existing ? 'Edit Mapping' : 'Add Mapping'}</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-3 overflow-y-auto py-2'>
          <div className='flex flex-col gap-1'>
            <Label className='text-xs text-neutral-950 dark:text-white'>Local PLC variable</Label>
            <SimpleSelect
              value={variableKey}
              placeholder='Select a variable'
              options={variableOptions}
              onValueChange={setVariableKey}
            />
          </div>

          <div className='flex flex-col gap-1'>
            <Label className='text-xs text-neutral-950 dark:text-white'>Remote NodeId</Label>
            <InputWithRef
              className={inputStyles}
              placeholder='e.g. ns=2;s=Tag or ns=2;i=5'
              value={remoteNodeId}
              onChange={(e) => setRemoteNodeId(e.target.value)}
            />
          </div>

          <div className='flex flex-col gap-1'>
            <Label className='text-xs text-neutral-950 dark:text-white'>Direction</Label>
            <SimpleSelect
              value={direction}
              placeholder='Select direction'
              options={DIRECTIONS}
              onValueChange={(v) => setDirection(v as OpcUaClientDirection)}
            />
          </div>

          <div className='flex flex-col gap-1'>
            <Label className='text-xs text-neutral-950 dark:text-white'>Cycle time (ms)</Label>
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
  const setConn = (updates: Partial<OpcUaClientConfig>) => {
    updateOpcUaClientConnection(deviceName, updates)
    touch()
  }
  const setSec = (updates: Partial<OpcUaClientSecurity>) => {
    updateOpcUaClientSecurity(deviceName, updates)
    touch()
  }

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
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>OPC-UA Client: {deviceName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Connects to a remote OPC-UA server</p>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className='flex min-h-0 flex-1 flex-col'>
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='connection' label='Connection' isActive={activeTab === 'connection'} />
          <TabItem value='security' label='Security' isActive={activeTab === 'security'} />
          <TabItem value='mappings' label='Mappings' isActive={activeTab === 'mappings'} />
        </Tabs.List>

        {/* Connection */}
        <Tabs.Content
          value='connection'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <div className='min-h-0 flex-1 overflow-auto pb-4'>
            <div className='flex flex-col gap-6'>
              <SectionCard title='Connection'>
                <Toggle
                  label='Enable Client'
                  checked={config.enabled}
                  status={config.enabled ? 'Client will connect when PLC runs' : 'Client is disabled'}
                  onChange={(enabled) => setConn({ enabled })}
                />
                <Row label='Endpoint URL' fieldClassName='w-96'>
                  <InputWithRef
                    className={inputStyles}
                    placeholder='opc.tcp://host:4840/path'
                    value={config.endpointUrl}
                    onChange={(e) => setConn({ endpointUrl: e.target.value })}
                  />
                </Row>
                <Row label='Session timeout' hint='milliseconds (default: 60000)'>
                  <InputWithRef
                    className={inputStyles}
                    type='number'
                    min={0}
                    value={String(config.sessionTimeoutMs)}
                    onChange={(e) => setConn({ sessionTimeoutMs: Number(e.target.value) })}
                  />
                </Row>
                <Toggle
                  label='Auto-reconnect'
                  checked={config.reconnect}
                  status={config.reconnect ? 'Reconnects if the server drops' : 'Reconnect disabled'}
                  onChange={(reconnect) => setConn({ reconnect })}
                />
              </SectionCard>
            </div>
          </div>
        </Tabs.Content>

        {/* Security */}
        <Tabs.Content
          value='security'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <div className='min-h-0 flex-1 overflow-auto pb-4'>
            <div className='flex flex-col gap-6'>
              <SectionCard
                title='Secure Channel'
                description='How the client secures the connection to the remote server.'
              >
                <Row label='Security Policy'>
                  <SimpleSelect
                    value={sec.securityPolicy}
                    placeholder='Policy'
                    options={SECURITY_POLICIES.map((p) => ({ value: p, label: p }))}
                    onValueChange={(v) => setSec({ securityPolicy: v as OpcUaClientSecurity['securityPolicy'] })}
                  />
                </Row>
                <Row label='Security Mode'>
                  <SimpleSelect
                    value={sec.securityMode}
                    placeholder='Mode'
                    options={SECURITY_MODES.map((m) => ({ value: m, label: m }))}
                    onValueChange={(v) => setSec({ securityMode: v as OpcUaClientSecurity['securityMode'] })}
                  />
                </Row>
              </SectionCard>

              <SectionCard
                title='Authentication'
                description='How the client identifies itself to the remote server.'
              >
                <Row label='Auth Method'>
                  <SimpleSelect
                    value={sec.authMode}
                    placeholder='Auth method'
                    options={AUTH_MODES}
                    onValueChange={(v) => setSec({ authMode: v as OpcUaClientSecurity['authMode'] })}
                  />
                </Row>

                {sec.authMode === 'username' && (
                  <>
                    <Row label='Username'>
                      <InputWithRef
                        className={inputStyles}
                        value={sec.username ?? ''}
                        onChange={(e) => setSec({ username: e.target.value || null })}
                      />
                    </Row>
                    <Row label='Password'>
                      <InputWithRef
                        className={inputStyles}
                        type='password'
                        value={sec.password ?? ''}
                        onChange={(e) => setSec({ password: e.target.value || null })}
                      />
                    </Row>
                  </>
                )}

                {sec.authMode === 'certificate' && (
                  <>
                    <div className='flex items-start gap-4'>
                      <Label className={cn(labelStyles, 'pt-2')}>Client Certificate</Label>
                      <textarea
                        className={cn(inputStyles, 'h-24 w-96 py-2 font-mono')}
                        placeholder='-----BEGIN CERTIFICATE-----'
                        value={sec.clientCertPem ?? ''}
                        onChange={(e) => setSec({ clientCertPem: e.target.value || null })}
                      />
                    </div>
                    <div className='flex items-start gap-4'>
                      <Label className={cn(labelStyles, 'pt-2')}>Client Private Key</Label>
                      <textarea
                        className={cn(inputStyles, 'h-24 w-96 py-2 font-mono')}
                        placeholder='-----BEGIN PRIVATE KEY-----'
                        value={sec.clientKeyPem ?? ''}
                        onChange={(e) => setSec({ clientKeyPem: e.target.value || null })}
                      />
                    </div>
                  </>
                )}
              </SectionCard>

              {sec.securityMode !== 'None' && (
                <SectionCard
                  title='Server Certificate'
                  description='Optional. The remote server certificate to trust for Sign / SignAndEncrypt.'
                >
                  <div className='flex items-start gap-4'>
                    <Label className={cn(labelStyles, 'pt-2')}>Server Certificate</Label>
                    <textarea
                      className={cn(inputStyles, 'h-24 w-96 py-2 font-mono')}
                      placeholder='-----BEGIN CERTIFICATE-----'
                      value={sec.serverCertPem ?? ''}
                      onChange={(e) => setSec({ serverCertPem: e.target.value || null })}
                    />
                  </div>
                </SectionCard>
              )}
            </div>
          </div>
        </Tabs.Content>

        {/* Mappings */}
        <Tabs.Content
          value='mappings'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <div className='min-h-0 flex-1 overflow-auto pb-4'>
            <SectionCard
              title='Variable Mappings'
              description='Bind a remote OPC-UA node to a local PLC variable. Direction sets read (remote to PLC) or write (PLC to remote).'
            >
              <div className='flex justify-end'>
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
                    <tr className='border-b border-neutral-200 text-left text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'>
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
                        <td className='px-2 py-1 text-neutral-950 dark:text-white'>{`${m.pouName}.${m.variablePath}`}</td>
                        <td className='px-2 py-1 font-mono text-neutral-700 dark:text-neutral-300'>{m.remoteNodeId}</td>
                        <td className='px-2 py-1 text-neutral-700 dark:text-neutral-300'>
                          {m.direction === 'remote_to_plc' ? 'Remote -> PLC' : 'PLC -> Remote'}
                        </td>
                        <td className='px-2 py-1 text-neutral-700 dark:text-neutral-300'>{m.cycleTimeMs}</td>
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
            </SectionCard>
          </div>
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
