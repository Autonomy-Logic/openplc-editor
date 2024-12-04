import type {IpcMainEvent} from 'electron'
import {ipcMain} from "electron";

import {CompilerService} from '../../../services'

const registerBroadcasts = () => {
    // Register compiler port
    ipcMain.on('compiler:compile-request', (event: IpcMainEvent, message: string) => {
        const [replyPort] = event.ports

        CompilerService.compileSTProgram(message)
    })
}

export {registerBroadcasts}
