
  TON2(EN := b09_go, IN := b09_in, PT := T#1s);
  b09_eno := TON2.ENO;
  IF TON2.ENO THEN
      b09_q := TON2.Q;
  END_IF;
  IF TON2.ENO THEN
      b09_et := TON2.ET;
  END_IF;
