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
      <PlayButton />
      <DebuggerButton />
    </>
  )
}
