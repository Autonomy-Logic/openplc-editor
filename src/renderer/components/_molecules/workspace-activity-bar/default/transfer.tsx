import { TransferIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { useOpenPLCStore } from '@root/renderer/store'
// import { startParseXML } from '@root/utils/PLC/base-xml'
import { nodesToXML } from '@root/utils/PLC/ladder-xml'

export const TransferButton = () => {
  const {
    editor: {
      meta: { name },
    },
    flows,
  } = useOpenPLCStore()

  const buttonClick = () => {
    const rungs = flows.find((flow) => flow.name === name)?.rungs
    if (!rungs) return
    nodesToXML(rungs)
    // startParseXML()
  }

  return (
    <ActivityBarButton aria-label='Transfer' onClick={buttonClick}>
      <TransferIcon />
    </ActivityBarButton>
  )
}
