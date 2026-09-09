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
import { FieldHelpIcon, TooltipProvider } from '../../../../../_atoms/tooltip'
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

/** The rates every package's serial screen has ever offered. Held here because
 *  the speed of the server's UART is the server's now, not the package's. */
const BAUD_RATE_OPTIONS = ['9600', '14400', '19200', '38400', '57600', '115200']

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

/**
 * A named block of rows, with the way out to the board page that governs the
 * same wiring.
 *
 * The link belongs to the group and not to a row because it explains all of
 * them at once: the board's serial page holds that line's speed, its RS-485 pin
 * and its driver-enable flag, and none of those maps onto a single field here.
 * It used to be a card of its own two panels down, which is a long way to send
 * someone looking at a value they cannot edit.
 *
 * Rendered on every target, with the link disabled and carrying its reason
 * where the package ships no such page -- the same rule every other control on
 * this screen follows, and the reason the card was never conditional either.
 *
 * The group's NAME is the wire, not the protocol. Its rows are enabled by what
 * the board HAS rather than by what the user selected, so calling it "Modbus
 * RTU" would promise a coupling the screen does not implement.
 */
const Group = ({
  name,
  action,
  children,
}: {
  name?: string
  action?: { label: string; screen?: string; reason: string; onOpen: (screen: string) => void }
  children: React.ReactNode
}) => (
  <div
    className={
      name ? 'flex flex-col gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800' : 'flex flex-col gap-3'
    }
  >
    {name ? (
      <div className='flex items-baseline justify-between gap-4'>
        <span className='font-caption text-[10px] font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-600'>
          {name}
        </span>
        {action ? (
          <div className='flex items-center gap-1.5'>
            <button
              type='button'
              disabled={!action.screen}
              onClick={() => action.screen && action.onOpen(action.screen)}
              className={groupActionStyles}
            >
              {action.label}
              <span aria-hidden='true'>&#8599;</span>
            </button>
            {action.screen ? null : <FieldHelpIcon text={action.reason} />}
          </div>
        ) : null}
      </div>
    ) : null}
    {children}
  </div>
)

const Row = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className='flex items-center gap-2'>
    <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>{label}</Label>
    {children}
    {hint ? <FieldHelpIcon text={hint} /> : null}
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
    <FieldHelpIcon text={readOnly ? description : `${description} (max: ${max})`} />
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

const selectTriggerStyles =
  'flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
const selectContentStyles =
  'h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
const selectItemStyles = cn(
  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
)
/** The way out to a board page, sitting in a group header. A link rather than a
 *  button: it navigates, it does not act on this screen. */
const groupActionStyles =
  'inline-flex items-center gap-1 font-caption text-xs font-medium text-brand-medium-dark hover:text-brand disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:text-neutral-600 dark:text-brand-light dark:hover:text-brand dark:disabled:text-neutral-700'

/** A value the board states, shown in place of the control the user would
 *  otherwise get, and doubling as the way to the page that sets it. */
const boardValueStyles =
  'flex h-[30px] w-full items-center justify-between gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2 font-caption text-xs font-medium text-neutral-800 hover:border-brand-medium-dark hover:text-brand disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-neutral-300 disabled:hover:text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'

/**
 * Transport sets the dropdown offers, in a fixed order on every target. A set
 * the target cannot serve is rendered disabled rather than dropped, so the
 * screen has the same shape everywhere and the user can see what the board is
 * missing rather than guess.
 */
const TRANSPORT_CHOICES: { value: string; label: string; transports: ModbusServerTransport[] }[] = [
  { value: 'rtu', label: 'Modbus RTU', transports: ['rtu'] },
  { value: 'tcp', label: 'Modbus TCP', transports: ['tcp'] },
  { value: 'rtu+tcp', label: 'Modbus RTU and TCP', transports: ['rtu', 'tcp'] },
]

const ModbusServerEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)

  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : 'modbus-tcp'

  const {
    profile,
    transports,
    enabled,
    slaveId,
    serialPort,
    baudRate,
    baudRateEditable,
    port,
    bindAddress,
    buffers,
    bufferMapping,
    available,
    actions,
  } = useModbusServerConfig(serverName)

  // The RTU shares the editor's line when it is on the default UART. The firmware
  // answers both ids there and routes by function code, so the slave id stays the
  // user's to pick; what is shared is the wire, not the address.
  const rtuAvailable = profile.transports.includes('rtu')
  const boardSerialScreen = profile.vppScreens.serial

  // Why a board page is missing, which is two different situations wearing one
  // face. A pre-4.4.0 package still ships the Modbus screen it used to own, and
  // that is the only thing that tells it apart from a target that has no vendor
  // pages at all -- where the host OS really does own the ports.
  const packagePredatesSplit = !!profile.vppScreens.modbus
  const noBoardPage = (what: string): string =>
    packagePredatesSplit
      ? `This board's package predates 4.4.0 and ships no ${what} page. Update the package to reach it from here.`
      : `The host operating system owns this target's ${what}.`
  const rtuOnEditorPort =
    rtuAvailable && transports.includes('rtu') && (serialPort === '' || serialPort === profile.defaultSerial)

  const transportChoiceValue =
    TRANSPORT_CHOICES.find(
      (choice) =>
        choice.transports.length === transports.length && choice.transports.every((t) => transports.includes(t)),
    )?.value ?? 'tcp'
  const onTransportChange = useCallback(
    (value: string) => {
      const choice = TRANSPORT_CHOICES.find((entry) => entry.value === value)
      if (choice) actions.setTransports(choice.transports)
    },
    [actions],
  )
  const transportHint = profile.transports.includes('rtu')
    ? 'What the server answers on. Both means one board on two wires.'
    : 'This target serves over the network only.'

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
  const allSegments = Object.keys(SEGMENT_META) as ModbusSegment[]
  const visibleBlocks = BLOCK_ORDER

  return (
    <TooltipProvider>
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
          <Panel title='Modbus Server'>
            {/* One screen for every target. What a target cannot configure comes
             * through disabled with the reason, rather than absent: a control
             * that disappears makes the user wonder whether the feature exists
             * at all, and two targets whose screens differ in shape cannot be
             * compared. */}
            <Group>
              <Row label='Enabled' hint={enabled ? 'Serving.' : 'Not serving. Settings are kept.'}>
                <Toggle checked={enabled} onChange={actions.setEnabled} label='Enable Modbus server' />
              </Row>

              <Row label='Transport' hint={transportHint}>
                <div className='w-64'>
                  <Select value={transportChoiceValue} onValueChange={onTransportChange} disabled={!enabled}>
                    <SelectTrigger withIndicator placeholder='Select transport' className={selectTriggerStyles} />
                    <SelectContent className={selectContentStyles}>
                      {TRANSPORT_CHOICES.map((choice) => (
                        <SelectItem
                          key={choice.value}
                          value={choice.value}
                          disabled={!choice.transports.every((t) => profile.transports.includes(t))}
                          className={selectItemStyles}
                        >
                          <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                            {choice.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Row>
            </Group>

            <Group
              name='Serial line'
              action={{
                label: 'Board serial settings',
                screen: profile.vppScreens.serial,
                reason: noBoardPage('serial'),
                onOpen: openVppScreen,
              }}
            >
              <Row
                label='Serial Port'
                hint={
                  !rtuAvailable
                    ? 'RTU only.'
                    : rtuOnEditorPort
                      ? 'Shared with the editor connection. One at a time.'
                      : 'A UART of its own.'
                }
              >
                <div className='w-64'>
                  <Select
                    value={serialPort || profile.defaultSerial}
                    onValueChange={actions.setSerialPort}
                    disabled={!enabled || !rtuAvailable || profile.serialPorts.length === 0}
                  >
                    <SelectTrigger withIndicator placeholder='Select serial port' className={selectTriggerStyles} />
                    <SelectContent className={selectContentStyles}>
                      {(profile.serialPorts.length > 0 ? profile.serialPorts : [profile.defaultSerial]).map(
                        (option) => (
                          <SelectItem key={option} value={option} className={selectItemStyles}>
                            <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              {option}
                            </span>
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </Row>

              <Row
                label='Baud Rate'
                hint={
                  !rtuAvailable
                    ? 'RTU only.'
                    : baudRateEditable
                      ? 'Speed of this UART. Takes effect on the next upload.'
                      : 'Set by the board: this is the editor line, and one UART has one speed.'
                }
              >
                <div className='w-64'>
                  {/* On the default UART the value is the board's, so the control
                   *  stops being a dead dropdown and becomes the way to the page
                   *  that sets it. Only where such a page exists -- otherwise
                   *  there is nowhere to go and it stays a plain disabled field. */}
                  {!baudRateEditable && rtuAvailable && boardSerialScreen ? (
                    <button
                      type='button'
                      disabled={!enabled}
                      onClick={() => openVppScreen(boardSerialScreen)}
                      className={boardValueStyles}
                    >
                      <span>{baudRate}</span>
                      <span className='font-normal text-neutral-600 dark:text-neutral-500'>
                        set by the board <span aria-hidden='true'>&#8599;</span>
                      </span>
                    </button>
                  ) : (
                    <Select
                      value={baudRate}
                      onValueChange={(value) => actions.setBaudRate(Number(value))}
                      disabled={!enabled || !rtuAvailable || !baudRateEditable}
                    >
                      <SelectTrigger withIndicator placeholder='Select baud rate' className={selectTriggerStyles} />
                      <SelectContent className={selectContentStyles}>
                        {BAUD_RATE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option} className={selectItemStyles}>
                            <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              {option}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </Row>

              <Row
                label='Slave ID'
                hint={
                  !rtuAvailable
                    ? 'RTU only. TCP addresses by IP.'
                    : `${MIN_SLAVE_ID}-${MAX_SLAVE_ID}. Takes effect on the next upload.`
                }
              >
                <div className='w-24'>
                  <InputWithRef
                    type='number'
                    aria-label='Slave ID'
                    value={slaveIdText}
                    onChange={(e) => setSlaveIdText(e.target.value)}
                    onBlur={commitSlaveId}
                    min={MIN_SLAVE_ID}
                    max={MAX_SLAVE_ID}
                    disabled={!enabled || !rtuAvailable}
                    className={inputStyles}
                  />
                </div>
              </Row>
            </Group>

            <Group
              name='Network'
              action={{
                label: 'Board network settings',
                screen: profile.vppScreens.network,
                reason: noBoardPage('network'),
                onOpen: openVppScreen,
              }}
            >
              <Row
                label='Network Interface'
                hint={profile.configurableBindAddress ? undefined : 'This board has one interface.'}
              >
                <div className='w-64'>
                  <Select
                    value={bindAddress}
                    onValueChange={actions.setBindAddress}
                    disabled={!enabled || !profile.configurableBindAddress}
                  >
                    <SelectTrigger
                      withIndicator
                      placeholder='Select network interface'
                      className={selectTriggerStyles}
                    />
                    <SelectContent className={selectContentStyles}>
                      {BIND_ADDRESS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                          <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                            {option.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Row>

              <Row label='Port' hint={profile.configurablePort ? 'Default 502.' : 'Fixed by the firmware.'}>
                <div className='w-64'>
                  <InputWithRef
                    type='number'
                    aria-label='Port'
                    value={portText}
                    onChange={(e) => setPortText(e.target.value)}
                    onBlur={commitPort}
                    placeholder='502'
                    min='1'
                    max='65535'
                    disabled={!enabled || !profile.configurablePort}
                    className={inputStyles}
                  />
                </div>
              </Row>
            </Group>
          </Panel>

          <Panel title='Buffer Mapping'>
            <p className='text-xs text-neutral-600 dark:text-neutral-400'>
              {profile.configurableBuffers
                ? 'How many addresses each IEC segment gets.'
                : 'Sized by the firmware at compile time.'}
            </p>

            {/* A package published before 4.4.0 declares no I/O block, and the
             *  screen used to answer that by showing nothing at all — no counts,
             *  no address map — on a board that plainly has both. The firmware
             *  compiles with `openplc.h`'s own fallbacks in that case, so the map
             *  is derivable and correct; what it is not is DECLARED, and the
             *  difference is worth one line. */}
            {profile.countsSource === 'firmware-default' && (
              <p className='text-xs text-amber-700 dark:text-amber-400'>
                This board&apos;s package does not state its firmware I/O sizes, so the map below is built from the
                defaults every board of this family compiles with. Update the package to read the board&apos;s own.
              </p>
            )}

            {!profile.configurableBuffers && !profile.derivedCounts && (
              <p className='text-xs text-amber-700 dark:text-amber-400'>
                This target reports no Modbus buffer sizes, so no address map can be shown.
              </p>
            )}

            <div className='grid gap-4 sm:grid-cols-2'>
              {visibleBlocks.map((block) => (
                <BufferBlock key={block} title={block}>
                  {allSegments
                    .filter((segment) => SEGMENT_META[segment].block === block)
                    .map((segment) => {
                      const meta = SEGMENT_META[segment]
                      // A segment the target has no storage for is shown, sized
                      // zero, with the reason -- not hidden. Hiding it made two
                      // targets' screens differ in shape, and left the user with
                      // no way to tell "this board has no %MX" from "the editor
                      // forgot about %MX".
                      const absent = !profile.segments.includes(segment)
                      return (
                        <BufferInput
                          key={segment}
                          label={`%${segment}`}
                          value={absent ? '0' : (countText[segment] ?? String(buffers[segment]))}
                          onChange={(value) => setCountText((prev) => ({ ...prev, [segment]: value }))}
                          onBlur={() => commitCount(segment)}
                          max={profile.maxCounts?.[segment] ?? meta.max}
                          description={absent ? `${meta.description} — not on this target.` : meta.description}
                          readOnly={!profile.configurableBuffers || absent}
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
    </TooltipProvider>
  )
}

export { ModbusServerEditor }
