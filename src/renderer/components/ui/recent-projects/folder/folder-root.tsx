/* eslint-disable @typescript-eslint/no-explicit-any */
import { JSXElementConstructor, ReactElement, ReactNode, ReactPortal } from 'react';

export default function Root(
  children:
    | string
    | number
    | boolean
    | ReactElement<any, string | JSXElementConstructor<any>>
    | Iterable<ReactNode>
    | ReactPortal
    | Iterable<ReactNode>
    | null
    | undefined
) {
  return <div className='folder-wrapper'>{children}</div>;
}
