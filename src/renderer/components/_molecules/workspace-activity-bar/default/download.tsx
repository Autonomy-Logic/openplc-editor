import {DownloadIcon} from '@root/renderer/assets'
import {ActivityBarButton} from '@root/renderer/components/_atoms/buttons'
import {useOpenPLCStore} from '@root/renderer/store'
import {BufferToStringArray} from "@root/utils";
import {v4 as uuidv4} from 'uuid'
type CompileResponseObject = {
    type: 'info' | 'warning' | 'error',
    data?: Buffer
    message?: string
}

const DownloadButton = () => {
    const {
        project,
        consoleActions: {addLog},
    } = useOpenPLCStore()

    const buildProgram = () => window.bridge.compileRequest(project.meta.path, (compileResponse: CompileResponseObject) => {
        const {type: stdType, data, message: stdMessage} = compileResponse
        const uint8Array = data
        if (!uint8Array) return
        const lines = BufferToStringArray(uint8Array)
        lines.forEach((line) => {
            addLog({id: uuidv4(), type: stdType, message: line})
        })
        stdMessage && addLog({id: uuidv4(), type: stdType, message: stdMessage})
    })

    const requestBuildProgram = async () => {
        addLog({id: uuidv4(), type: 'info', message: 'Build process started'})
        addLog({id: uuidv4(), type: 'warning', message: 'Verifying if build directory exist'})
        const { success, message: logMessage } = await window.bridge.createBuildDirectory(project.meta.path)
        if (success) {
            addLog({id: uuidv4(), type: 'info', message: logMessage})
            addLog({id: uuidv4(), type: 'warning', message: 'Attempting to generate the xml file'})
            const result = await window.bridge.createXmlFileToBuild(project.meta.buildPath, project.data)
            if (result.success) {
                addLog({id: uuidv4(), type: 'info', message: result.message})
                addLog({id: uuidv4(), type: 'warning', message: 'Attempting to build the program'})
                buildProgram()
            } else {
                addLog({id: uuidv4(), type: 'error', message: result.message})
            }
        } else {
            addLog({id: uuidv4(), type: 'error', message: logMessage})
        }
    }

    return (
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        <ActivityBarButton aria-label='Download' onClick={requestBuildProgram}>
            <DownloadIcon/>
        </ActivityBarButton>
    )
}

export {DownloadButton}
