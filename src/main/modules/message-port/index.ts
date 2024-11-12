import {ipcMain, ipcRenderer} from "electron";

const makeBuildRequest = (element: any, callback: (...args: any) => unknown) => {
    const { port1, port2 } = new MessageChannel()
    ipcRenderer.postMessage(
        'compile:make-build-request',
        element,
        [port2]
    )

    port1.onmessage = (e: MessageEvent) => {
        callback(e.data)
    }

    port1.close = () => {
        console.log('Build ended')
    }
}


ipcMain.on('')

