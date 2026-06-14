/**
 * Catalog Browser — remote VPP discovery surface.
 *
 * Renders a single-pane scrollable list of remote packages fetched from the
 * OpenPLC CDN, modelled after the Arduino IDE Board Manager: a search bar at
 * the top, expandable cards per package, and a single action menu per entry
 * that handles install, update, version switch, uninstall, and editor-
 * compatibility blocking — all in one button-driven menu.
 *
 * Each card runs a small state machine on top of two signals:
 *   - the version (if any) of that package already installed on disk,
 *   - the newest version whose `minEditorVersion` is satisfied by the running
 *     editor (`APP_VERSION`).
 *
 * The action button's label is derived from those — Install / Installed /
 * Update / Editor outdated. The menu it opens carries the actual choices.
 *
 * The catalog data + install action both flow through `PackagePort`. Until
 * the CDN backend ships, the editor adapter returns a hardcoded mock catalog
 * and install resolves with a "backend not connected" error — the UI surface
 * is final, only the adapter changes when the backend lands.
 */

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { DownloadIcon } from '@root/frontend/assets/icons/interface/Download'
import { MagnifierIcon } from '@root/frontend/assets/icons/interface/Magnifier'
import { RefreshIcon } from '@root/frontend/assets/icons/interface/Refresh'
import { TrashCanIcon } from '@root/frontend/assets/icons/interface/TrashCan'
import { APP_VERSION } from '@root/frontend/data/constants/app-version'
import { useOpenPLCStore } from '@root/frontend/store'
import { compareSemver, isCompatibleEditorVersion } from '@root/frontend/utils/semver'
import type { RemoteCatalogEntry, RemoteVersionEntry } from '@root/middleware/shared/ports/types'
import { usePackages } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface CatalogBrowserProps {
  installedVersions: Map<string, string>
  /**
   * Fired whenever the on-disk inventory may have changed — covers both
   * install and uninstall outcomes. Name kept stable so the parent doesn't
   * need cascading edits; treat as "onInventoryChanged".
   */
  onInstalled: () => void
}

