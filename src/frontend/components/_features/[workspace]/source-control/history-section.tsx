import { useEffect, useState } from 'react'

import type { Commit } from '../../../../../middleware/shared/ports/version-control-port'
import { useVersionControl } from '../../../../../middleware/shared/providers'
import { useActiveBranch } from '../../../../hooks/use-active-branch'
import { CommitDetails } from './commit-details'
import { CommitItem } from './commit-item'

const PAGE_SIZE = 50

type HistorySectionProps = {
  projectId: string
}

export function HistorySection({ projectId }: HistorySectionProps) {
  const versionControl = useVersionControl()
  const [activeBranchName] = useActiveBranch(projectId)
  const [commits, setCommits] = useState<Commit[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

  // Reset pagination when the active branch changes
  useEffect(() => {
    setOffset(0)
    setSelectedHash(null)
  }, [activeBranchName])

  useEffect(() => {
    if (!versionControl) return

    const loading = offset === 0
    if (loading) setIsLoading(true)
    setIsFetching(true)

    versionControl
      .listCommits(projectId, { limit: PAGE_SIZE, offset, branch: activeBranchName })
      .then((data) => {
        setCommits(data.commits)
        setTotal(data.total)
      })
      .catch(() => {
        setCommits([])
        setTotal(0)
      })
      .finally(() => {
        setIsLoading(false)
        setIsFetching(false)
      })
  }, [projectId, offset, versionControl, activeBranchName])

  const hasMore = offset + PAGE_SIZE < total

  const handleSelectCommit = (commit: Commit) => {
    setSelectedHash(selectedHash === commit.hash ? null : commit.hash)
  }

  if (isLoading) {
    return (
      <div className='space-y-2 p-3'>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className='h-10 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800' />
        ))}
      </div>
    )
  }

  if (commits.length === 0 && offset === 0) {
    return <p className='px-3 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400'>No commits yet</p>
  }

  return (
    <div className='flex min-h-0 flex-col overflow-y-auto'>
      <ul className='space-y-0.5 px-2 py-2'>
        {commits.map((commit) => (
          <li key={commit.hash}>
            <CommitItem
              commit={commit}
              isSelected={selectedHash === commit.hash}
              onClick={() => handleSelectCommit(commit)}
            />
            {selectedHash === commit.hash && <CommitDetails commit={commit} projectId={projectId} />}
          </li>
        ))}
      </ul>

      {/* Pagination */}
      <div className='flex shrink-0 items-center justify-between border-t border-neutral-200 px-3 py-2 dark:border-neutral-700'>
        <span className='text-xs text-neutral-400 dark:text-neutral-500'>
          {offset + 1}&ndash;{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <div className='flex gap-1'>
          <button
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0 || isFetching}
            className='rounded px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            Prev
          </button>
          <button
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={!hasMore || isFetching}
            className='rounded px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
