import {DownloadIcon} from '@root/renderer/assets'
import {ActivityBarButton} from '@root/renderer/components/_atoms/buttons'
import {useOpenPLCStore} from '@root/renderer/store'
import {useEffect} from "react";
// import { parseProjectToXML } from '@root/utils/PLC/base-xml'
import {v4 as uuidv4} from 'uuid'

const DownloadButton = () => {
    const {
        project,
        consoleActions: {addLog},
    } = useOpenPLCStore()

    // !! Bad code!!
    // The functionality works visually, but the project is not being compiled.
    // We need to fix this.
    // const buildST = async () => {
    //   const { error, message } = await window.bridge.compileSTProgram(project.meta.path)
    //   if (error) console.warn(error)
    //   console.log(message)
    //   addLog({ id: uuidv4(), type: message.type, message: message.content.toString() })
    // }

    useEffect(() => {
        window.bridge.listenToCompiler((event) => {
            const [port] = event.ports
            port.onmessage = (ev) => {
                const {type, data, code} = ev.data
                if (type === 'stdout') {
                    addLog({id: uuidv4(), type: 'info', message: data as string})
                } else if (type === 'stderr') {
                    addLog({id: uuidv4(), type: 'error', message: data as string})
                } else if (type === 'close') {
                    if (code === 0) {
                        addLog({id: uuidv4(), type: 'warning', message: 'Compilation successful!'})
                    } else {
                        addLog({id: uuidv4(), type: 'error', message: 'Compilation failed!'})
                    }
                }
            }
        })
    }, []);

    const buildProgram = () => window.bridge.retrieveXMLPathToCompiler(project.meta.path)

    // const buttonClick = () => {
    //   // parseProjectToXML(project)
    //   void buildST()
    // }
    return (
        <ActivityBarButton aria-label='Download' onClick={buildProgram}>
            <DownloadIcon/>
        </ActivityBarButton>
    )
}

export {DownloadButton}