const CatalogBrowser = ({ installedVersions, onInstalled }: CatalogBrowserProps) => {
  const packages = usePackages()
  const openModal = useOpenPLCStore((s) => s.modalActions.openModal)

  const [entries, setEntries] = useState<RemoteCatalogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Single busy flag for both install and uninstall — they're mutually
  // exclusive per card and both warrant disabling the action menu.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const fetchCatalog = useCallback(async () => {
    if (!packages) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await packages.listRemoteCatalog()
      setEntries(result.entries)
      setFetchedAt(result.fetchedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch catalog')
    } finally {
      setIsLoading(false)
    }
  }, [packages])

  useEffect(() => {
    void fetchCatalog()
  }, [fetchCatalog])

  const filteredEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) => {
      const haystack = [entry.name, entry.packageId, entry.vendor.name, entry.description, ...(entry.tags ?? [])]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [entries, searchTerm])

  const handleInstall = useCallback(
    async (packageId: string, version: string, downloadUrl: string) => {
      if (!packages) return
      setBusyId(packageId)
      try {
        const result = await packages.installFromRemote(packageId, version, downloadUrl)
        if (result.success) {
          onInstalled()
        } else {
          openModal('debugger-message', {
            type: 'error',
            title: 'Install failed',
            message:
              result.error ?? 'Remote install failed. Try again, or use "Add from file..." with a downloaded .vpp.',
            buttons: ['OK'],
            onResponse: () => {},
          })
        }
      } finally {
        setBusyId(null)
      }
    },
    [packages, openModal, onInstalled],
  )

  const handleUninstall = useCallback(
    async (packageId: string) => {
      if (!packages) return
      setBusyId(packageId)
      try {
        const result = await packages.uninstall(packageId)
        if (result.success) {
          onInstalled()
        } else {
          openModal('debugger-message', {
            type: 'error',
            title: 'Uninstall failed',
            message: result.error ?? 'Could not uninstall the package.',
            buttons: ['OK'],
            onResponse: () => {},
          })
        }
      } finally {
        setBusyId(null)
      }
    },
    [packages, openModal, onInstalled],
  )

  if (!packages) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Package management is not available on this platform.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      {/* Search + refresh row */}
      <div className='flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800'>
        <div className='relative flex flex-1 items-center'>
          <MagnifierIcon
            size='sm'
            className='pointer-events-none absolute left-3 !stroke-neutral-500 dark:!stroke-neutral-400'
          />
          <input
            type='text'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder='Search packages by name, vendor, or tag...'
            className='w-full rounded-md border border-neutral-200 bg-white py-2 pl-10 pr-3 font-caption text-cp-sm text-neutral-950 placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:placeholder:text-neutral-500'
            aria-label='Search remote catalog'
          />
        </div>
        <button
          type='button'
          aria-label='Refresh catalog'
          onClick={() => void fetchCatalog()}
          disabled={isLoading}
          title='Refresh catalog'
          className='rounded-md p-2 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-900'
        >
          <RefreshIcon size='sm' className='!fill-brand' />
        </button>
      </div>

      {/* Catalog list */}
      <div className='flex-1 overflow-y-auto px-4 py-3'>
        {isLoading ? (
          <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
            Loading catalog...
          </div>
        ) : error ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 text-sm'>
            <span className='text-red-600 dark:text-red-400'>{error}</span>
            <button
              type='button'
              onClick={() => void fetchCatalog()}
              className='rounded-md border border-neutral-200 px-3 py-1.5 font-caption text-cp-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900'
            >
              Try again
            </button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
            {searchTerm ? `No packages matching "${searchTerm}"` : 'Catalog is empty.'}
          </div>
        ) : (
          <ul className='flex flex-col gap-2'>
            {filteredEntries.map((entry) => (
              <CatalogCard
                key={entry.packageId}
                entry={entry}
                isExpanded={expandedId === entry.packageId}
                installedVersion={installedVersions.get(entry.packageId) ?? null}
                isBusy={busyId === entry.packageId}
                onToggleExpand={() => setExpandedId((cur) => (cur === entry.packageId ? null : entry.packageId))}
                onInstall={(version, downloadUrl) => void handleInstall(entry.packageId, version, downloadUrl)}
                onUninstall={() => void handleUninstall(entry.packageId)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer: catalog freshness hint */}
      {fetchedAt && !isLoading && !error && (
        <div className='border-t border-neutral-200 px-4 py-2 text-[10px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500'>
          {filteredEntries.length} of {entries.length} package{entries.length === 1 ? '' : 's'} · catalog fetched{' '}
          {new Date(fetchedAt).toLocaleString()}
        </div>
      )}
    </div>
  )
}

interface CatalogCardProps {
  entry: RemoteCatalogEntry
  isExpanded: boolean
  installedVersion: string | null
  isBusy: boolean
  onToggleExpand: () => void
  onInstall: (version: string, downloadUrl: string) => void
  onUninstall: () => void
}

type TriggerKind = 'install' | 'installed' | 'update' | 'incompatible'

interface TriggerState {
  kind: TriggerKind
  label: string
  required?: string
}

function computeTriggerState(
  installedVersion: string | null,
  latestCompatible: RemoteVersionEntry | null,
): TriggerState {
  if (!latestCompatible) {
    return { kind: 'incompatible', label: 'Editor outdated' }
  }
  if (!installedVersion) {
    return { kind: 'install', label: 'Install' }
  }
  const cmp = compareSemver(latestCompatible.version, installedVersion)
  if (cmp > 0) return { kind: 'update', label: 'Update' }
  return { kind: 'installed', label: 'Installed' }
}

const CatalogCard = ({
  entry,
  isExpanded,
  installedVersion,
  isBusy,
  onToggleExpand,
  onInstall,
  onUninstall,
}: CatalogCardProps) => {
  const latestVersion = entry.versions[0]
  const latestCompatible =
    entry.versions.find((v) => isCompatibleEditorVersion(v.minEditorVersion, APP_VERSION)) ?? null

  // Reference version surfaced in the static pill next to the name — what
  // the user "has" right now (or would get by default if they hit Install).
  const referenceVersion = installedVersion ?? latestCompatible?.version ?? latestVersion.version

  const triggerState = computeTriggerState(installedVersion, latestCompatible)

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return
    onToggleExpand()
  }

  return (
    <li className='rounded-lg border border-neutral-200 bg-white transition-colors hover:border-brand-light dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-brand-medium'>
      <div
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleExpand()
          }
        }}
        className='flex w-full items-start gap-3 p-3 text-left'
      >
        <div className='flex flex-1 flex-col gap-1 overflow-hidden'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='truncate font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
              {entry.name}
            </span>
            <span className='bg-brand/10 dark:bg-brand/20 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-brand-medium dark:text-brand-light'>
              v{referenceVersion}
            </span>
          </div>

          <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
            by {entry.vendor.name} · {(latestCompatible ?? latestVersion).deviceCount} device
            {(latestCompatible ?? latestVersion).deviceCount === 1 ? '' : 's'}
          </span>

          <p className='line-clamp-2 font-caption text-[11px] text-neutral-600 dark:text-neutral-400'>
            {entry.description}
          </p>
        </div>

        <ActionMenuButton
          entry={entry}
          installedVersion={installedVersion}
          triggerState={triggerState}
          isBusy={isBusy}
          onInstall={onInstall}
          onUninstall={onUninstall}
        />
      </div>

      {isExpanded && (
        <div className='border-t border-neutral-100 px-3 pb-3 pt-2 dark:border-neutral-800'>
          <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
            <DetailRow label='Package ID' value={entry.packageId} />
            <DetailRow label='License' value={entry.license ?? '—'} />
            <DetailRow
              label='Latest version'
              value={`v${latestVersion.version}${latestVersion.minEditorVersion ? ` · requires editor ${latestVersion.minEditorVersion}+` : ''}`}
            />
            <DetailRow
              label='Latest published'
              value={latestVersion.publishedAt ? new Date(latestVersion.publishedAt).toLocaleDateString() : '—'}
            />
            {entry.vendor.url && <DetailRow label='Vendor' value={entry.vendor.url} />}
            {installedVersion && <DetailRow label='Currently installed' value={`v${installedVersion}`} />}
          </div>
        </div>
      )}
    </li>
  )
}

