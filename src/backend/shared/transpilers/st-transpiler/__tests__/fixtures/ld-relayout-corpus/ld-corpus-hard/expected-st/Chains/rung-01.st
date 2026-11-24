
  TON0(IN := h07_start, PT := T#1s);
  CTU0(CU := TON0.Q, R := h07_reset, PV := 4);
  h07_done := CTU0.Q;
  h07_count := CTU0.CV;
