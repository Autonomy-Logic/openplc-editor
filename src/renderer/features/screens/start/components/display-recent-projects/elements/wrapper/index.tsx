import { HTMLAttributes, ReactNode } from 'react';

export type RecentWrapperProps = HTMLAttributes<HTMLDivElement>;

export default function Wrapper({ children }: RecentWrapperProps): ReactNode {
  return <section className='w-full h-screen relative'>{children}</section>;
}
