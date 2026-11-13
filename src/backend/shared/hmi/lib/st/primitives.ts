/** StandardWidgets ST source: the public drawing, text, input and value primitives over the C core. */
export const PRIMITIVES_ST = `(* Primitives: ST wrappers over the C core (hmi_core.h). Geometry is whole logical units (DINT) and angles whole
   degrees, clockwise from 3 o'clock. Each returns TRUE and is called as a statement. *)

FUNCTION HMI_Clear : BOOL
  VAR_INPUT Color : UDINT; END_VAR
  {external hmi_clear((uint32_t)COLOR.get()); }
  HMI_Clear := TRUE;
END_FUNCTION

FUNCTION HMI_FillRect : BOOL
  VAR_INPUT X, Y, W, H, Radius : DINT; Color : UDINT; END_VAR
  {external hmi_fill_rect(X.get(), Y.get(), W.get(), H.get(), RADIUS.get(), (uint32_t)COLOR.get()); }
  HMI_FillRect := TRUE;
END_FUNCTION

FUNCTION HMI_StrokeRect : BOOL
  VAR_INPUT X, Y, W, H, Radius, Width : DINT; Color : UDINT; END_VAR
  {external hmi_stroke_rect(X.get(), Y.get(), W.get(), H.get(), RADIUS.get(), WIDTH.get(), (uint32_t)COLOR.get()); }
  HMI_StrokeRect := TRUE;
END_FUNCTION

FUNCTION HMI_Line : BOOL
  VAR_INPUT X1, Y1, X2, Y2, Width : DINT; Color : UDINT; END_VAR
  {external hmi_line(X1.get(), Y1.get(), X2.get(), Y2.get(), WIDTH.get(), (uint32_t)COLOR.get()); }
  HMI_Line := TRUE;
END_FUNCTION

FUNCTION HMI_FillCircle : BOOL
  VAR_INPUT Cx, Cy, R : DINT; Color : UDINT; END_VAR
  {external hmi_fill_circle(CX.get(), CY.get(), R.get(), (uint32_t)COLOR.get()); }
  HMI_FillCircle := TRUE;
END_FUNCTION

FUNCTION HMI_StrokeCircle : BOOL
  VAR_INPUT Cx, Cy, R, Width : DINT; Color : UDINT; END_VAR
  {external hmi_stroke_circle(CX.get(), CY.get(), R.get(), WIDTH.get(), (uint32_t)COLOR.get()); }
  HMI_StrokeCircle := TRUE;
END_FUNCTION

FUNCTION HMI_FillEllipse : BOOL
  VAR_INPUT Cx, Cy, Rx, Ry : DINT; Color : UDINT; END_VAR
  {external hmi_ellipse(CX.get(), CY.get(), RX.get(), RY.get(), (uint32_t)COLOR.get()); }
  HMI_FillEllipse := TRUE;
END_FUNCTION

FUNCTION HMI_StrokeEllipse : BOOL
  VAR_INPUT Cx, Cy, Rx, Ry, Width : DINT; Color : UDINT; END_VAR
  {external hmi_stroke_ellipse(CX.get(), CY.get(), RX.get(), RY.get(), WIDTH.get(), (uint32_t)COLOR.get()); }
  HMI_StrokeEllipse := TRUE;
END_FUNCTION

(* Stroked arc from A0 to A1 degrees. *)
FUNCTION HMI_Arc : BOOL
  VAR_INPUT Cx, Cy, R, Width, A0, A1 : DINT; Color : UDINT; END_VAR
  {external hmi_arc(CX.get(), CY.get(), R.get(), WIDTH.get(), A0.get(), A1.get(), (uint32_t)COLOR.get()); }
  HMI_Arc := TRUE;
END_FUNCTION

(* Polygon or polyline: HMI_PolyBegin, HMI_PolyPoint per vertex (up to 64), then HMI_PolyFill or HMI_PolyStroke. *)
FUNCTION HMI_PolyBegin : BOOL
  VAR_INPUT Color : UDINT; END_VAR
  {external hmi_poly_begin((uint32_t)COLOR.get()); }
  HMI_PolyBegin := TRUE;
END_FUNCTION

FUNCTION HMI_PolyPoint : BOOL
  VAR_INPUT X, Y : DINT; END_VAR
  {external hmi_poly_point(X.get(), Y.get()); }
  HMI_PolyPoint := TRUE;
END_FUNCTION

FUNCTION HMI_PolyFill : BOOL
  {external hmi_poly_end(); }
  HMI_PolyFill := TRUE;
END_FUNCTION

FUNCTION HMI_PolyStroke : BOOL
  VAR_INPUT Width : DINT; Closed : BOOL; END_VAR
  {external hmi_poly_stroke(WIDTH.get(), CLOSED.get() ? 1 : 0); }
  HMI_PolyStroke := TRUE;
END_FUNCTION

(* Text anchored at X by Align (left, centre or right edge); Y is the top of the line. *)
FUNCTION HMI_Text : BOOL
  VAR_INPUT X, Y : DINT; Text : STRING; Size : DINT; Font : HMI_FONT; Align : HMI_ALIGN; Color : UDINT; END_VAR
  {external hmi_text(X.get(), Y.get(), TEXT.get().c_str(), (int)TEXT.get().length(), SIZE.get(), (int)FONT.get().get(), (int)ALIGN.get().get(), (uint32_t)COLOR.get()); }
  HMI_Text := TRUE;
END_FUNCTION

(* Text aligned inside a box; vertical centring uses the font's metrics. *)
FUNCTION HMI_TextBox : BOOL
  VAR_INPUT
    X, Y, W, H : DINT; Text : STRING; Size : DINT; Font : HMI_FONT; HAlign : HMI_ALIGN; VAlign : HMI_VALIGN;
    Color : UDINT;
  END_VAR
  {external hmi_text_box(X.get(), Y.get(), W.get(), H.get(), TEXT.get().c_str(), (int)TEXT.get().length(), SIZE.get(), (int)FONT.get().get(), (int)HALIGN.get().get(), (int)VALIGN.get().get(), (uint32_t)COLOR.get()); }
  HMI_TextBox := TRUE;
END_FUNCTION

(* Advance of Text in lu, rounded up. *)
FUNCTION HMI_TextWidth : DINT
  VAR_INPUT Text : STRING; Size : DINT; Font : HMI_FONT; END_VAR
  {external HMI_TEXTWIDTH_result.set(hmi_text_width(TEXT.get().c_str(), (int)TEXT.get().length(), SIZE.get(), (int)FONT.get().get())); }
END_FUNCTION

(* Limits drawing to a rectangle until HMI_Unclip. *)
FUNCTION HMI_Clip : BOOL
  VAR_INPUT X, Y, W, H : DINT; END_VAR
  {external hmi_clip(X.get(), Y.get(), W.get(), H.get()); }
  HMI_Clip := TRUE;
END_FUNCTION

FUNCTION HMI_Unclip : BOOL
  {external hmi_unclip(); }
  HMI_Unclip := TRUE;
END_FUNCTION

FUNCTION HMI_ScreenW : DINT
  {external HMI_SCREENW_result.set(hmi_screen_w()); }
END_FUNCTION

FUNCTION HMI_ScreenH : DINT
  {external HMI_SCREENH_result.set(hmi_screen_h()); }
END_FUNCTION

(* Milliseconds from the host's clock, the same for every element of a frame. *)
FUNCTION HMI_TimeMs : UDINT
  {external HMI_TIMEMS_result.set(hmi_time_ms()); }
END_FUNCTION

(* Pointer in the element's own units; -1000000000 outside its frame's clip or when there is no pointer. *)
FUNCTION HMI_PtrX : DINT
  {external HMI_PTRX_result.set(hmi_ptr_x()); }
END_FUNCTION

FUNCTION HMI_PtrY : DINT
  {external HMI_PTRY_result.set(hmi_ptr_y()); }
END_FUNCTION

FUNCTION HMI_PtrDown : BOOL
  {external HMI_PTRDOWN_result.set(hmi_ptr_down() != 0); }
END_FUNCTION

(* The pointer went down this frame and nothing drawn on top took the press. *)
FUNCTION HMI_PtrPressed : BOOL
  {external HMI_PTRPRESSED_result.set(hmi_ptr_pressed() != 0); }
END_FUNCTION

FUNCTION HMI_PtrReleased : BOOL
  {external HMI_PTRRELEASED_result.set(hmi_ptr_released() != 0); }
END_FUNCTION

(* Takes this frame's press, so elements underneath ignore it. *)
FUNCTION HMI_PtrConsume : BOOL
  {external hmi_ptr_consume(); }
  HMI_PtrConsume := TRUE;
END_FUNCTION

(* The pointer is inside the rectangle, in the caller's units. *)
FUNCTION HMI_Hit : BOOL
  VAR_INPUT X, Y, W, H : DINT; END_VAR
  VAR px, py : DINT; END_VAR
  px := HMI_PtrX();
  py := HMI_PtrY();
  HMI_Hit := px >= X AND px < X + W AND py >= Y AND py < Y + H;
END_FUNCTION

(* Formats a REAL with Decimals (0..6) decimals, rounding half to even. *)
FUNCTION HMI_FormatReal : STRING
  VAR_INPUT Value : REAL; Decimals : INT; END_VAR
  {external
    char buf[48];
    hmi_format_real(buf, (int)sizeof(buf), VALUE.get(), (int)DECIMALS.get());
    HMI_FORMATREAL_result.set(buf);
  }
END_FUNCTION

FUNCTION HMI_FormatInt : STRING
  VAR_INPUT Value : DINT; END_VAR
  {external
    char buf[16];
    hmi_format_int(buf, (int)sizeof(buf), VALUE.get());
    HMI_FORMATINT_result.set(buf);
  }
END_FUNCTION

(* A value with its unit, as value widgets show it ("12.5 FT"), or the number alone without a unit. *)
FUNCTION HMI_FormatValue : STRING
  VAR_INPUT Value : REAL; Decimals : INT; Unit : STRING; END_VAR
  IF LEN(Unit) > 0 THEN
    HMI_FormatValue := CONCAT(HMI_FormatReal(Value, Decimals), CONCAT(' ', Unit));
  ELSE
    HMI_FormatValue := HMI_FormatReal(Value, Decimals);
  END_IF;
END_FUNCTION

(* Parses a REAL from Text; Fallback when the text is not a number. *)
FUNCTION HMI_ParseReal : REAL
  VAR_INPUT Text : STRING; Fallback : REAL; END_VAR
  {external
    char buf[256];
    size_t n = TEXT.get().length();
    if (n > 255) n = 255;
    memcpy(buf, TEXT.get().c_str(), n);
    buf[n] = 0;
    char *end = nullptr;
    float v = strtof(buf, &end);
    while (end != nullptr && (end[0] == ' ' || end[0] == '\\t')) end++;
    HMI_PARSEREAL_result.set((end != buf && end != nullptr && end[0] == 0 && v == v) ? v : FALLBACK.get());
  }
END_FUNCTION

(* Text cut to at most MaxLength characters. *)
FUNCTION HMI_Truncate : STRING
  VAR_INPUT Text : STRING; MaxLength : INT; END_VAR
  IF MaxLength <= 0 THEN
    HMI_Truncate := '';
  ELSIF LEN(Text) > MaxLength THEN
    HMI_Truncate := LEFT(Text, MaxLength);
  ELSE
    HMI_Truncate := Text;
  END_IF;
END_FUNCTION

(* Amp * sin(Deg) and Amp * cos(Deg), rounded, from the core's one-degree table. *)
FUNCTION HMI_Sin : DINT
  VAR_INPUT Deg, Amp : DINT; END_VAR
  {external HMI_SIN_result.set(hmi_sin(DEG.get(), AMP.get())); }
END_FUNCTION

FUNCTION HMI_Cos : DINT
  VAR_INPUT Deg, Amp : DINT; END_VAR
  {external HMI_COS_result.set(hmi_cos(DEG.get(), AMP.get())); }
END_FUNCTION

(* Back to the screen shown before this one; FALSE when there is none. *)
FUNCTION HMI_Back : BOOL
  {external HMI_BACK_result.set(hmi_page_back() != 0); }
END_FUNCTION
`
