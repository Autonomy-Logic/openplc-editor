import type { ModuleDefinition } from '../index'

function slotRowClassName(isSelected: boolean): string {
  return `flex shrink-0 items-stretch border-b border-neutral-100 dark:border-neutral-800 ${
    isSelected
      ? 'bg-brand/20 dark:bg-brand/30 shadow-[inset_3px_0_0_var(--primary-default)]'
      : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
  }`
}

function moduleIoSummary(module: ModuleDefinition | undefined): string {
  if (!module) return ''
  const parts: string[] = []
  if (module.io.digitalInputs) parts.push(`${module.io.digitalInputs}DI`)
  if (module.io.digitalOutputs) parts.push(`${module.io.digitalOutputs}DO`)
  if (module.io.analogInputs) parts.push(`${module.io.analogInputs}AI`)
  if (module.io.analogOutputs) parts.push(`${module.io.analogOutputs}AO`)
  return parts.join(' / ')
}

export { moduleIoSummary, slotRowClassName }
