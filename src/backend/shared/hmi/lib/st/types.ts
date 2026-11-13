/** StandardWidgets ST source: enumerations, the COLOR constant and color helpers. */
export const TYPES_ST = `(* Enumerations and colors of the HMI. Enumeration values match the C core (hmi_core.h). *)

TYPE HMI_ALIGN : (Left := 0, Center := 1, Right := 2); END_TYPE
TYPE HMI_VALIGN : (Top := 0, Middle := 1, Bottom := 2); END_TYPE
TYPE HMI_FONT : (Regular := 0, Bold := 1); END_TYPE
(* Connection ports of an element, and the direction a pipe leaves them. *)
TYPE HMI_PORT : (Top := 0, Right := 1, Bottom := 2, Left := 3); END_TYPE
(* Stack direction and widget orientation; Auto is a row when wider than tall, a column otherwise. *)
TYPE HMI_DIRECTION : (Row := 0, Column := 1, Auto := 2); END_TYPE

(* Semantic colors follow the screen's theme; fixed colors are the same on every theme. *)
TYPE HMI_COLORS :
  STRUCT
    Background, Surface, Text, TextMuted, Border, Fill, Accent, OnAccent, Success, Warning, Danger, Bar, OnBar : UDINT;
    Red, Green, Blue, Yellow, Orange, Gray, White, Black, Transparent : UDINT;
  END_STRUCT;
END_TYPE

VAR_GLOBAL CONSTANT
  COLOR : HMI_COLORS := (
    Background := 16#80000001, Surface := 16#80000002, Text := 16#80000003, TextMuted := 16#80000004,
    Border := 16#80000005, Fill := 16#80000006, Accent := 16#80000007, OnAccent := 16#80000008,
    Success := 16#80000009, Warning := 16#8000000A, Danger := 16#8000000B, Bar := 16#8000000C, OnBar := 16#8000000D,
    Red := 16#DC2626, Green := 16#16A34A, Blue := 16#2563EB, Yellow := 16#FACC15, Orange := 16#F97316,
    Gray := 16#9CA3AF, White := 16#FFFFFF, Black := 16#000000, Transparent := 16#64000000);
END_VAR

(* Color with an opacity in percent (100 = opaque), for fixed and theme colors alike. *)
FUNCTION HMI_Alpha : UDINT
  VAR_INPUT Color : UDINT; OpacityPct : DINT; END_VAR
  {external HMI_ALPHA_result.set(hmi_alpha((uint32_t)COLOR.get(), OPACITYPCT.get())); }
END_FUNCTION
`
