import { HTMLAttributes, ReactNode } from "react";

export type StartScreenLayoutProps = HTMLAttributes<HTMLDivElement>;

export default function Container(props: StartScreenLayoutProps): ReactNode {
  //pl-[92px] pr-[70px]
  return <main className="w-full h-screen flex pl-16 py-4 pr-14 " {...props} />;
}
