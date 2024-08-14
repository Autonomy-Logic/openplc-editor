import {
  DebuggerButton,
  DownloadButton,
  PlayButton,
  SearchButton,
  TransferButton,
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
      <TransferButton />
      <PlayButton />
      <DebuggerButton />
    </>
  )
}
