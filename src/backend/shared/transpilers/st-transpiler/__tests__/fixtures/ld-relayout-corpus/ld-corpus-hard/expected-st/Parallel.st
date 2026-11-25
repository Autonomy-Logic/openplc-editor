PROGRAM Parallel
  VAR
    TON0 : TON;
    h05_out : BOOL;
    CTU0 : CTU;
    h05_a : BOOL;
    h05_b : BOOL;
    h05_r : BOOL;
    h06_en : BOOL;
    h06_y1 : BOOL;
    h06_y2 : BOOL;
    h06_y3 : BOOL;
    h06_y4 : BOOL;
    TON1 : TON;
    h06_a1 : BOOL;
    TOF0 : TOF;
    h06_b1 : BOOL;
    CTU1 : CTU;
    h06_c1 : BOOL;
    h06_r : BOOL;
    h06_cv : INT;
    h09_out : BOOL;
    TON2 : TON;
    TOF1 : TOF;
    h09_a : BOOL;
    h09_b : BOOL;
    h09_c : BOOL;
    h09_d : BOOL;
    _TMP_AND5437823_OUT : BOOL;
  END_VAR

  TON0(IN := h05_a, PT := T#1s);
  CTU0(CU := h05_b, R := h05_r, PV := 5);
  h05_out := CTU0.Q OR TON0.Q;
  TON1(IN := h06_a1 AND h06_en, PT := T#1s);
  h06_y1 := TON1.Q;
  TOF0(IN := h06_b1 AND h06_en, PT := T#2s);
  h06_y2 := TOF0.Q;
  CTU1(CU := h06_c1 AND h06_en, R := h06_r, PV := 7);
  h06_y3 := CTU1.Q;
  h06_cv := CTU1.CV;
  h06_y4 := h06_en;
  TON2(IN := h09_a, PT := T#1s);
  TOF1(IN := h09_b, PT := T#2s);
  _TMP_AND5437823_OUT := AND(TOF1.Q OR TON2.Q, h09_c OR h09_d);
  h09_out := _TMP_AND5437823_OUT;
END_PROGRAM


