// import { useOpenPLCStore } from '@root/renderer/store'
import { useCompiler } from '@root/renderer/hooks'
import { useEffect } from 'react'
// import { v4 as uuidv4 } from 'uuid'

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  /**
   * Compiler Related Accelerators
   */
  useEffect(() => {
    window.bridge.exportProjectRequest(() => {
      void handleExportProject()
    })
    return () => {
      window.bridge.removeExportProjectListener()
    }
  }, [])
  return <></>
}
export { AcceleratorHandler }
