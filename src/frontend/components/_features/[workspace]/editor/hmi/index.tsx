/** The HMI tabs: screens open in the designer, widget blocks in their code with a preview, and HMI Settings. */
import { HmiCodeEditor } from './code-editor'
import { HmiScreenDesigner, HmiWidgetEditor } from './designer/hmi-designer'

/** HMI Settings; its editor arrives with the designer. */
const HmiSettingsEditor = () => (
  <div
    className='flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center'
    data-testid='hmi-settings-placeholder'
  >
    <p className='font-caption text-sm font-medium text-neutral-950 dark:text-white'>HMI Settings</p>
    <p className='max-w-md font-caption text-xs text-neutral-600 dark:text-neutral-400'>
      The editor for the start screen, frame period, role grid, panel PIN and themes is coming. The settings are kept in
      hmi/settings.json and saved with the project.
    </p>
  </div>
)

export { HmiCodeEditor, HmiScreenDesigner, HmiSettingsEditor, HmiWidgetEditor }
