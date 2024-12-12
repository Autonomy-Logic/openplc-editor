// import { AppLayout } from '@components/_templates'
// import { ComponentPropsWithoutRef, ReactNode } from 'react'
// import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom'

// import { Modal, ModalContent, ModalHeader, ModalTitle, ModalTrigger } from '../components/_molecules'
// // import { VariablesTable } from '../components/_molecules'
// import { StartScreen, WorkspaceScreen } from '../screens'

// const _TestLayout = (props: ComponentPropsWithoutRef<'div'>) => {
//   return (
//     <div {...props} className='align-center mx-auto flex h-full w-full justify-center'>
//       <Modal>
//         <ModalTrigger>Open</ModalTrigger>
//         <ModalContent>
//           <ModalHeader>
//             <ModalTitle>Test</ModalTitle>
//           </ModalHeader>
//           <p>Test</p>
//         </ModalContent>
//       </Modal>
//     </div>
//   )
// }

// const router = createBrowserRouter([
//   {
//     id: 'root',
//     path: '/',
//     element: <AppLayout />,
//     children: [
//       {
//         index: true,
//         element: <StartScreen />,
//       },
//       {
//         id: 'workspace',
//         path: 'workspace',
//         element: <WorkspaceScreen />,
//       },
//     ],
//   },
// ])
// export default function RouterProvider(): ReactNode {
//   return <ReactRouterProvider router={router} />
// }
