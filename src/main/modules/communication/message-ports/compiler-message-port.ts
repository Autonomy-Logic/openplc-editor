/**
 * First channel message example, using for compiler/console integration.
 */
import {ipcRenderer} from "electron";

const makeCompileRequest = (pathToXMLFile: string, callback: (...args: any) => void) => {
    // Create new channel for compile communication
    const {port1, port2} = new MessageChannel()

    // Send the data for the main process
    ipcRenderer.postMessage('compiler:compile-request', pathToXMLFile, [port2])

    // ...
    port1.onmessage = (event) => callback(event.data)

    // Extend the dom interface to listen to the 'close' event.
    port1.addEventListener('close', () => console.log('Stream ended'))
}

export {makeCompileRequest}
