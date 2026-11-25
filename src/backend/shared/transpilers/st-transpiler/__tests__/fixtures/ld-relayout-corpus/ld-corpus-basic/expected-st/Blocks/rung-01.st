
  TON0(EN := b03_enable, IN := b03_start, PT := T#2s);
  b03_done := TON0.ENO;
  IF TON0.ENO THEN
      b03_q := TON0.Q;
  END_IF;
  IF TON0.ENO THEN
      b03_et := TON0.ET;
  END_IF;
