import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { cn } from '@root/frontend/utils/cn'
import type { ESIModuleSummary, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { useCallback, useMemo, useState } from 'react'

type ModuleBrowserModalProps = {
  isOpen: boolean
  onClose: () => void
  /**
   * Called with the picked module + its repository item. The caller is responsible for
   * assigning a slot (typically the next free one on the coupler).
   */
  onSelectModule: (module: ESIModuleSummary, repoItem: ESIRepositoryItemLight) => void
  repository: ESIRepositoryItemLight[]
}

/**
 * DOPE-704 E6 UI: module-side counterpart of DeviceBrowserModal. Lists all modules the
 * repository knows about (inline modules on modular coupler ESIs, plus standalone
 * module ESIs), grouped by vendor.
 */
const ModuleBrowserModal = ({ isOpen, onClose, onSelectModule, repository }: ModuleBrowserModalProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedKey, setSelectedKey] = useState<{ repoItemId: string; ident: string } | null>(null)
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())

  const groupedModules = useMemo(() => {
    const groups: Map<
      string,
      {
        vendorId: string
        vendorName: string
        modules: Array<{
          repoItem: ESIRepositoryItemLight
          module: ESIModuleSummary
        }>
      }
    > = new Map()

    for (const repoItem of repository) {
      if (!repoItem.modules || repoItem.modules.length === 0) continue
      const vendorKey = repoItem.vendor.id
      if (!groups.has(vendorKey)) {
        groups.set(vendorKey, {
          vendorId: repoItem.vendor.id,
          vendorName: repoItem.vendor.name,
          modules: [],
        })
      }

      for (const module of repoItem.modules) {
        if (searchTerm) {
          const search = searchTerm.toLowerCase()
          const matches =
            module.name.toLowerCase().includes(search) ||
            module.ident.toLowerCase().includes(search) ||
            repoItem.vendor.name.toLowerCase().includes(search)
          if (!matches) continue
        }
        groups.get(vendorKey)!.modules.push({ repoItem, module })
      }
    }

    for (const [key, group] of groups) {
      if (group.modules.length === 0) groups.delete(key)
    }

    return Array.from(groups.values())
  }, [repository, searchTerm])

  const handleToggleVendor = useCallback((vendorId: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev)
      if (next.has(vendorId)) next.delete(vendorId)
      else next.add(vendorId)
      return next
    })
  }, [])

  const handleSelect = useCallback((repoItemId: string, ident: string) => {
    setSelectedKey({ repoItemId, ident })
  }, [])

  const handleConfirm = useCallback(() => {
    if (!selectedKey) return
    const repoItem = repository.find((r) => r.id === selectedKey.repoItemId)
    if (!repoItem) return
    const module = repoItem.modules?.find((m) => m.ident === selectedKey.ident)
    if (!module) return
    onSelectModule(module, repoItem)
    setSelectedKey(null)
    setSearchTerm('')
    onClose()
  }, [selectedKey, repository, onSelectModule, onClose])

  const handleClose = useCallback(() => {
    setSelectedKey(null)
    setSearchTerm('')
    onClose()
  }, [onClose])

  const effectiveExpandedVendors = useMemo(() => {
    if (searchTerm) return new Set(groupedModules.map((g) => g.vendorId))
    return expandedVendors
  }, [searchTerm, groupedModules, expandedVendors])

  const totalModules = groupedModules.reduce((sum, g) => sum + g.modules.length, 0)

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <ModalContent className='h-[600px] w-[600px]' onClose={handleClose}>
        <ModalHeader>
          <ModalTitle>Add Module from Repository</ModalTitle>
        </ModalHeader>

        <div className='mb-2'>
          <input
            type='text'
            placeholder='Search modules by name, ident, or vendor...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-[34px] w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
          />
        </div>

        <div className='mb-2 text-xs text-neutral-500 dark:text-neutral-400'>
          {totalModules} module(s) in {groupedModules.length} vendor(s)
        </div>

        <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
          {groupedModules.length === 0 ? (
            <div className='flex h-full items-center justify-center p-4'>
              <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                {repository.length === 0
                  ? 'No ESI files loaded. Upload files in the Repository tab first.'
                  : 'No modules match your search.'}
              </p>
            </div>
          ) : (
            <div className='divide-y divide-neutral-200 dark:divide-neutral-800'>
              {groupedModules.map((group) => (
                <div key={group.vendorId}>
                  <button
                    onClick={() => handleToggleVendor(group.vendorId)}
                    className='flex w-full items-center gap-2 bg-neutral-100 px-3 py-2 text-left hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800'
                  >
                    <svg
                      className={cn(
                        'h-3 w-3 text-neutral-500 transition-transform',
                        effectiveExpandedVendors.has(group.vendorId) && 'rotate-90',
                      )}
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                    </svg>
                    <span className='text-sm font-medium text-neutral-700 dark:text-neutral-300'>
                      {group.vendorName}
                    </span>
                    <span className='font-mono text-xs text-neutral-500'>({group.vendorId})</span>
                    <span className='ml-auto text-xs text-neutral-500'>{group.modules.length} module(s)</span>
                  </button>

                  {effectiveExpandedVendors.has(group.vendorId) && (
                    <div className='divide-y divide-neutral-100 dark:divide-neutral-900'>
                      {group.modules.map(({ repoItem, module }) => {
                        const isSelected =
                          selectedKey?.repoItemId === repoItem.id && selectedKey?.ident === module.ident
                        return (
                          <button
                            type='button'
                            key={`${repoItem.id}-${module.ident}`}
                            onClick={() => handleSelect(repoItem.id, module.ident)}
                            aria-pressed={isSelected}
                            className={cn(
                              'flex w-full cursor-pointer items-center gap-3 px-3 py-2 pl-8 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                              isSelected && 'bg-brand/10 dark:bg-brand/20',
                            )}
                          >
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate text-sm font-medium text-neutral-900 dark:text-neutral-100'>
                                  {module.name}
                                </span>
                                {module.moduleClass && (
                                  <span className='flex-shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'>
                                    {module.moduleClass}
                                  </span>
                                )}
                              </div>
                              <div className='flex gap-3 text-xs text-neutral-500 dark:text-neutral-400'>
                                <span className='font-mono'>{module.ident}</span>
                                <span className='truncate'>from {repoItem.filename}</span>
                              </div>
                            </div>
                            {isSelected && (
                              <svg
                                className='h-4 w-4 flex-shrink-0 text-brand'
                                fill='none'
                                viewBox='0 0 24 24'
                                stroke='currentColor'
                              >
                                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <ModalFooter className='flex justify-end gap-2 pt-3'>
          <button
            onClick={handleClose}
            className='rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedKey}
            className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            Add Module
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export { ModuleBrowserModal }
