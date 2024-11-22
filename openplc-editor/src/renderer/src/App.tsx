function App(): JSX.Element {
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return <div> Here will be our start point</div>
}

export default App
