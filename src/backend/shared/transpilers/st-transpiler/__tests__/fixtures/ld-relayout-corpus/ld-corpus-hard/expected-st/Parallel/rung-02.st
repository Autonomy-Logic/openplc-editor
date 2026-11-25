
  TON1(IN := h06_a1 AND h06_en, PT := T#1s);
  h06_y1 := TON1.Q;
  TOF0(IN := h06_b1 AND h06_en, PT := T#2s);
  h06_y2 := TOF0.Q;
  CTU1(CU := h06_c1 AND h06_en, R := h06_r, PV := 7);
  h06_y3 := CTU1.Q;
  h06_cv := CTU1.CV;
  h06_y4 := h06_en;
