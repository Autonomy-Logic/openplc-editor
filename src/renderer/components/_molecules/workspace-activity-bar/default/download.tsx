import {DownloadIcon} from '@root/renderer/assets'
import {ActivityBarButton} from '@root/renderer/components/_atoms/buttons'
import {useOpenPLCStore} from '@root/renderer/store'
import {BufferToStringArray} from "@root/utils";
import {v4 as uuidv4} from 'uuid'
type CompileResponseObject = {
    type: 'info' | 'warning' | 'error',
    data?: Buffer
    code: number
}

const DownloadButton = () => {
    const {
        project,
        consoleActions: {addLog},
    } = useOpenPLCStore()

    const buildProgram = () => window.bridge.compileRequest(project.meta.path, (compileResponse: CompileResponseObject) => {
        const {type: stdType, data, code} = compileResponse
        const uint8Array = data
        if (!uint8Array) {
            addLog({id: uuidv4(), type: 'info', message: `Script exited with code ${code}`})
            return
        }
        const lines = BufferToStringArray(uint8Array)
        lines.forEach((line) => {
            addLog({id: uuidv4(), type: stdType, message: line})
        })
        addLog({id: uuidv4(), type: 'info', message: `Script exited with code ${code}`})
    })

    return (
        <ActivityBarButton aria-label='Download' onClick={buildProgram}>
            <DownloadIcon/>
        </ActivityBarButton>
    )
}

export {DownloadButton}
