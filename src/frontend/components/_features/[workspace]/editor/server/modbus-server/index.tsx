import type { ModbusBufferMapping } from '@root/middleware/shared/ports/types'
import type { ModbusSegment, ModbusServerTransport } from '@root/middleware/shared/utils/modbus-server-profile'
import { useCallback, useEffect, useState } from 'react'

import { useModbusServerConfig } from '../../../../../../hooks/use-modbus-server-config'
import { useOpenPLCStore } from '../../../../../../store'
import { CreateEditorObjectFromTab } from '../../../../../../store/slices/tabs/utils'
import { cn } from '../../../../../../utils/cn'
import { InputWithRef } from '../../../../../_atoms/input'
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import { AddressMappingReference } from './address-mapping-reference'

const BIND_ADDRESS_OPTIONS = [
  { value: '0.0.0.0', label: 'All Interfaces (0.0.0.0)' },
  { value: '127.0.0.1', label: 'Localhost (127.0.0.1)' },
]

// Buffer mapping constraints
const MAX_REGISTER_COUNT = 1024
const MAX_BIT_COUNT = 8192

/** Modbus RTU slave identifiers are 1-247; 0 is the broadcast address. */
const MIN_SLAVE_ID = 1
const MAX_SLAVE_ID = 247

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
    <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>{title}</h3>
    {children}
  </div>
)

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) => (
  <label className='relative inline-flex cursor-pointer items-center' aria-label={label}>
    <input type='checkbox' checked={checked} onChange={(e) => onChange(e.target.checked)} className='peer sr-only' />
    <div
      className={cn(
        'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
        'peer-checked:bg-brand peer-checked:after:translate-x-full',
        'dark:bg-neutral-700 dark:peer-checked:bg-brand',
      )}
    />
  </label>
)

const Row = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className='flex items-center gap-4'>
    <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>{label}</Label>
    {children}
    {hint ? <span className='text-xs text-neutral-500 dark:text-neutral-400'>{hint}</span> : null}
  </div>
)

interface BufferBlockProps {
  title: string
  children: React.ReactNode
}

const BufferBlock = ({ title, children }: BufferBlockProps) => (
  <div className='rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/40'>
    <div className='mb-2 text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400'>
      {title}
    </div>
    <div className='flex flex-col gap-2'>{children}</div>
  </div>
)

interface BufferInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  max: number
  description: string
  readOnly: boolean
}

const BufferInput = ({ label, value, onChange, onBlur, max, description, readOnly }: BufferInputProps) => (
  <div className='flex items-center gap-3'>
    <Label className='w-20 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>{label}</Label>
    <div className='w-24'>
      {readOnly ? (
        <span
          aria-label={`${label} count`}
          className='flex h-[28px] w-full items-center rounded-md border border-transparent bg-neutral-100 px-2 py-1 font-caption text-xs font-medium tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
        >
          {value}
        </span>
      ) : (
        <InputWithRef
          type='number'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          min='0'
          max={max.toString()}
          className='h-[28px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
        />
      )}
    </div>
    <span className='text-xs text-neutral-500 dark:text-neutral-400'>
      {readOnly ? description : `${description} (max: ${max})`}
    </span>
  </div>
)

/** Which buffer block each segment belongs to, and how it is described. */
const SEGMENT_META: Record<
  ModbusSegment,
  { block: string; group: keyof ModbusBufferMapping; field: string; description: string; max: number }
