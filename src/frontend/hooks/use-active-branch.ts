import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'openplc:active-branches'

type BranchMap = Record<string, string> // projectId -> branchName

function getBranchMap(): BranchMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BranchMap) : {}
  } catch {
    return {}
  }
}

function setBranchMap(map: BranchMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  // Notify same-window subscribers (other components in this tab using
  // useActiveBranch). Cross-tab sync is handled by the native `storage`
  // event in `subscribe`, which fires on tabs other than the writer.
  window.dispatchEvent(new Event('active-branch-change'))
}

function subscribe(listener: () => void): () => void {
  const handleChange = () => listener()
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('active-branch-change', handleChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener('active-branch-change', handleChange)
    window.removeEventListener('storage', handleStorage)
  }
}

/**
 * Hook that manages the active branch per project, persisted in localStorage.
 * Returns [branchName, setBranch] — defaults to the provided defaultBranch (or "main") if nothing is stored.
 */
export function useActiveBranch(
  projectId: string | null | undefined,
  defaultBranch = 'main',
): [string, (branch: string) => void] {
  const branchName = useSyncExternalStore(
    subscribe,
    () => {
      if (!projectId) return defaultBranch
      return getBranchMap()[projectId] ?? defaultBranch
    },
    () => defaultBranch,
  )

  const setBranch = useCallback(
    (branch: string) => {
      if (!projectId) return
      const map = getBranchMap()
      map[projectId] = branch
      setBranchMap(map)
    },
    [projectId],
  )

  return [branchName, setBranch]
}

/**
 * Utility to get the active branch for a project outside of React components.
 */
export function getActiveBranch(projectId: string, defaultBranch = 'main'): string {
  return getBranchMap()[projectId] ?? defaultBranch
}
