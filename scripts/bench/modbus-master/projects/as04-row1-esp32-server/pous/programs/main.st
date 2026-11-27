PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    held_0 : UINT AT %QW0;
    held_1 : UINT AT %QW1;
    held_2 : UINT AT %QW2;
    held_3 : UINT AT %QW3;
    held_4 : UINT AT %QW4;
    held_5 : UINT AT %QW5;
    held_6 : UINT AT %QW6;
    held_7 : UINT AT %QW7;
    held_8 : UINT AT %QW8;
    held_9 : UINT AT %QW9;
    bad_steps : UINT AT %QW10;
    g1_0 : UINT AT MB_G1_0;
    g1_1 : UINT AT MB_G1_1;
    g1_2 : UINT AT MB_G1_2;
    g1_3 : UINT AT MB_G1_3;
    g1_4 : UINT AT MB_G1_4;
    g1_5 : UINT AT MB_G1_5;
    g1_6 : UINT AT MB_G1_6;
    g1_7 : UINT AT MB_G1_7;
    g1_8 : UINT AT MB_G1_8;
    g1_9 : UINT AT MB_G1_9;
    last : UINT;
    seen : BOOL;
  END_VAR

scan_toggle := NOT scan_toggle;
held_0 := 7000;
held_1 := 7001;
held_2 := 7002;
held_3 := 7003;
held_4 := 7004;
held_5 := 7005;
held_6 := 7006;
held_7 := 7007;
held_8 := 7008;
held_9 := 7009;
IF g1_0 <> last THEN
  IF seen AND g1_0 <> last + 1 THEN
    bad_steps := bad_steps + 1;
  END_IF;
  seen := TRUE;
  last := g1_0;
END_IF;

END_PROGRAM