interface ActionMenuButtonProps {
  entry: RemoteCatalogEntry
  installedVersion: string | null
  triggerState: TriggerState
  isBusy: boolean
  onInstall: (version: string, downloadUrl: string) => void
  onUninstall: () => void
}

const ActionMenuButton = ({
  entry,
  installedVersion,
  triggerState,
  isBusy,
  onInstall,
  onUninstall,
}: ActionMenuButtonProps) => {
  const triggerStyleByKind: Record<TriggerKind, string> = {
    install: 'border border-brand bg-brand text-white hover:bg-brand-medium',
    update: 'border border-brand bg-brand text-white hover:bg-brand-medium',
    installed: 'border border-emerald-500/30 bg-transparent text-emerald-700 dark:text-emerald-400',
    incompatible:
      'border border-neutral-300 bg-transparent text-neutral-500 dark:border-neutral-700 dark:text-neutral-500',
  }

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild disabled={isBusy}>
          <button
            type='button'
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-caption text-[11px] font-medium transition-colors disabled:opacity-60 ${triggerStyleByKind[triggerState.kind]}`}
          >
            {(triggerState.kind === 'install' || triggerState.kind === 'update') && (
              <DownloadIcon size='sm' className='h-3.5 w-3.5' />
            )}
            <span>{isBusy ? 'Working...' : triggerState.label}</span>
            <ArrowIcon size='sm' direction='down' className='!stroke-current' />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={5}
            align='end'
            className='z-50 min-w-[220px] rounded-lg border border-neutral-100 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
          >
            <DropdownMenu.Label className='px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400'>
              Available versions
            </DropdownMenu.Label>
            {entry.versions.map((v) => {
              const compatible = isCompatibleEditorVersion(v.minEditorVersion, APP_VERSION)
              const isInstalledHere = installedVersion === v.version
              const itemLabel = labelForVersionItem(v.version, installedVersion, isInstalledHere)
              return (
                <DropdownMenu.Item
                  key={v.version}
                  disabled={!compatible || isInstalledHere}
                  onSelect={() => {
                    if (!compatible || isInstalledHere) return
                    onInstall(v.version, v.downloadUrl)
                  }}
                  className='flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-neutral-100 data-[disabled]:opacity-50 dark:data-[highlighted]:bg-neutral-850'
                >
                  <span className='font-caption text-[11px] font-medium text-neutral-900 dark:text-neutral-200'>
                    {isInstalledHere && '✓ '}
                    {itemLabel}
                  </span>
                  {!compatible && v.minEditorVersion && (
                    <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
                      requires editor {v.minEditorVersion}+
                    </span>
                  )}
                </DropdownMenu.Item>
              )
            })}
            {installedVersion !== null && (
              <>
                <DropdownMenu.Separator className='my-1 h-px bg-neutral-200 dark:bg-neutral-800' />
                <DropdownMenu.Item
                  onSelect={() => onUninstall()}
                  className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-caption text-[11px] font-medium text-red-600 outline-none data-[highlighted]:bg-red-50 dark:text-red-400 dark:data-[highlighted]:bg-red-950/30'
                >
                  <TrashCanIcon className='h-3.5 w-3.5 stroke-current' />
                  Uninstall
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function labelForVersionItem(
  versionInThisRow: string,
  installedVersion: string | null,
  isInstalledHere: boolean,
): string {
  if (isInstalledHere) return `v${versionInThisRow} (installed)`
  if (!installedVersion) return `Install v${versionInThisRow}`
  const cmp = compareSemver(versionInThisRow, installedVersion)
  if (cmp > 0) return `Update to v${versionInThisRow}`
  return `Switch to v${versionInThisRow}`
}

const DetailRow = ({ label, value }: { label: string; value: string }) => {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400'>
        {label}
      </span>
      <span className='break-words font-caption text-[11px] text-neutral-800 dark:text-neutral-300'>{value}</span>
    </div>
  )
}

export { CatalogBrowser }
