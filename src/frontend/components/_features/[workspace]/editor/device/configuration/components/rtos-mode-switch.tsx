import { Label } from '@root/frontend/components/_atoms/label'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { FieldHelpIcon, TooltipProvider } from '@root/frontend/components/_atoms/tooltip'
import { useOpenPLCStore } from '@root/frontend/store'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { readRtosSettings, RTOS_SETTINGS_SECTION, rtosScheduleProblem } from '@root/middleware/shared/utils/rtos'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

const RTOS_MODE_HELP =
  'Runs each PLC task, and the debugger and Modbus, as a task of its own on the board’s RTOS, so a block ' +
  'waiting on the network holds up only its own task. Turn off to build the single scan loop.'

type RtosModeSwitchProps = {
  boardInfo: BoardInfo | undefined
}

/**
 * The per-board RTOS mode switch. Shown only where the board's Arduino core has
 * an RTOS the firmware supports; the choice is kept in the board's
 * `vendorScreenData`, where the build reads it. Styled as a VPP form row.
 */
function RtosModeSwitch({ boardInfo }: RtosModeSwitchProps) {
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const tasks = useOpenPLCStore((s) => s.project.data.configurations.resource.tasks)

  const profile = resolveTargetCapabilities(boardInfo).rtos
  if (!profile) return null
  const { enabled, chosen } = readRtosSettings(vendorScreenData)
  // Said here, beside the switch, as well as by the build: what this project
  // gets when RTOS mode is on but cannot run it.
  const problem = enabled ? rtosScheduleProblem(tasks, profile) : undefined

  // A switch left at the board's default and one set by hand behave differently
  // when the project cannot run in RTOS mode (the default builds the single
  // loop; a choice fails the build), so the row says which it is, and a choice
  // can be handed back to the default.
  const describedBy = problem ? 'rtos-mode-state rtos-mode-problem' : 'rtos-mode-state'

  return (
    <TooltipProvider>
      <div id='rtos-mode-field' className='flex flex-col gap-1'>
        <div className='flex items-center gap-4'>
          <Label
            htmlFor='rtos-mode-switch'
            className='min-w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'
          >
            RTOS mode
          </Label>
          <ToggleSwitch
            id='rtos-mode-switch'
            checked={enabled}
            onCheckedChange={(checked) => setVendorScreenData(RTOS_SETTINGS_SECTION, { enabled: checked })}
            aria-label='RTOS mode'
            aria-describedby={describedBy}
          />
          <FieldHelpIcon text={RTOS_MODE_HELP} />
          <span id='rtos-mode-state' className='text-xs text-neutral-500 dark:text-neutral-400'>
            {chosen ? 'Set for this board' : 'Board default'}
          </span>
          {chosen && (
            <button
              type='button'
              className='text-xs text-brand underline-offset-2 hover:underline'
              onClick={() => setVendorScreenData(RTOS_SETTINGS_SECTION, {})}
            >
              Use the default
            </button>
          )}
        </div>
        {problem && (
          <p id='rtos-mode-problem' className='max-w-[360px] text-xs text-amber-600 dark:text-amber-400'>
            {chosen ? `Builds will fail: ${problem}` : `This project builds as a single scan loop: ${problem}`}
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}

export { RtosModeSwitch }
