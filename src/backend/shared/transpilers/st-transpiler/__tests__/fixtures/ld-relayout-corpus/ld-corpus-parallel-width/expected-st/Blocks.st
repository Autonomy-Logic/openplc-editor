PROGRAM Blocks
  VAR
    TON0 : TON;
    w06_y : BOOL;
    w06_b : BOOL;
    w06_a : BOOL;
    w07_c : BOOL;
    CTU0 : CTU;
    w07_y : BOOL;
    w07_i : BOOL;
    w07_k : BOOL;
    w07_j : BOOL;
    w08_c : BOOL;
    CTUD0 : CTUD;
    w08_y : BOOL;
    w08_i : BOOL;
    w08_k : BOOL;
    w08_l : BOOL;
    w08_j : BOOL;
  END_VAR

  TON0(IN := w06_a, PT := T#1s);
  w06_y := TON0.Q OR w06_b;
  CTU0(CU := w07_c, R := w07_k OR w07_j AND w07_i);
  w07_y := CTU0.Q;
  CTUD0(CU := w08_c, LD := w08_k OR w08_l OR w08_j AND w08_i);
  w08_y := CTUD0.QU;
END_PROGRAM

