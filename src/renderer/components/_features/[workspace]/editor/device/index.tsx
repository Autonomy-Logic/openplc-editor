import { ComponentPropsWithoutRef } from 'react'

import { DeviceConfigurationEditor } from './configuration'

type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  editorDerivation: 'Configuration'
}

const DeviceEditor = ({ editorDerivation }: DeviceEditorProps) => {
  return <>{editorDerivation === 'Configuration' && <DeviceConfigurationEditor />}</>
}

export { DeviceEditor }
