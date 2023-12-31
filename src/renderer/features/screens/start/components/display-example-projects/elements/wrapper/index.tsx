import { HTMLAttributes, ReactNode } from 'react';

export type ExampleWrapperProps = HTMLAttributes<HTMLElement> & unknown;

export default function Wrapper(props: ExampleWrapperProps): ReactNode {
  const { ...restProps } = props;
  return (
    <section className='flex flex-col w-full max-w-[968px] bg-none mb-8' {...restProps}>
      {/**
       * Header component
       * Viewport component
       */}
    </section>
  );
}

export type ExampleWrapper = typeof Wrapper;
