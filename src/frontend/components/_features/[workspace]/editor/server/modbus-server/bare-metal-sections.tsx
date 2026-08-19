/**
 * The two Modbus sections a bare-metal target owns: the serial (RTU) slave and
 * the network link underneath Modbus TCP.
 *
 * Until DOPE-442 these were a screen definition shipped by nine VPP packages
 * and rendered by the generic vendor-screen renderer, which meant a project
 * configured Modbus in two unrelated places depending on its target. They now
 * live here, beside the buffer mapping, so there is one Modbus screen.
 *
 * Every control stays mounted on targets that have no serial slave and no link
 * of their own — a runtime takes both from its host OS — and renders disabled
 * instead. Mounting them conditionally is what makes a form jump a section
 * down the page when the target changes, which is precisely what the old
 * screen's `visible` rules did.
 */

import type { ModbusRtuConfig, ModbusTcpLinkConfig } from '@root/middleware/shared/ports/types'
import { useEffect, useState } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import { BAUD_RATES, clampSlaveId, SERIAL_PORTS } from '../../../../../../utils/modbus/serial-link-config'
import { InputWithRef } from '../../../../../_atoms/input'
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

interface RowProps {
  label: string
  hint?: string
  disabled: boolean
  children: React.ReactNode
}

const Row = ({ label, hint, disabled, children }: RowProps) => (
  <div className={cn('flex items-center gap-4', disabled && 'opacity-60')}>
    <Label className='w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>{label}</Label>
    <div className='w-64 shrink-0'>{children}</div>
    {hint && <span className='text-xs text-neutral-500 dark:text-neutral-400'>{hint}</span>}
  </div>
)

