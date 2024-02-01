import { HTMLAttributes, ReactNode } from 'react';

type EmblaViewportRefType = <ViewportElement extends HTMLElement>(
  instance: ViewportElement | null
) => void;
export type ExampleCarouselContainerProps = HTMLAttributes<HTMLDivElement> & {
  refProvider: EmblaViewportRefType;
};

export default function Container(props: ExampleCarouselContainerProps): ReactNode {
  const { refProvider, ...restProps } = props;
  return <div className='overflow-hidden w-full ' ref={refProvider} {...restProps} />;
}

export type ExampleCarouselContainer = typeof Container;
