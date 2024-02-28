import React from "react";

export default function VariableCode() {
  const textDefault = "text-neutral-700 font-medium text-xs";
  return (
    <div>
      <h1 className="text-brand-dark font-medium text-xs">PROGRAM Blink</h1>
      <h2 className={textDefault}>VAR</h2>
      <p className={textDefault}>blink_led : BOOL;</p>
      <p className={textDefault}>TON0: TON;</p>
      <p className={textDefault}>TOF0: TOF;</p>
      <p className={textDefault}>END_VAR</p>
    </div>
  );
}