interface ToggleRowProps {
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

const ToggleRow = ({ label, hint, checked, disabled, onChange }: ToggleRowProps) => (
  <Row label={label} hint={hint} disabled={disabled}>
    <label className={cn('relative inline-flex items-center', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type='checkbox'
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className='peer sr-only'
      />
      <div
        className={cn(
          'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
          'peer-checked:bg-brand peer-checked:after:translate-x-full',
          'dark:bg-neutral-700 dark:peer-checked:bg-brand',
        )}
      />
    </label>
  </Row>
)

interface SelectRowProps {
  label: string
  hint?: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}

const SelectRow = ({ label, hint, value, options, disabled, onChange }: SelectRowProps) => (
  <Row label={label} hint={hint} disabled={disabled}>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        withIndicator
        placeholder={label}
        disabled={disabled}
        className={cn(
          'flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />
      <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
        {options.map((option) => (
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
  </Row>
)

interface TextRowProps {
  label: string
  hint?: string
  value: string
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  disabled: boolean
  onChange: (value: string) => void
  onCommit: () => void
}

const TextRow = ({ label, hint, value, placeholder, type = 'text', disabled, onChange, onCommit }: TextRowProps) => (
  <Row label={label} hint={hint} disabled={disabled}>
    <InputWithRef
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      className={inputStyles}
    />
  </Row>
)

const toOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }))

const MEDIUM_OPTIONS = [
  { value: 'ethernet', label: 'Ethernet' },
  { value: 'wifi', label: 'Wi-Fi' },
] as const

/** Free-text fields are held locally and committed on blur, like the port. */
interface TextDraft {
  slaveId: string
  rs485EnPin: string
  macAddress: string
  wifiSsid: string
  wifiPassword: string
  ipAddress: string
  gateway: string
  subnet: string
  dns: string
}

const draftFrom = (rtu: ModbusRtuConfig, tcpLink: ModbusTcpLinkConfig): TextDraft => ({
  slaveId: rtu.slaveId.toString(),
  rs485EnPin: rtu.rs485EnPin,
  macAddress: tcpLink.macAddress,
  wifiSsid: tcpLink.wifiSsid,
  wifiPassword: tcpLink.wifiPassword,
  ipAddress: tcpLink.ipAddress,
  gateway: tcpLink.gateway,
  subnet: tcpLink.subnet,
  dns: tcpLink.dns,
})

interface BareMetalModbusSectionsProps {
  serverName: string
  rtu: ModbusRtuConfig
  tcpLink: ModbusTcpLinkConfig
  /** False on targets without a serial slave or a link of their own. */
  editable: boolean
}

const BareMetalModbusSections = ({ serverName, rtu, tcpLink, editable }: BareMetalModbusSectionsProps) => {
  const {
    projectActions,
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const [draft, setDraft] = useState<TextDraft>(() => draftFrom(rtu, tcpLink))

  // Follow the saved configuration, so a rejected or abandoned edit snaps back
  // instead of sitting on screen disagreeing with what the build will use.
  useEffect(() => {
    setDraft(draftFrom(rtu, tcpLink))
  }, [rtu, tcpLink])

  const commitRtu = (patch: Partial<ModbusRtuConfig>) => {
    projectActions.updateServerConfig(serverName, { rtu: patch })
    handleFileAndWorkspaceSavedState(serverName)
  }

  const commitLink = (patch: Partial<ModbusTcpLinkConfig>) => {
    projectActions.updateServerConfig(serverName, { tcpLink: patch })
    handleFileAndWorkspaceSavedState(serverName)
  }

  const editField = (field: keyof TextDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))

  const commitSlaveId = () => {
    const parsed = Number.parseInt(draft.slaveId, 10)
    // An unparseable id would silently become NaN in the project file, so the
    // last saved value wins and the box goes back to showing it.
    if (Number.isNaN(parsed)) {
      setDraft((current) => ({ ...current, slaveId: rtu.slaveId.toString() }))
      return
    }
    const clamped = clampSlaveId(parsed)
    setDraft((current) => ({ ...current, slaveId: clamped.toString() }))
    if (clamped !== rtu.slaveId) commitRtu({ slaveId: clamped })
  }

  const rtuOff = !editable || !rtu.enabled
  const linkOff = !editable || !tcpLink.enabled

  return (
    <>
      <section className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <div className='flex flex-col gap-1'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Serial Slave</h3>
          <p className='text-xs text-neutral-600 dark:text-neutral-400'>
            {editable
              ? 'Serve Modbus RTU over one of the board’s hardware UARTs. The debugger reaches the board on the same port, at this baud rate.'
              : 'Only bare-metal targets serve Modbus over a UART. The selected target serves Modbus over TCP only.'}
          </p>
        </div>

        <ToggleRow
          label='Enable Modbus RTU'
          hint={rtu.enabled ? 'Slave answers on the serial port' : 'Serial slave is off'}
          checked={rtu.enabled}
          disabled={!editable}
          onChange={(enabled) => commitRtu({ enabled })}
        />
        <SelectRow
          label='Serial Port'
          hint='Boards with a single UART only expose Serial'
          value={rtu.serialPort}
          options={toOptions(SERIAL_PORTS)}
          disabled={rtuOff}
          onChange={(serialPort) => commitRtu({ serialPort: readSerialPort(serialPort) })}
        />
        <SelectRow
          label='Baud Rate'
          hint='Also the speed the debugger dials'
          value={rtu.baudRate}
          options={toOptions(BAUD_RATES)}
          disabled={rtuOff}
          onChange={(baudRate) => commitRtu({ baudRate: readBaudRate(baudRate) })}
        />
        <TextRow
          label='Slave ID'
          hint='1-247'
          type='number'
          value={draft.slaveId}
          disabled={rtuOff}
          onChange={editField('slaveId')}
          onCommit={commitSlaveId}
        />
        <ToggleRow
          label='RS485 Enable Pin'
          hint='For an external transceiver with an explicit driver-enable'
          checked={rtu.useRs485EnPin}
          disabled={rtuOff}
          onChange={(useRs485EnPin) => commitRtu({ useRs485EnPin })}
        />
        <TextRow
          label='DE/RE GPIO'
          hint='Pin driving the transceiver'
          value={draft.rs485EnPin}
          disabled={rtuOff || !rtu.useRs485EnPin}
          onChange={editField('rs485EnPin')}
          onCommit={() => commitRtu({ rs485EnPin: draft.rs485EnPin })}
        />
      </section>

      <section className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <div className='flex flex-col gap-1'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Network Link</h3>
          <p className='text-xs text-neutral-600 dark:text-neutral-400'>
            {editable
              ? 'How the board reaches the network it serves Modbus TCP on. Separate from the Network Interface above, which is the address the server binds to.'
              : 'The selected target takes its network configuration from its host operating system.'}
          </p>
        </div>

        <ToggleRow
          label='Enable Modbus TCP'
          hint={tcpLink.enabled ? 'Board brings up the link at boot' : 'Board serves Modbus over serial only'}
          checked={tcpLink.enabled}
          disabled={!editable}
          onChange={(enabled) => commitLink({ enabled })}
        />
        <SelectRow
          label='Medium'
          value={tcpLink.medium}
          options={MEDIUM_OPTIONS}
          disabled={linkOff}
          onChange={(medium) => commitLink({ medium: medium === 'wifi' ? 'wifi' : 'ethernet' })}
        />
        <TextRow
          label='MAC Address'
          hint='Only for boards without a built-in MAC'
          placeholder='DE:AD:BE:EF:FE:ED'
          value={draft.macAddress}
          disabled={linkOff || tcpLink.medium !== 'ethernet'}
          onChange={editField('macAddress')}
          onCommit={() => commitLink({ macAddress: draft.macAddress })}
        />
        <TextRow
          label='Wi-Fi SSID'
          value={draft.wifiSsid}
          disabled={linkOff || tcpLink.medium !== 'wifi'}
          onChange={editField('wifiSsid')}
          onCommit={() => commitLink({ wifiSsid: draft.wifiSsid })}
        />
        <TextRow
          label='Wi-Fi Password'
          type='password'
          value={draft.wifiPassword}
          disabled={linkOff || tcpLink.medium !== 'wifi'}
          onChange={editField('wifiPassword')}
          onCommit={() => commitLink({ wifiPassword: draft.wifiPassword })}
        />
        <ToggleRow
          label='Use DHCP'
          hint={tcpLink.useDhcp ? 'Address assigned by the network' : 'Static host configuration below'}
          checked={tcpLink.useDhcp}
          disabled={linkOff}
          onChange={(useDhcp) => commitLink({ useDhcp })}
        />
        <TextRow
          label='IP Address'
          placeholder='192.168.0.50'
          value={draft.ipAddress}
          disabled={linkOff || tcpLink.useDhcp}
          onChange={editField('ipAddress')}
          onCommit={() => commitLink({ ipAddress: draft.ipAddress })}
        />
        <TextRow
          label='Gateway'
          placeholder='192.168.0.1'
          value={draft.gateway}
          disabled={linkOff || tcpLink.useDhcp}
          onChange={editField('gateway')}
          onCommit={() => commitLink({ gateway: draft.gateway })}
        />
        <TextRow
          label='Subnet Mask'
          placeholder='255.255.255.0'
          value={draft.subnet}
          disabled={linkOff || tcpLink.useDhcp}
          onChange={editField('subnet')}
          onCommit={() => commitLink({ subnet: draft.subnet })}
        />
        <TextRow
          label='DNS'
          placeholder='8.8.8.8'
          value={draft.dns}
          disabled={linkOff || tcpLink.useDhcp}
          onChange={editField('dns')}
          onCommit={() => commitLink({ dns: draft.dns })}
        />
      </section>
    </>
  )
}

/** Narrow a Select's string back to the union, never with a cast. */
function readSerialPort(value: string): ModbusRtuConfig['serialPort'] {
  return SERIAL_PORTS.find((port) => port === value) ?? 'Serial'
}

function readBaudRate(value: string): ModbusRtuConfig['baudRate'] {
  return BAUD_RATES.find((baud) => baud === value) ?? '115200'
}

export { BareMetalModbusSections }
