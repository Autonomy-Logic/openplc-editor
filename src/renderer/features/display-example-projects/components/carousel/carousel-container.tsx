import { HTMLAttributes, ReactNode } from 'react';

type EmblaViewportRefType = <ViewportElement extends HTMLElement>(
  instance: ViewportElement | null
) => void;
type CarouselContainerProps = HTMLAttributes<HTMLDivElement> & {
  refProvider: EmblaViewportRefType;
};

export default function Container(props: CarouselContainerProps): ReactNode {
  const { refProvider, ...restProps } = props;
  return <div ref={refProvider} {...restProps} />;
}
