import { HTMLAttributes } from 'react';

type ExamplesWrapperProps = HTMLAttributes<HTMLElement> & unknown;
export default function Wrapper(props: ExamplesWrapperProps) {
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
