import {
  existsSync,
  mkdirSync,
  readFileSync,
  watchFile,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { app, ipcMain } from 'electron'

import { mainWindow } from '../main/index'

class UserConfigIpc {
  userDataPath: string
  workspacePath: string
  workspaceFile: string
  workspaceStorage: { folder: string }
  constructor() {
    this.userDataPath = app.getPath('userData')
    this.workspacePath = join(this.userDataPath, '/User/workspaceStorage')
    this.workspaceFile = join(this.workspacePath, 'workspace.json')
    this.workspaceStorage = { folder: '' }
  }

  setInitialWorkspaceConfigs = () => {
    // Function to ensure the config path and files exists.
    const ensureWorkspaceFileExists = () => {
      try {
        // Create the user data folder if it doesn't exist
        if (!existsSync(this.userDataPath)) {
          mkdirSync(this.userDataPath, { recursive: true })
        }
        // Create the workspace data folder if it doesn't exist
        if (!existsSync(this.workspacePath)) {
          mkdirSync(this.workspacePath, { recursive: true })
        }
        // Create the workspace file if it doesn't exist
        if (!existsSync(this.workspaceFile)) {
          writeFileSync(
            this.workspaceFile,
            JSON.stringify(this.workspaceStorage, null, 2),
            'utf-8',
          )
        }
      } catch (error) {
        // Handle any errors that may occur during file/folder creation
        console.error('Error creating config file:', error)
      }
    }
    // Try to load the workspace configs into memory.
    try {
      const data = readFileSync(this.workspaceFile, 'utf-8')
      this.workspaceStorage = JSON.parse(data)
    } catch (error) {
      // If the file doesn't exist or is corrupted, use default settings
      this.workspaceStorage = {
        folder: '',
      }
      ensureWorkspaceFileExists()
    }
  }

  // Function to setup user configurations.
  setWorkspaceInfos = (workspaceData: { folder: string }) => {
    writeFileSync(
      this.workspaceFile,
      JSON.stringify(workspaceData, null, 2),
      'utf-8',
    )
  }

  // Data retrieval function from user setups.
  getWorkspaceInfos = () => {
    return this.workspaceStorage
  }

  // Function to watch changes in workspace file.
  watchWorkspaceChanges = () => {
    // Watch for changes in the workspace file
    watchFile(this.workspaceFile, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        // The file has changed; you can now react to the changes
        console.log('Workspace file changed. Reloading...')
        try {
          const data = readFileSync(this.workspaceFile, 'utf-8')
          this.workspaceStorage = JSON.parse(data)
          // Send a message to the renderer process
          mainWindow?.webContents.send(
            'info:workspace-updated',
            this.workspaceStorage,
          )
        } catch (error) {
          console.error('Error reloading workspace file:', error)
        }
      }
    })
  }
}
const userConfigIpc = new UserConfigIpc()
export default userConfigIpc
