import { HTMLAttributes, ReactNode } from 'react';

export type ExampleWrapperProps = HTMLAttributes<HTMLElement> & unknown;

export default function Wrapper(props: ExampleWrapperProps): ReactNode {
  const { ...restProps } = props;
  return (
    <section className='flex flex-col w-full max-w-4xl bg-none' {...restProps}>
      {/**
       * Header component
       * Viewport component
       */}
    </section>
  );
}

export type ExampleWrapper = typeof Wrapper;
