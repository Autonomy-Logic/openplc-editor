import { type Cia402Role, resolveCia402Objects } from '@root/backend/shared/ethercat/cia402'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import type { Cia402AxisConfig, ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import { useMemo } from 'react'

const inputClassName =
  'h-[26px] w-28 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'

/** Human labels for the CiA 402 object roles, in a sensible display order. */
const ROLE_LABELS: Array<{ role: Cia402Role; label: string }> = [
  { role: 'controlWord', label: 'Control Word (0x6040)' },
  { role: 'statusWord', label: 'Status Word (0x6041)' },
  { role: 'modesOfOperation', label: 'Modes of Operation (0x6060)' },
  { role: 'modesDisplay', label: 'Modes Display (0x6061)' },
  { role: 'targetPosition', label: 'Target Position (0x607A)' },
  { role: 'positionActual', label: 'Position Actual (0x6064)' },
  { role: 'profileVelocity', label: 'Profile Velocity (0x6081)' },
  { role: 'targetVelocity', label: 'Target Velocity (0x60FF)' },
  { role: 'velocityActual', label: 'Velocity Actual (0x606C)' },
  { role: 'targetTorque', label: 'Target Torque (0x6071)' },
  { role: 'torqueActual', label: 'Torque Actual (0x6077)' },
]

/** Feedback signals shown in the live-values panel (drive → controller). */
const FEEDBACK_SIGNALS: Array<{ role: Cia402Role; label: string; unit: string }> = [
  { role: 'positionActual', label: 'Actual Position', unit: 'u' },
  { role: 'velocityActual', label: 'Actual Velocity', unit: 'u/s' },
  { role: 'torqueActual', label: 'Actual Torque', unit: '' },
  { role: 'statusWord', label: 'Status Word', unit: '' },
]

function parseFloatInput(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseIntInput(value: string, min: number): number | undefined {
  const n = parseInt(value, 10)
  return Number.isNaN(n) || n < min ? undefined : n
}

export type Cia402AxisTabProps = {
  device: ConfiguredEtherCATDevice
  /** Merge-updates the device's CiA 402 axis config in the store. */
  onUpdate: (patch: Partial<Cia402AxisConfig>) => void
}

/**
 * SoftMotion axis (CiA 402) configuration + live-feedback screen — the OpenPLC
 * analogue of the CODESYS CiA 402 device editor. Lets the user tune the
 * increments↔units scaling used by SM_Drive_GenericDS402, shows how the drive's
 * CiA 402 objects map to IEC located addresses, and (when a PLC is connected)
 * displays real-time axis feedback. The device name is the axis name used in
 * MC_*(Axis := <name>).
 */
export const Cia402AxisTab = ({ device, onUpdate }: Cia402AxisTabProps) => {
  const cia402: Cia402AxisConfig = device.cia402 ?? {
    enabled: false,
    scaleNum: 1,
    scaleDenom: 1,
    scaleFactor: 1,
  }

  const resolved = useMemo(
    () => resolveCia402Objects(device.channelInfo ?? [], device.channelMappings),
    [device.channelInfo, device.channelMappings],
  )
  const locationByRole = useMemo(() => {
    const m = new Map<Cia402Role, { iecLocation: string; iecType: string }>()
    for (const o of resolved) m.set(o.role, { iecLocation: o.iecLocation, iecType: o.iecType })
    return m
  }, [resolved])

  const denom = cia402.scaleDenom === 0 ? 1 : cia402.scaleDenom
  const incPerUnit = cia402.scaleFactor * (cia402.scaleNum / denom)

  return (
    <div className='flex flex-col gap-6'>
      {/* Scaling */}
      <div>
        <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
          Scaling (increments ↔ technical units)
        </h6>
        <div className='flex flex-wrap items-end gap-x-6 gap-y-3'>
          <label className='flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400'>
            Units ratio numerator
            <InputWithRef
              type='number'
              value={cia402.scaleNum}
              min={1}
              className={inputClassName}
              onChange={(e) => {
                const v = parseIntInput(e.target.value, 1)
                if (v !== undefined) onUpdate({ scaleNum: v })
              }}
            />
          </label>
          <label className='flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400'>
            Units ratio denominator
            <InputWithRef
              type='number'
              value={cia402.scaleDenom}
              min={1}
              className={inputClassName}
              onChange={(e) => {
                const v = parseIntInput(e.target.value, 1)
                if (v !== undefined) onUpdate({ scaleDenom: v })
              }}
            />
          </label>
          <label className='flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400'>
            Scale factor (inc/unit)
            <InputWithRef
              type='number'
              value={cia402.scaleFactor}
              step='any'
              className={inputClassName}
              onChange={(e) => {
                const v = parseFloatInput(e.target.value)
                if (v !== undefined) onUpdate({ scaleFactor: v })
              }}
            />
          </label>
          <div className='flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-400'>
            Increments per unit
            <span className='flex h-[26px] items-center font-mono text-neutral-700 dark:text-neutral-300'>
              {Number.isFinite(incPerUnit) ? incPerUnit : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* CiA 402 object → IEC address mapping */}
      <div>
        <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>CiA 402 Object Mapping</h6>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[420px] text-left text-xs'>
            <thead className='text-neutral-500 dark:text-neutral-400'>
              <tr>
                <th className='py-1 pr-4 font-medium'>Object</th>
                <th className='py-1 pr-4 font-medium'>IEC Address</th>
                <th className='py-1 font-medium'>Type</th>
              </tr>
            </thead>
            <tbody className='text-neutral-700 dark:text-neutral-300'>
              {ROLE_LABELS.map(({ role, label }) => {
                const m = locationByRole.get(role)
                return (
                  <tr key={role} className='border-t border-neutral-100 dark:border-neutral-800'>
                    <td className='py-1 pr-4'>{label}</td>
                    <td className='py-1 pr-4 font-mono'>{m?.iecLocation ?? '—'}</td>
                    <td className='py-1 font-mono'>{m?.iecType ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real-time feedback */}
      <div>
        <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Real-time Feedback</h6>
        <div className='grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4'>
          {FEEDBACK_SIGNALS.map(({ role, label, unit }) => {
            const mapped = locationByRole.has(role)
            return (
              <div key={role} className='flex flex-col gap-0.5'>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>{label}</span>
                <span className='font-mono text-sm text-neutral-400 dark:text-neutral-500'>
                  {mapped ? `— ${unit}` : 'n/a'}
                </span>
              </div>
            )
          })}
        </div>
        <p className='mt-2 text-xs text-neutral-400 dark:text-neutral-500'>
          Live values appear here when connected to a running PLC and monitoring is active.
        </p>
      </div>
    </div>
  )
}