> = {
  QW: {
    block: 'Holding Registers',
    group: 'holdingRegisters',
    field: 'qwCount',
    description: 'Word outputs',
    max: MAX_REGISTER_COUNT,
  },
  MW: {
    block: 'Holding Registers',
    group: 'holdingRegisters',
    field: 'mwCount',
    description: 'Word memory',
    max: MAX_REGISTER_COUNT,
  },
  MD: {
    block: 'Holding Registers',
    group: 'holdingRegisters',
    field: 'mdCount',
    description: 'Double word memory (2 regs each)',
    max: MAX_REGISTER_COUNT,
  },
  ML: {
    block: 'Holding Registers',
    group: 'holdingRegisters',
    field: 'mlCount',
    description: 'Long word memory (4 regs each)',
    max: MAX_REGISTER_COUNT,
  },
  QX: { block: 'Coils', group: 'coils', field: 'qxBits', description: 'Boolean outputs', max: MAX_BIT_COUNT },
  MX: { block: 'Coils', group: 'coils', field: 'mxBits', description: 'Boolean memory', max: MAX_BIT_COUNT },
  IX: {
    block: 'Discrete Inputs',
    group: 'discreteInputs',
    field: 'ixBits',
    description: 'Boolean inputs',
    max: MAX_BIT_COUNT,
  },
  IW: {
    block: 'Input Registers',
    group: 'inputRegisters',
    field: 'iwCount',
    description: 'Word inputs',
    max: MAX_REGISTER_COUNT,
  },
}

const BLOCK_ORDER = ['Holding Registers', 'Coils', 'Discrete Inputs', 'Input Registers']

const TRANSPORT_LABEL: Record<ModbusServerTransport, string> = {
  rtu: 'Modbus RTU',
  tcp: 'Modbus TCP',
}

const ModbusServerEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)

  // In the `plc-server` store the tab names the server being edited. In the
  // vendor-screen store the board has exactly one Modbus configuration and
  // nothing to disambiguate, so the name is empty and the hook ignores it.
  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : 'modbus-tcp'

  const { profile, rtu, tcp, buffers, bufferMapping, available, actions } = useModbusServerConfig(serverName)

  // Text state for the inputs that commit on blur, so a half-typed number does
  // not reach the store and get clamped mid-keystroke.
  const [slaveIdText, setSlaveIdText] = useState(String(rtu.slaveId))
  const [portText, setPortText] = useState(String(tcp.port))
  const [countText, setCountText] = useState<Partial<Record<ModbusSegment, string>>>({})

  useEffect(() => setSlaveIdText(String(rtu.slaveId)), [rtu.slaveId])
  useEffect(() => setPortText(String(tcp.port)), [tcp.port])
  useEffect(() => setCountText({}), [serverName])

  const openVppScreen = useCallback(
    (screenName: string) => {
      const tab = {
        name: screenName,
        path: `/vendor-screen/${screenName}`,
        elementType: { type: 'vendor-screen' as const, screenName },
      }
      updateTabs(tab)
      const model = getEditorFromEditors(screenName) ?? CreateEditorObjectFromTab(tab)
      addModel(model)
      setEditor(model)
    },
    [updateTabs, getEditorFromEditors, addModel, setEditor],
  )

  const commitSlaveId = useCallback(() => {
    const parsed = Number.parseInt(slaveIdText, 10)
    if (Number.isNaN(parsed) || parsed < MIN_SLAVE_ID || parsed > MAX_SLAVE_ID) {
      setSlaveIdText(String(rtu.slaveId))
      return
    }
    if (parsed !== rtu.slaveId) actions.setSlaveId(parsed)
  }, [slaveIdText, rtu.slaveId, actions])

  const commitPort = useCallback(() => {
    const parsed = Number.parseInt(portText, 10)
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
      setPortText(String(tcp.port))
      return
    }
    if (parsed !== tcp.port) actions.setPort(parsed)
  }, [portText, tcp.port, actions])

  const commitCount = useCallback(
    (segment: ModbusSegment) => {
      const meta = SEGMENT_META[segment]
      const raw = countText[segment]
      if (raw === undefined) return
      const parsed = Number.parseInt(raw, 10)
      if (Number.isNaN(parsed) || parsed < 0 || parsed > meta.max) {
        setCountText((prev) => ({ ...prev, [segment]: undefined }))
        return
      }
      if (parsed !== buffers[segment]) actions.setBufferCount(meta.group, meta.field, parsed)
    },
    [countText, buffers, actions],
  )

  if (protocol !== 'modbus-tcp') {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>
          Configuration for {protocol} servers is not yet available.
        </p>
      </div>
    )
  }

  if (!available) {
    return (
      <div className='flex h-full w-full items-center justify-center p-8'>
        <p className='max-w-md text-center text-sm text-neutral-500 dark:text-neutral-400'>
          The selected target does not serve Modbus. Pick a board that does, or install the vendor package that adds
          Modbus support for it.
        </p>
      </div>
    )
  }

  const heading = profile.store === 'vendor-screen' ? 'Modbus Server' : `Modbus TCP Slave Server: ${serverName}`
  const activeSegments = profile.segments
  const visibleBlocks = BLOCK_ORDER.filter((block) =>
    activeSegments.some((segment) => SEGMENT_META[segment].block === block),
  )

  return (
    <div aria-label='Server content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>{heading}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>
          {profile.transports.map((t) => TRANSPORT_LABEL[t]).join(' and ')}
        </p>
      </div>

      <div className='flex flex-1 flex-col gap-6 overflow-auto'>
        <Panel title='Transports'>
          {profile.transports.includes('rtu') && (
            <>
              <Row label='Modbus RTU' hint={rtu.enabled ? 'Served over a hardware serial port' : 'Not served'}>
                <Toggle
                  checked={rtu.enabled}
                  onChange={(value) => actions.setTransportEnabled('rtu', value)}
                  label='Enable Modbus RTU'
                />
              </Row>
              {rtu.enabled && (
                <Row label='Slave ID' hint={`${MIN_SLAVE_ID}-${MAX_SLAVE_ID}. The debugger addresses this same id.`}>
                  <div className='w-24'>
                    <InputWithRef
                      type='number'
                      aria-label='Slave ID'
                      value={slaveIdText}
                      onChange={(e) => setSlaveIdText(e.target.value)}
                      onBlur={commitSlaveId}
                      min={MIN_SLAVE_ID}
                      max={MAX_SLAVE_ID}
                      className={inputStyles}
                    />
                  </div>
                </Row>
              )}
            </>
          )}

          {profile.transports.includes('tcp') && (
            <>
              <Row
                label={profile.transports.length > 1 ? 'Modbus TCP' : 'Enable Server'}
                hint={tcp.enabled ? 'Server will start when the PLC runs' : 'Server is disabled'}
              >
                <Toggle
                  checked={tcp.enabled}
                  onChange={(value) => actions.setTransportEnabled('tcp', value)}
                  label='Enable Modbus TCP'
                />
              </Row>

              {profile.configurableBindAddress && (
                <Row label='Network Interface'>
                  <div className='w-64'>
                    <Select value={tcp.bindAddress} onValueChange={actions.setBindAddress}>
                      <SelectTrigger
                        withIndicator
                        placeholder='Select network interface'
                        className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                        {BIND_ADDRESS_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className={cn(
                              'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                              'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                            )}
                          >
                            <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              {option.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Row>
              )}

              <Row
                label='Port'
                hint={
                  profile.configurablePort
                    ? 'Default: 502'
                    : 'Fixed by the firmware. Changing it needs a firmware change, not a setting.'
                }
              >
                <div className='w-64'>
                  {profile.configurablePort ? (
                    <InputWithRef
                      type='number'
                      aria-label='Port'
                      value={portText}
                      onChange={(e) => setPortText(e.target.value)}
                      onBlur={commitPort}
                      placeholder='502'
                      min='1'
                      max='65535'
                      className={inputStyles}
                    />
                  ) : (
                    <span
                      aria-label='Port'
                      className='flex h-[30px] w-full items-center rounded-md bg-neutral-100 px-2 py-1 font-caption text-xs font-medium tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                    >
                      {tcp.port}
                    </span>
                  )}
                </div>
              </Row>
            </>
          )}
        </Panel>

        {/* The board's own wiring — baud rates, RS-485 pin, Wi-Fi credentials —
         *  belongs to the vendor package that knows the hardware, and it is
         *  edited on the pages that package ships. Duplicating those fields
         *  here would give the same value two owners. */}
        {(profile.vppScreens.serial || profile.vppScreens.network || profile.vppScreens.modbus) && (
          <Panel title='Hardware Settings'>
            <p className='text-xs text-neutral-600 dark:text-neutral-400'>
              Serial speed, RS-485 wiring and network credentials are properties of the board. They are configured on
              the pages its vendor package provides.
            </p>
            <div className='flex flex-wrap gap-2'>
              {profile.vppScreens.serial && (
                <button
                  type='button'
                  onClick={() => openVppScreen(profile.vppScreens.serial as string)}
                  className='h-8 rounded-md border border-neutral-300 px-3 font-caption text-xs font-medium text-neutral-800 hover:border-brand-medium-dark hover:text-brand dark:border-neutral-700 dark:text-neutral-200'
                >
                  Serial settings
                </button>
              )}
              {profile.vppScreens.network && (
                <button
                  type='button'
                  onClick={() => openVppScreen(profile.vppScreens.network as string)}
                  className='h-8 rounded-md border border-neutral-300 px-3 font-caption text-xs font-medium text-neutral-800 hover:border-brand-medium-dark hover:text-brand dark:border-neutral-700 dark:text-neutral-200'
                >
                  Network settings
                </button>
              )}
              {profile.vppScreens.modbus && (
                <button
                  type='button'
                  onClick={() => openVppScreen(profile.vppScreens.modbus as string)}
                  className='h-8 rounded-md border border-neutral-300 px-3 font-caption text-xs font-medium text-neutral-800 hover:border-brand-medium-dark hover:text-brand dark:border-neutral-700 dark:text-neutral-200'
                >
                  Serial port &amp; RS-485
                </button>
              )}
            </div>
          </Panel>
        )}

        <Panel title='Buffer Mapping'>
          <p className='text-xs text-neutral-600 dark:text-neutral-400'>
            {profile.configurableBuffers
              ? 'Configure the size of each register segment exposed by the Modbus slave server. These values define how many addresses are allocated for each IEC variable type.'
              : 'This target sizes its Modbus buffers at compile time, from the I/O limits its firmware was built with. The counts below are what the board will serve.'}
          </p>

          {!profile.configurableBuffers && !profile.derivedCounts && (
            <p className='text-xs text-amber-700 dark:text-amber-400'>
              The vendor package for this board does not declare its firmware I/O limits, so the address map below
              cannot be computed. Update the package to see it.
            </p>
          )}

          <div className='grid gap-4 sm:grid-cols-2'>
            {visibleBlocks.map((block) => (
              <BufferBlock key={block} title={block}>
                {activeSegments
                  .filter((segment) => SEGMENT_META[segment].block === block)
                  .map((segment) => {
                    const meta = SEGMENT_META[segment]
                    return (
                      <BufferInput
                        key={segment}
                        label={`%${segment}`}
                        value={countText[segment] ?? String(buffers[segment])}
                        onChange={(value) => setCountText((prev) => ({ ...prev, [segment]: value }))}
                        onBlur={() => commitCount(segment)}
                        max={meta.max}
                        description={meta.description}
                        readOnly={!profile.configurableBuffers}
                      />
                    )
                  })}
              </BufferBlock>
            ))}
          </div>
        </Panel>

        {/* Which Modbus address each IEC segment answers on, recomputed from
         *  the buffer sizes above. A segment the target does not have arrives
         *  here sized 0, which the reference renders as an empty range rather
         *  than a row promising addresses that do not exist. */}
        {(profile.configurableBuffers || profile.derivedCounts) && (
          <AddressMappingReference bufferMapping={bufferMapping} />
        )}
      </div>
    </div>
  )
}

export { ModbusServerEditor }
