import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import type { DroppedAlias } from '@root/frontend/utils/vpp/allocate-module-slots'

function notifyDroppedAliases(dropped: DroppedAlias[]) {
  if (dropped.length === 0) return
  toast({
    title: 'Aliases removed',
    description: `The channels of ${dropped.map((d) => d.alias).join(', ')} no longer exist, so their aliases were removed.`,
    variant: 'warn',
  })
}

export { notifyDroppedAliases }
