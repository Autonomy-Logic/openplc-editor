import { DownloadIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { useOpenPLCStore } from '@root/renderer/store'
// import { parseProjectToXML } from '@root/utils/PLC/base-xml'
import { v4 as uuidv4 } from 'uuid'

const DownloadButton = () => {
  const {
    project,
    consoleActions: { addLog },
  } = useOpenPLCStore()

  // !! Bad code!!
  // The functionality works visually, but the project is not being compiled.
  // We need to fix this.
  const buildST = async () => {
    const { error, message } = await window.bridge.compileSTProgram(project.meta.path)
    if (error) console.warn(error)
    console.log(message)
    addLog({ id: uuidv4(), type: message.type, message: message.content })
  }

  // const buttonClick = () => {
  //   // parseProjectToXML(project)
  //   void buildST()
  // }
  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <ActivityBarButton aria-label='Download' onClick={() => buildST()}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
