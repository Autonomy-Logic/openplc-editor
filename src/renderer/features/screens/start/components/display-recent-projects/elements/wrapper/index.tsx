import { HTMLAttributes, ReactNode } from "react";

export type RecentWrapperProps = HTMLAttributes<HTMLDivElement>;

export default function Wrapper({ children }: RecentWrapperProps): ReactNode {
  return (
    <section className="w-full h-3/5 flex flex-col 3xl:h-3/4 4xl:h-4/5 pr-9 4xl:pr-0">
      {children}
    </section>
  );
}
