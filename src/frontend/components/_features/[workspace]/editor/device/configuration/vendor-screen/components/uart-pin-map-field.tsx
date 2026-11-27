import { Label } from '@root/frontend/components/_atoms/label'
import { FieldHelpIcon } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import { resolveFieldOptionValues } from '@root/frontend/utils/vpp/field-options'
import {
  isValidRs485Pin,
  resolveRs485Pins,
  resolveRtuServerUart,
  RS485_PINS_KEY,
  rs485PinOf,
} from '@root/middleware/shared/utils/modbus-master-profile'
import { readSerialBaudState } from '@root/middleware/shared/utils/modbus-server-profile'
import { useMemo, useState } from 'react'

/** Screen-schema slice of a `uart-pin-map` field. */
export type UartPinMapFieldDef = {
  id: string
  label: string
  help?: string
  options?: string[] | Array<{ value: string; label: string }>
  optionsRef?: string
  validation?: string
}

type UartPinMapFieldProps = {
  sectionId: string
  field: UartPinMapFieldDef
  /** The section's stored state. */
  storedValues: Record<string, unknown>
  /** Key the field persists under inside the section's state. */
  storageKey: string
  disabled: boolean
  inputClassName: string
  /** Stores the whole pin map, one key per UART with a non-empty pin. */
  onCommit: (pins: Record<string, string>) => void
}

/** Compiles a package-supplied pattern, or `null` when it is absent or not a valid expression. */
function compilePattern(source: string | undefined): RegExp | null {
  if (!source) return null
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

/** Text of the entry error shown for `uart`. */
function invalidPinMessage(uart: string): string {
  return `RS-485 pin of ${uart} must be up to two capital letters followed by one to three digits, such as 22, A0 or PA14.`
}

/**
 * One RS-485 enable pin input per UART of the board, in the order the field's options give them. UARTs
 * whose pin the package fixes show no input. Values come from `resolveRs485Pins`, so a 4.3.x project's
 * pin shows on the UART of the Modbus RTU server.
 */
function UartPinMapField({
  sectionId,
  field,
  storedValues,
  storageKey,
  disabled,
  inputClassName,
  onCommit,
}: UartPinMapFieldProps) {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const board = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(deviceBoard))
  const servers = useOpenPLCStore((s) => s.project.data.servers)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [invalidUarts, setInvalidUarts] = useState<string[]>([])

  const fieldPattern = useMemo(() => compilePattern(field.validation), [field.validation])
  const fixedPins = board?.rs485FixedPins ?? {}
  const uarts = resolveFieldOptionValues(field, { board }).filter(
    (uart) => !Object.prototype.hasOwnProperty.call(fixedPins, uart),
  )
  const pins = resolveRs485Pins(
    readSerialBaudState({ serial: { ...storedValues, [RS485_PINS_KEY]: storedValues[storageKey] } }),
    {
      ...(board?.serialPorts ? { serialPorts: board.serialPorts } : {}),
      ...(board?.rs485FixedPins ? { rs485FixedPins: board.rs485FixedPins } : {}),
      perUartAware: true,
    },
    resolveRtuServerUart(servers, board),
  )

  const accepts = (value: string): boolean =>
    value === '' || (isValidRs485Pin(value) && (fieldPattern?.test(value) ?? true))

  const handleChange = (uart: string, value: string) => {
    if (!accepts(value)) {
      setDrafts((current) => ({ ...current, [uart]: value }))
      return
    }
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== uart)))
    setInvalidUarts((current) => current.filter((entry) => entry !== uart))
    const next: Array<[string, string]> = []
    for (const entry of uarts) {
      const pin = entry === uart ? value : rs485PinOf(pins, entry)
      if (pin) next.push([entry, pin])
    }
    onCommit(Object.fromEntries(next))
  }

  const handleBlur = (uart: string) => {
    if (!Object.prototype.hasOwnProperty.call(drafts, uart)) return
    setInvalidUarts((current) => (current.includes(uart) ? current : [...current, uart]))
  }

  return (
    <div className='flex items-start gap-4' data-testid={`${sectionId}-rs485-pins`}>
      <span className='min-w-32 shrink-0 whitespace-nowrap pt-[7px] text-xs text-neutral-950 dark:text-white'>
        {field.label}
      </span>
      <div className='flex flex-col gap-2'>
        {uarts.map((uart) => {
          const inputId = `vendor-field-${sectionId}-${field.id}-${uart}`
          return (
            <div key={uart} className='flex items-center gap-2'>
              <Label htmlFor={inputId} className='min-w-16 shrink-0 text-xs text-neutral-950 dark:text-white'>
                {uart}
              </Label>
              <input
                id={inputId}
                type='text'
                data-testid={`${sectionId}-rs485-pin-${uart}`}
                aria-label={`${field.label} ${uart}`}
                aria-invalid={invalidUarts.includes(uart)}
                value={drafts[uart] ?? rs485PinOf(pins, uart) ?? ''}
                onChange={(e) => handleChange(uart, e.target.value)}
                onBlur={() => handleBlur(uart)}
                disabled={disabled}
                className={inputClassName}
              />
            </div>
          )
        })}
        {invalidUarts
          .filter((uart) => uarts.includes(uart))
          .map((uart) => (
            <p key={uart} role='alert' className='text-xs text-red-500'>
              {invalidPinMessage(uart)}
            </p>
          ))}
      </div>
      {field.help && <FieldHelpIcon text={field.help} />}
    </div>
  )
}

export { UartPinMapField }
