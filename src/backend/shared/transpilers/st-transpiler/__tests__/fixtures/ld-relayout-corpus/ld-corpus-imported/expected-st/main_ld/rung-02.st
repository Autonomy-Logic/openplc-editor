
  TON0(IN := run_valve, PT := T_Max);
  TOF0(IN := TON0.Q, PT := T_Max);
  timeout := TOF0.Q;
