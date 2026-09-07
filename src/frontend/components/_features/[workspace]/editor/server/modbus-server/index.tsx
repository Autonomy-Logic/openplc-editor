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

/** Transport sets the target can be pointed at, in the order the selector
 *  shows them. "Both" only where the board actually offers both. */
function buildTransportChoices(
  offered: readonly ModbusServerTransport[],
): { label: string; transports: ModbusServerTransport[] }[] {
  const single = offered.map((transport) => ({ label: TRANSPORT_LABEL[transport], transports: [transport] }))
  return offered.length > 1 ? [...single, { label: 'Both', transports: [...offered] }] : single
}

function sameTransports(a: readonly ModbusServerTransport[], b: readonly ModbusServerTransport[]): boolean {
  return a.length === b.length && a.every((transport) => b.includes(transport))
}

const choiceButtonStyles =
  'h-[30px] rounded-md border px-3 font-caption text-xs font-medium transition-colors disabled:cursor-not-allowed'
const readOnlyValueStyles =
  'flex h-[30px] w-full items-center rounded-md bg-neutral-100 px-2 py-1 font-caption text-xs font-medium tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'

const ModbusServerEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)

  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : 'modbus-tcp'

  const { profile, transports, slaveId, serialPort, port, bindAddress, buffers, bufferMapping, available, actions } =
    useModbusServerConfig(serverName)

  // The RTU shares the editor's line when it is on the default UART. The
  // firmware serves both there, so the port's speed and its slave id are the
  // editor's own connection parameters -- owned by the package, shown here
  // read-only. Changing them would be changing how the editor reaches the board.
  const rtuOnEditorPort = transports.includes('rtu') && (serialPort === '' || serialPort === profile.defaultSerial)
  const transportChoices = buildTransportChoices(profile.transports)

  // Text state for the inputs that commit on blur, so a half-typed number does
  // not reach the store and get clamped mid-keystroke.
  const [slaveIdText, setSlaveIdText] = useState(String(slaveId))
  const [portText, setPortText] = useState(String(port))
  const [countText, setCountText] = useState<Partial<Record<ModbusSegment, string>>>({})

  useEffect(() => setSlaveIdText(String(slaveId)), [slaveId])
  useEffect(() => setPortText(String(port)), [port])
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
      // `setEditor` swaps what renders; `setSelectedTab` moves the highlight in
      // the tab strip. Doing only the first leaves the strip pointing at the
      // tab you just left, which reads as "the button did nothing".
      setSelectedTab(screenName)
    },
    [updateTabs, getEditorFromEditors, addModel, setEditor, setSelectedTab],
  )

  const commitSlaveId = useCallback(() => {
    const parsed = Number.parseInt(slaveIdText, 10)
    if (Number.isNaN(parsed) || parsed < MIN_SLAVE_ID || parsed > MAX_SLAVE_ID) {
      setSlaveIdText(String(slaveId))
      return
    }
    if (parsed !== slaveId) actions.setSlaveId(parsed)
  }, [slaveIdText, slaveId, actions])

  const commitPort = useCallback(() => {
    const parsed = Number.parseInt(portText, 10)
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
      setPortText(String(port))
      return
    }
    if (parsed !== port) actions.setPort(parsed)
  }, [portText, port, actions])

  const commitCount = useCallback(
    (segment: ModbusSegment) => {
      const meta = SEGMENT_META[segment]
      const raw = countText[segment]
      if (raw === undefined) return
      const floor = profile.minCounts?.[segment] ?? 0
      const ceiling = profile.maxCounts?.[segment] ?? meta.max
      const parsed = Number.parseInt(raw, 10)
      if (Number.isNaN(parsed) || parsed < floor || parsed > ceiling) {
        setCountText((prev) => ({ ...prev, [segment]: undefined }))
        return
      }
      if (parsed !== buffers[segment]) actions.setBufferCount(meta.group, meta.field, parsed)
    },
    [countText, buffers, actions, profile],
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

  const heading = `Modbus Server: ${serverName}`
  const activeSegments = profile.segments
  const visibleBlocks = BLOCK_ORDER.filter((block) =>
    activeSegments.some((segment) => SEGMENT_META[segment].block === block),
  )

  return (
    <div aria-label='Server content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>{heading}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>
          {transports.length > 0
            ? `Serving ${transports.map((t) => TRANSPORT_LABEL[t]).join(' and ')}`
            : 'Not serving yet — pick a transport below'}
        </p>
      </div>

      <div className='flex flex-1 flex-col gap-6 overflow-auto'>
        <Panel title='Transports'>
          {/* A server exists because the user created it, and it answers on
           * whatever it was given. Two independent switches could both end up
           * off, which would be deleting the server from inside its own
           * editor -- deleting is the explorer's Delete. */}
          <Row label='Serves' hint='Delete the server from the project tree to stop serving Modbus.'>
            <div className='flex gap-1'>
              {transportChoices.map((choice) => {
                const selected = sameTransports(choice.transports, transports)
                return (
                  <button
                    key={choice.label}
                    type='button'
                    aria-label={`serve-${choice.transports.join('-')}`}
                    aria-pressed={selected}
                    onClick={() => actions.setTransports(choice.transports)}
                    className={cn(
                      choiceButtonStyles,
                      selected
                        ? 'border-brand bg-brand !text-white'
                        : 'border-neutral-300 bg-white text-neutral-850 hover:bg-neutral-100 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800',
                    )}
                  >
                    {choice.label}
                  </button>
                )
              })}
            </div>
          </Row>

          {transports.includes('rtu') && profile.serialPorts.length > 0 && (
            <Row
              label='Serial Port'
              hint={
                rtuOnEditorPort
                  ? 'This is the port the editor talks to the board on. The firmware serves both there, so you talk to one at a time.'
                  : 'A UART of its own, separate from the editor connection.'
              }
            >
              <div className='w-64'>
                <Select value={serialPort || profile.defaultSerial} onValueChange={actions.setSerialPort}>
                  <SelectTrigger
                    withIndicator
                    placeholder='Select serial port'
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                    {profile.serialPorts.map((option) => (
                      <SelectItem
                        key={option}
                        value={option}
                        className={cn(
                          'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                          'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                        )}
                      >
                        <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {option}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Row>
          )}

          {transports.includes('rtu') && (
            <Row
              label='Slave ID'
              hint={
                rtuOnEditorPort
                  ? "Fixed to the board's own value: it is the id the editor dials, and changing it here would leave the board unreachable."
                  : `${MIN_SLAVE_ID}-${MAX_SLAVE_ID}. Change it and the board must be reflashed before the editor can reach it again.`
              }
            >
              <div className='w-24'>
                {rtuOnEditorPort ? (
                  <span aria-label='Slave ID' className={readOnlyValueStyles}>
                    {slaveId}
                  </span>
                ) : (
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
                )}
              </div>
            </Row>
          )}

          {transports.includes('tcp') && (
            <>
              {profile.configurableBindAddress && (
                <Row label='Network Interface'>
                  <div className='w-64'>
                    <Select value={bindAddress} onValueChange={actions.setBindAddress}>
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
                      {port}
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
        {(profile.vppScreens.serial || profile.vppScreens.network) && (
          <Panel title='Hardware Settings'>
            <p className='text-xs text-neutral-600 dark:text-neutral-400'>
              Which UART Modbus RTU uses, how fast it runs, the RS-485 driver-enable pin and the network credentials are
              properties of the board. They are configured on the pages its vendor package provides.
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
                        max={profile.maxCounts?.[segment] ?? meta.max}
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
