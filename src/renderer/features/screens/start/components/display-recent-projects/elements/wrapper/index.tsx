import { HTMLAttributes, ReactNode } from 'react';

export type RecentWrapperProps = HTMLAttributes<HTMLDivElement>;

export default function Wrapper({ children }: RecentWrapperProps): ReactNode {
  return <section className='w-full max-w-[968px] h-screen relative'>{children}</section>;
}
