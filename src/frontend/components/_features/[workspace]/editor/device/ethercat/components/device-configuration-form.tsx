import { extractDefaultSdoConfigurations } from '@root/backend/shared/ethercat/sdo-config-defaults'
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { cn } from '@root/frontend/utils/cn'
import type {
  ESIChannel,
  ESICoEObject,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'

import { ChannelMappingTable } from './channel-mapping-table'
import { SdoParametersTable } from './sdo-parameters-table'

const inputClassName =
  'h-[26px] w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'

const disabledInputClassName = 'cursor-not-allowed opacity-50'

const parseNumericInput = (value: string, min = 0): number | undefined => {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed < min) return undefined
  return parsed
}

// ===================== Configuration Form =====================

type DeviceConfigurationFormProps = {
  config: EtherCATSlaveConfig
  updateConfig: <K extends keyof EtherCATSlaveConfig>(section: K, updates: Partial<EtherCATSlaveConfig[K]>) => void
}

const DeviceConfigurationForm = ({ config, updateConfig }: DeviceConfigurationFormProps) => (
  <div className='flex flex-col gap-4'>
    {/* Startup Checks */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Startup Checks</h6>
      <div className='flex flex-wrap gap-x-6 gap-y-2'>
        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
          <Checkbox
            checked={config.startupChecks.checkVendorId}
            onCheckedChange={(checked) => updateConfig('startupChecks', { checkVendorId: checked === true })}
          />
          Verify Vendor ID
        </label>
        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
          <Checkbox
            checked={config.startupChecks.checkProductCode}
            onCheckedChange={(checked) => updateConfig('startupChecks', { checkProductCode: checked === true })}
          />
          Verify Product Code
        </label>
      </div>
    </div>

    {/* Addressing */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Addressing</h6>
      <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>EtherCAT Address</span>
          <InputWithRef
            type='number'
            value={config.addressing.ethercatAddress}
            onChange={(e) => {
              const val = parseNumericInput(e.target.value)
              if (val !== undefined) updateConfig('addressing', { ethercatAddress: val })
            }}
            min={0}
            max={65535}
            className={inputClassName}
          />
          <span className='text-xs text-neutral-400 dark:text-neutral-500'>0 = auto</span>
        </div>
      </div>
    </div>

    {/* Timeouts */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Timeouts</h6>
      <div className='grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3'>
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>SDO (ms)</span>
          <InputWithRef
            type='number'
            value={config.timeouts.sdoTimeoutMs}
            onChange={(e) => {
              const val = parseNumericInput(e.target.value)
              if (val !== undefined) updateConfig('timeouts', { sdoTimeoutMs: val })
            }}
            min={0}
            className={inputClassName}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>I&#8594;P (ms)</span>
          <InputWithRef
            type='number'
            value={config.timeouts.initToPreOpTimeoutMs}
            onChange={(e) => {
              const val = parseNumericInput(e.target.value)
              if (val !== undefined) updateConfig('timeouts', { initToPreOpTimeoutMs: val })
            }}
            min={0}
            className={inputClassName}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
            P&#8594;S/S&#8594;O (ms)
          </span>
          <InputWithRef
            type='number'
            value={config.timeouts.safeOpToOpTimeoutMs}
            onChange={(e) => {
              const val = parseNumericInput(e.target.value)
              if (val !== undefined) updateConfig('timeouts', { safeOpToOpTimeoutMs: val })
            }}
            min={0}
            className={inputClassName}
          />
        </div>
      </div>
    </div>

    {/* Watchdog */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Watchdog</h6>
      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
            <Checkbox
              checked={config.watchdog.smWatchdogEnabled}
              onCheckedChange={(checked) => updateConfig('watchdog', { smWatchdogEnabled: checked === true })}
            />
            SM Watchdog
          </label>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Time (ms)</span>
            <InputWithRef
              type='number'
              value={config.watchdog.smWatchdogMs}
              disabled={!config.watchdog.smWatchdogEnabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('watchdog', { smWatchdogMs: val })
              }}
              min={0}
              className={cn(inputClassName, !config.watchdog.smWatchdogEnabled && disabledInputClassName)}
            />
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
            <Checkbox
              checked={config.watchdog.pdiWatchdogEnabled}
              onCheckedChange={(checked) => updateConfig('watchdog', { pdiWatchdogEnabled: checked === true })}
            />
            PDI Watchdog
          </label>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Time (ms)</span>
            <InputWithRef
              type='number'
              value={config.watchdog.pdiWatchdogMs}
              disabled={!config.watchdog.pdiWatchdogEnabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('watchdog', { pdiWatchdogMs: val })
              }}
              min={0}
              className={cn(inputClassName, !config.watchdog.pdiWatchdogEnabled && disabledInputClassName)}
            />
          </div>
        </div>
      </div>
    </div>

    {/* DOPE-704 E2: CoE flags from the ESI's <Mailbox><CoE>. These gate the
         PDO-assignment startup block (0x1C12/0x1C13 on PdoAssign), the module
         ident-list write (0xF030 on PdoConfig) and the Complete Access form
         of long SDO writes (0xF030/CompleteAccess=true). The checkboxes let
         the user override the ESI defaults when a slave advertises something
         different from what it actually accepts. */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>CoE Flags</h6>
      <div className='flex flex-wrap gap-x-6 gap-y-2'>
        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
          <Checkbox
            checked={config.coeFlags?.pdoAssign ?? false}
            onCheckedChange={(checked) =>
              updateConfig('coeFlags', {
                pdoAssign: checked === true,
                pdoConfig: config.coeFlags?.pdoConfig ?? false,
                completeAccess: config.coeFlags?.completeAccess ?? false,
              })
            }
          />
          PdoAssign (0x1C12 / 0x1C13 writes)
        </label>
        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
          <Checkbox
            checked={config.coeFlags?.pdoConfig ?? false}
            onCheckedChange={(checked) =>
              updateConfig('coeFlags', {
                pdoAssign: config.coeFlags?.pdoAssign ?? false,
                pdoConfig: checked === true,
                completeAccess: config.coeFlags?.completeAccess ?? false,
              })
            }
          />
          PdoConfig (0xF030 module ident list)
        </label>
        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
          <Checkbox
            checked={config.coeFlags?.completeAccess ?? false}
            onCheckedChange={(checked) =>
              updateConfig('coeFlags', {
                pdoAssign: config.coeFlags?.pdoAssign ?? false,
                pdoConfig: config.coeFlags?.pdoConfig ?? false,
                completeAccess: checked === true,
              })
            }
          />
          CompleteAccess (multi-sub-index SDO writes)
        </label>
      </div>
    </div>

    {/* Distributed Clocks (DC) */}
    <div>
      <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Distributed Clocks (DC)</h6>
      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
          <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
            <Checkbox
              checked={config.distributedClocks.dcEnabled}
              onCheckedChange={(checked) => updateConfig('distributedClocks', { dcEnabled: checked === true })}
            />
            Enable DC
          </label>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
              Sync Unit Cycle (us)
            </span>
            <InputWithRef
              type='number'
              value={config.distributedClocks.dcSyncUnitCycleUs}
              disabled={!config.distributedClocks.dcEnabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('distributedClocks', { dcSyncUnitCycleUs: val })
              }}
              min={0}
              className={cn(inputClassName, !config.distributedClocks.dcEnabled && disabledInputClassName)}
            />
            <span className='text-xs text-neutral-400 dark:text-neutral-500'>0 = master cycle</span>
          </div>
        </div>

        {/* SYNC0 */}
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pl-4'>
          <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
            <Checkbox
              checked={config.distributedClocks.dcSync0Enabled}
              disabled={!config.distributedClocks.dcEnabled}
              onCheckedChange={(checked) => updateConfig('distributedClocks', { dcSync0Enabled: checked === true })}
            />
            SYNC0
          </label>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Cycle (us)</span>
            <InputWithRef
              type='number'
              value={config.distributedClocks.dcSync0CycleUs}
              disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('distributedClocks', { dcSync0CycleUs: val })
              }}
              min={0}
              className={cn(
                inputClassName,
                (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled) &&
                  disabledInputClassName,
              )}
            />
          </div>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Shift (us)</span>
            <InputWithRef
              type='number'
              value={config.distributedClocks.dcSync0ShiftUs}
              disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('distributedClocks', { dcSync0ShiftUs: val })
              }}
              min={0}
              className={cn(
                inputClassName,
                (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled) &&
                  disabledInputClassName,
              )}
            />
          </div>
        </div>

        {/* SYNC1 */}
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pl-4'>
          <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
            <Checkbox
              checked={config.distributedClocks.dcSync1Enabled}
              disabled={!config.distributedClocks.dcEnabled}
              onCheckedChange={(checked) => updateConfig('distributedClocks', { dcSync1Enabled: checked === true })}
            />
            SYNC1
          </label>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Cycle (us)</span>
            <InputWithRef
              type='number'
              value={config.distributedClocks.dcSync1CycleUs}
              disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('distributedClocks', { dcSync1CycleUs: val })
              }}
              min={0}
              className={cn(
                inputClassName,
                (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled) &&
                  disabledInputClassName,
              )}
            />
          </div>
          <div className='flex items-center gap-2'>
            <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>Shift (us)</span>
            <InputWithRef
              type='number'
              value={config.distributedClocks.dcSync1ShiftUs}
              disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled}
              onChange={(e) => {
                const val = parseNumericInput(e.target.value)
                if (val !== undefined) updateConfig('distributedClocks', { dcSync1ShiftUs: val })
              }}
              min={0}
              className={cn(
                inputClassName,
                (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled) &&
                  disabledInputClassName,
              )}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
)

