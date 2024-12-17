import { cn } from '@root/utils'

import {
  DebuggerButton,
  DownloadButton,
  PlayButton,
  SearchButton,
  ZoomButton,
} from '../../_molecules/workspace-activity-bar/default'

type DefaultWorkspaceActivityBarProps = {
  zoom?: {
    onClick: () => void
  }
}

export const DefaultWorkspaceActivityBar = ({ zoom }: DefaultWorkspaceActivityBarProps) => {
  return (
    <>
      <SearchButton />
      <ZoomButton {...zoom} />
      <DownloadButton />
      {/** TODO: Need to be implemented */}
      <PlayButton className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')} />
      {/** TODO: Need to be implemented */}
      <DebuggerButton className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')} />
    </>
  )
}
