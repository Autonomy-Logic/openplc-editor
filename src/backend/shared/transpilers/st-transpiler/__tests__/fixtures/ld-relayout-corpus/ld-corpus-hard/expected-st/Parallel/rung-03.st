
  TON2(IN := h09_a, PT := T#1s);
  TOF1(IN := h09_b, PT := T#2s);
  _TMP_AND5437823_OUT := AND(TOF1.Q OR TON2.Q, h09_c OR h09_d);
  h09_out := _TMP_AND5437823_OUT;
