import { HTMLAttributes, ReactNode } from 'react';

export type ExampleWrapperProps = HTMLAttributes<HTMLElement> & unknown;

export default function Wrapper(props: ExampleWrapperProps): ReactNode {
  const { ...restProps } = props;
  return (
    <section className='flex pr-9 flex-col w-full bg-none mb-8 4xl:pr-0' {...restProps}>
      {/**
       * Header component
       * Viewport component
       */}
    </section>
  );
}

export type ExampleWrapper = typeof Wrapper;