// ===================== SDO Parameters Section =====================

type SdoParametersSectionProps = {
  isLoading: boolean
  loadError: string | null
  sdoConfigurations: SDOConfigurationEntry[] | undefined
  coeObjects: ESICoEObject[] | undefined
  onUpdateSdoConfigurations: (configs: SDOConfigurationEntry[]) => void
}

const SdoParametersSection = ({
  isLoading,
  loadError,
  sdoConfigurations,
  coeObjects,
  onUpdateSdoConfigurations,
}: SdoParametersSectionProps) => (
  <>
    {isLoading && (
      <div className='flex items-center gap-2 py-4 text-sm text-neutral-500 dark:text-neutral-400'>
        <ArrowIcon size='sm' className='animate-spin stroke-neutral-400' />
        Loading CoE data...
      </div>
    )}

    {!isLoading && sdoConfigurations && sdoConfigurations.length > 0 && (
      <SdoParametersTable sdoConfigurations={sdoConfigurations} onUpdateSdoConfigurations={onUpdateSdoConfigurations} />
    )}

    {!isLoading && !loadError && sdoConfigurations && sdoConfigurations.length === 0 && (
      <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No configurable SDO parameters found in this device&apos;s CoE dictionary.
      </p>
    )}

    {!isLoading && !loadError && !sdoConfigurations && coeObjects && coeObjects.length > 0 && (
      <div className='flex flex-col items-center gap-2 py-4'>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          CoE Object Dictionary available. Auto-configure startup parameters?
        </p>
        <button
          onClick={() => {
            if (coeObjects) {
              onUpdateSdoConfigurations(extractDefaultSdoConfigurations(coeObjects))
            }
          }}
          className='rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-medium-dark'
        >
          Auto-configure from ESI defaults
        </button>
      </div>
    )}

    {loadError && (
      <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'>
        {loadError}
      </div>
    )}

    {!isLoading && !loadError && !sdoConfigurations && !coeObjects && (
      <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No CoE Object Dictionary available for this device.
      </p>
    )}
  </>
)

// ===================== Channel Mappings Section =====================

type ChannelMappingsSectionProps = {
  isLoading: boolean
  loadError: string | null
  channels: ESIChannel[]
  mappings: EtherCATChannelMapping[]
  onAliasChange: (channelId: string, alias: string) => void
}

const ChannelMappingsSection = ({
  isLoading,
  loadError,
  channels,
  mappings,
  onAliasChange,
}: ChannelMappingsSectionProps) => (
  <>
    {isLoading && (
      <div className='flex items-center gap-2 py-4 text-sm text-neutral-500 dark:text-neutral-400'>
        <ArrowIcon size='sm' className='animate-spin stroke-neutral-400' />
        Loading channels...
      </div>
    )}

    {loadError && (
      <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'>
        {loadError}
      </div>
    )}

    {!isLoading && !loadError && channels.length === 0 && (
      <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
        No channels available for this device.
      </p>
    )}

    {!isLoading && !loadError && channels.length > 0 && (
      <ChannelMappingTable channels={channels} mappings={mappings} onAliasChange={onAliasChange} />
    )}
  </>
)

export { ChannelMappingsSection, DeviceConfigurationForm, SdoParametersSection }
