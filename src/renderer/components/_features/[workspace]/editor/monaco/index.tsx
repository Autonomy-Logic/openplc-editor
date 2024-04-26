import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'

const MonacoEditor = (): ReturnType<typeof PrimitiveEditor> => {
  const newLocal = `Lorem ipsum dolor sit amet, consectetur adipiscing elit\n
  Quisque commodo elit eget scelerisque laoreet.\n
  Curabitur id diam nec risus pharetra commodo.\n
  Cras volutpat ipsum eu vestibulum viverra.\n
  Praesent sollicitudin ligula quis erat auctor varius.\n
  Suspendisse ac est sit amet ligula lobortis vehicula eu vel nulla.\n
  Cras non odio porta dolor scelerisque faucibus quis eget mi.\n
  Etiam volutpat eros a est aliquam, sit amet eleifend lacus luctus.\n
  Nam a eros porttitor, pretium quam ac, fermentum enim.\n
  Mauris eu dui dictum, viverra ex vitae, elementum enim.\n
  Fusce non lorem eget dolor lobortis faucibus ac vel est.\n
  Integer ut velit sed metus bibendum aliquam tincidunt vitae elit.\n
  Donec at massa blandit, aliquet neque vel, scelerisque orci.\n
  Sed semper purus sit amet dignissim lacinia.\n
  Etiam pellentesque ipsum sed libero viverra efficitur.\n
  Proin quis ante cursus, consectetur velit et, ullamcorper augue.\n
  Sed et ligula in metus viverra consectetur.\n
  Nulla condimentum turpis in cursus elementum.\n
  Nunc vestibulum nisl eu nibh suscipit, et commodo sapien tempor.\n
  Duis sit amet sapien consectetur quam interdum scelerisque.\n
  Proin accumsan lacus non eros efficitur, vitae vulputate felis tempor.\n
  Donec in tellus convallis libero venenatis auctor et ornare libero.`

  const {
    editorState: { path },
    // workspaceState: {
    //   systemConfigs: { shouldUseDarkMode },
    // },
  } = useOpenPLCStore()
  return (
    <PrimitiveEditor
      height='100%'
      width='100%'
      path={path}
      language='st'
      defaultValue={newLocal}
      theme='openplc-light'
    />
  )
}
export { MonacoEditor }
