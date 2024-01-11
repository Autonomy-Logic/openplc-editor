import { IpcRendererEvent, ipcRenderer } from 'electron'

// biome-ignore lint/suspicious/noExplicitAny: <This causes an error in Electron, must be reviewed>
type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

const rendererProcessBridge = {

	startCreateNewProject: () =>
		ipcRenderer.invoke('start-screen/project:create'),
	createProject: (callback: IpcRendererCallbacks) =>
		ipcRenderer.on('project:create', callback),
	openProject: (callback: IpcRendererCallbacks) =>
		ipcRenderer.on('project:open', callback),
	saveProject: (callback: IpcRendererCallbacks) =>
		ipcRenderer.on('project:save-request', callback),
	getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
	setStoreValue: (key: string, val: string) =>
		ipcRenderer.send('app:store-set', key, val),
	// WIP: Refactoring
	getTheme: () => ipcRenderer.invoke('app:get-theme'),
	// setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
	// createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
}
export default rendererProcessBridge
