import { HTMLAttributes } from 'react';

type ExamplesContainerProps = HTMLAttributes<HTMLElement> & unknown;
export default function Container(props: ExamplesContainerProps) {
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
