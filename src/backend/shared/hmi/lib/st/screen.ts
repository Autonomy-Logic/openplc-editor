/** StandardWidgets ST source: the on-screen keyboard, the screen base and the runtime the generated glue drives. */
export const SCREEN_ST = `(* On-screen keyboard shared by every input element; also takes physical keys. Kept per viewer by the core. *)
FUNCTION_BLOCK HmiKeyboard
  VAR
    px, py, pw, ph, kx, ky, kw, kh : DINT;
    key : STRING(8);
    rows : ARRAY[0..3] OF STRING(16) := ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL.', 'ZXCVBNM-'];
    nrows : ARRAY[0..3] OF STRING(8) := ['789', '456', '123', '0.-'];
  END_VAR

  METHOD INTERNAL IsOpen : BOOL
    {external ISOPEN_result.set(hmi_kbd_is_open() != 0); }
  END_METHOD
  METHOD INTERNAL Numeric : BOOL
    {external NUMERIC_result.set(hmi_kbd_numeric() != 0); }
  END_METHOD
  METHOD INTERNAL Entry : STRING
    {external ENTRY_result.set(hmi_kbd_text()); }
  END_METHOD
  METHOD INTERNAL Title : STRING
    {external TITLE_result.set(hmi_kbd_title()); }
  END_METHOD
  METHOD INTERNAL SetEntry : BOOL
    VAR_INPUT Text : STRING; END_VAR
    {external hmi_kbd_set_text(TEXT.get().c_str(), (int)TEXT.get().length()); }
    SetEntry := TRUE;
  END_METHOD
  METHOD INTERNAL Close : BOOL
    VAR_INPUT Accepted : BOOL; END_VAR
    {external hmi_kbd_close(ACCEPTED.get() ? 1 : 0); }
    Close := TRUE;
  END_METHOD
  METHOD INTERNAL NextKey : UDINT
    {external NEXTKEY_result.set(hmi_key_next()); }
  END_METHOD
  (* Appends one printable character, code point below 128. *)
  METHOD INTERNAL AppendCode : BOOL
    VAR_INPUT Code : UDINT; END_VAR
    {external
      std::string t(hmi_kbd_text());
      t.push_back((char)CODE.get());
      hmi_kbd_set_text(t.c_str(), (int)t.size());
    }
    AppendCode := TRUE;
  END_METHOD
  METHOD INTERNAL Apply : BOOL
    VAR_INPUT K : STRING; END_VAR
    VAR t : STRING; END_VAR
    t := Entry();
    IF K = 'OK' THEN
      Close(TRUE);
    ELSIF K = 'ESC' THEN
      Close(FALSE);
    ELSIF K = 'DEL' THEN
      IF LEN(t) > 0 THEN
        SetEntry(LEFT(t, LEN(t) - 1));
      END_IF;
    ELSIF K = 'CLR' THEN
      SetEntry('');
    ELSE
      SetEntry(CONCAT(t, K));
    END_IF;
    Apply := TRUE;
  END_METHOD
  METHOD INTERNAL Arrange : BOOL
    pw := MIN(HMI_ScreenW() - 20, 620);
    IF Numeric() THEN
      pw := MIN(pw, 320);
    END_IF;
    ph := MIN(300, HMI_ScreenH() - 8);
    kh := (ph - 82) / 4 - 6;
    px := (HMI_ScreenW() - pw) / 2;
    py := MAX(4, HMI_ScreenH() - ph - 10);
    Arrange := TRUE;
  END_METHOD
  METHOD INTERNAL Columns : INT
    VAR_INPUT R : INT; END_VAR
    IF Numeric() THEN
      Columns := 4;
    ELSE
      Columns := LEN(rows[R]) + 1;
    END_IF;
  END_METHOD
  (* Rectangle and label of key (R, C) of the active layout, in kx, ky, kw, kh and key. *)
  METHOD INTERNAL KeyAt : BOOL
    VAR_INPUT R, C : INT; END_VAR
    ky := py + 74 + INT_TO_DINT(R) * (kh + 6);
    IF Numeric() THEN
      kw := (pw - 20 - 3 * 6) / 4;
      kx := px + 10 + INT_TO_DINT(C) * (kw + 6);
      IF C = 3 THEN
        CASE R OF
          0: key := 'DEL';
          1: key := 'CLR';
          2: key := 'ESC';
        ELSE
          key := 'OK';
        END_CASE;
      ELSE
        key := MID(nrows[R], 1, C + 1);
      END_IF;
    ELSE
      kw := (pw - 20 - 10 * 5) / 11;
      kx := px + 10 + INT_TO_DINT(C) * (kw + 5) + INT_TO_DINT(R) * kw / 4;
      IF C >= LEN(rows[R]) THEN
        CASE R OF
          0: key := 'DEL';
          1: key := 'ESC';
          2: key := 'OK';
        ELSE
          key := 'CLR';
        END_CASE;
      ELSE
        key := MID(rows[R], 1, C + 1);
      END_IF;
    END_IF;
    KeyAt := TRUE;
  END_METHOD
  (* Physical keys, then taps. While open the overlay is modal and takes every press. *)
  METHOD INTERNAL Handle : BOOL
    VAR code : UDINT; r, c : INT; hit : STRING(8); END_VAR
    IF NOT IsOpen() THEN
      WHILE NextKey() <> 0 DO
        code := 0;
      END_WHILE;
      RETURN;
    END_IF;
    Arrange();
    code := NextKey();
    WHILE code <> 0 AND IsOpen() DO
      IF code = 13 THEN
        Apply('OK');
      ELSIF code = 27 THEN
        Apply('ESC');
      ELSIF code = 8 OR code = 127 THEN
        Apply('DEL');
      ELSIF code >= 32 AND code < 127 THEN
        AppendCode(code);
      END_IF;
      code := NextKey();
    END_WHILE;
    IF HMI_PtrPressed() AND IsOpen() THEN
      FOR r := 0 TO 3 DO
        FOR c := 0 TO Columns(r) - 1 DO
          KeyAt(r, c);
          IF HMI_Hit(kx, ky, kw, kh) THEN
            hit := key;
          END_IF;
        END_FOR;
      END_FOR;
      HMI_PtrConsume();
      IF LEN(hit) > 0 THEN
        Apply(hit);
      END_IF;
    END_IF;
    Handle := TRUE;
  END_METHOD
  METHOD INTERNAL Paint : BOOL
    VAR r, c : INT; kc, tc : UDINT; END_VAR
    IF NOT IsOpen() THEN
      RETURN;
    END_IF;
    Arrange();
    HMI_FillRect(0, 0, HMI_ScreenW(), HMI_ScreenH(), 0, HMI_Alpha(COLOR.Black, 40));
    HMI_FillRect(px, py, pw, ph, 14, COLOR.Background);
    HMI_Text(px + 14, py + 10, Title(), 13, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    HMI_FillRect(px + 10, py + 30, pw - 20, 36, 8, COLOR.Surface);
    HMI_StrokeRect(px + 10, py + 30, pw - 20, 36, 8, 2, COLOR.Accent);
    HMI_TextBox(px + 20, py + 30, pw - 40, 36, Entry(), 18, HMI_FONT#Bold, HMI_ALIGN#Right, HMI_VALIGN#Middle, COLOR.Text);
    FOR r := 0 TO 3 DO
      FOR c := 0 TO Columns(r) - 1 DO
        KeyAt(r, c);
        kc := COLOR.Surface;
        tc := COLOR.Text;
        IF key = 'OK' THEN
          kc := COLOR.Accent;
          tc := COLOR.OnAccent;
        ELSIF LEN(key) > 1 THEN
          kc := COLOR.Fill;
        END_IF;
        HMI_FillRect(kx, ky, kw, kh, 6, kc);
        HMI_StrokeRect(kx, ky, kw, kh, 6, 1, COLOR.Border);
        HMI_TextBox(kx, ky, kw, kh, key, 16, HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, tc);
      END_FOR;
    END_FOR;
    Paint := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Base of every screen. The body runs every frame after input and write-back; Layout after the containers placed
   everything; OnShow and OnHide when the screen is shown or left. The HMI build generates Build and WriteBack. *)
FUNCTION_BLOCK HmiScreen
  VAR_INPUT
    {attribute 'hmi_color'}
    Background : UDINT := COLOR.Background;
  END_VAR
  VAR
    Items : ARRAY[0..255] OF POINTER TO HmiElement;
    Count : INT;
    ThemeId : DINT;
    NextId : DINT;
    (* Elements without a Parent go into the screen's own column. *)
    Root : HmiStack := (Direction := HMI_DIRECTION#Column, Padding := 12, Gap := 8);
  END_VAR

  (* Switches the screen to another theme from the next frame; the build names themes HMI_THEME_<Name>. *)
  METHOD SetTheme : BOOL
    VAR_INPUT Theme : DINT; END_VAR
    ThemeId := Theme;
    SetTheme := TRUE;
  END_METHOD
  METHOD PROTECTED Layout : BOOL
    Layout := TRUE;
  END_METHOD
  METHOD PROTECTED OnShow : BOOL
    OnShow := TRUE;
  END_METHOD
  METHOD PROTECTED OnHide : BOOL
    OnHide := TRUE;
  END_METHOD
  (* Generated: attaches the elements, connects the pipes and sets the theme. *)
  METHOD PROTECTED Build : BOOL
    Build := TRUE;
  END_METHOD
  (* Generated: writes the operator's changes back to the wired variables. *)
  METHOD PROTECTED WriteBack : BOOL
    WriteBack := TRUE;
  END_METHOD
  (* Adds an element, drawn after the ones added before it, inside Parent or else the screen's column. *)
  METHOD PROTECTED Attach : BOOL
    VAR_INPUT Element : POINTER TO HmiElement; Parent : POINTER TO HmiStack; END_VAR
    IF Element = 0 OR Count >= 256 THEN
      RETURN;
    END_IF;
    Items[Count] := Element;
    Count := Count + 1;
    Element^.SetId(NextId);
    NextId := NextId + 1;
    IF Parent <> 0 THEN
      Attach := Parent^.AddChild(Element);
    ELSE
      Attach := Root.AddChild(Element);
    END_IF;
  END_METHOD
  METHOD PROTECTED Connect : BOOL
    VAR_INPUT Pipe : POINTER TO HmiPipe; Source, Target : POINTER TO HmiElement; END_VAR
    IF Pipe <> 0 THEN
      Connect := Pipe^.Connect(Source, Target);
    END_IF;
  END_METHOD
  METHOD PROTECTED UseTheme : BOOL
    VAR_INPUT Theme : DINT; END_VAR
    ThemeId := Theme;
    UseTheme := TRUE;
  END_METHOD

  METHOD INTERNAL Setup : DINT
    VAR_INPUT FirstId : DINT; END_VAR
    NextId := FirstId;
    Build();
    Setup := NextId;
  END_METHOD
  METHOD INTERNAL ApplyTheme : BOOL
    {external hmi_theme_use(THEMEID.get()); }
    ApplyTheme := TRUE;
  END_METHOD
  METHOD INTERNAL RunShow : BOOL
    RunShow := OnShow();
  END_METHOD
  METHOD INTERNAL RunHide : BOOL
    RunHide := OnHide();
  END_METHOD
  METHOD INTERNAL RunInput : BOOL
    VAR i : INT; END_VAR
    FOR i := Count - 1 TO 0 BY -1 DO
      Items[i]^.HandleInput();
    END_FOR;
    RunInput := WriteBack();
  END_METHOD
  METHOD INTERNAL RunDraw : BOOL
    VAR i : INT; END_VAR
    Root.Place(0, 0, HMI_ScreenW(), HMI_ScreenH());
    Layout();
    ApplyTheme();
    HMI_Clear(Background);
    FOR i := 0 TO Count - 1 DO
      Items[i]^.Render();
    END_FOR;
    RunDraw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* The engine as the generated glue sees it. Per frame and viewer: BeginFrame, then the body of the screen it
   returns, then EndFrame. *)
FUNCTION_BLOCK HmiRuntime
  VAR
    Screens : ARRAY[0..63] OF POINTER TO HmiScreen;
    Count : DINT;
    NextId : DINT := 1;
    StartPage : DINT;
    Current : DINT := -1;
    Keyboard : HmiKeyboard;
    Denied : ARRAY[0..63] OF BOOL;
  END_VAR

  (* Adds a screen; its page number is the order of the calls, from 0. Returns -1 when full. *)
  METHOD AddScreen : DINT
    VAR_INPUT Screen : POINTER TO HmiScreen; END_VAR
    AddScreen := -1;
    IF Screen = 0 OR Count >= 64 THEN
      RETURN;
    END_IF;
    Screens[Count] := Screen;
    NextId := Screen^.Setup(NextId);
    AddScreen := Count;
    Count := Count + 1;
  END_METHOD
  (* Whether the viewer may open page Page; every page is allowed until denied. *)
  METHOD SetAccess : BOOL
    VAR_INPUT Page : DINT; Allowed : BOOL; END_VAR
    IF Page >= 0 AND Page < 64 THEN
      Denied[Page] := NOT Allowed;
      SetAccess := TRUE;
    END_IF;
  END_METHOD
  METHOD INTERNAL CanShow : BOOL
    VAR_INPUT Page : DINT; END_VAR
    CanShow := Page >= 0 AND Page < Count;
    IF CanShow THEN
      CanShow := NOT Denied[Page];
    END_IF;
  END_METHOD
  (* The start page when allowed, else the first allowed page in project order; -1 when none is. *)
  METHOD INTERNAL Entry : DINT
    VAR p : DINT; END_VAR
    Entry := -1;
    IF CanShow(StartPage) THEN
      Entry := StartPage;
      RETURN;
    END_IF;
    FOR p := 0 TO Count - 1 DO
      IF CanShow(p) THEN
        Entry := p;
        RETURN;
      END_IF;
    END_FOR;
  END_METHOD
  (* Page a viewer starts on. *)
  METHOD SetStart : BOOL
    VAR_INPUT Page : DINT; END_VAR
    StartPage := Page;
    SetStart := TRUE;
  END_METHOD
  (* Project theme Theme starts as a copy of theme Base; SetThemeColor then sets its tokens. *)
  METHOD CopyTheme : BOOL
    VAR_INPUT Theme, Base : DINT; END_VAR
    {external hmi_theme_copy(THEME.get(), BASE.get()); }
    CopyTheme := TRUE;
  END_METHOD
  METHOD SetThemeColor : BOOL
    VAR_INPUT Theme, Token : DINT; Rgb : UDINT; END_VAR
    {external hmi_theme_define(THEME.get(), TOKEN.get(), (uint32_t)RGB.get()); }
    SetThemeColor := TRUE;
  END_METHOD
  (* Shows page Page from the next frame; FALSE when there is no such page or the viewer may not open it. *)
  METHOD Show : BOOL
    VAR_INPUT Page : DINT; END_VAR
    IF CanShow(Page) THEN
      SetPage(Page);
      Show := TRUE;
    END_IF;
  END_METHOD
  (* Page the viewer is on. *)
  METHOD CurrentPage : DINT
    {external CURRENTPAGE_result.set(hmi_page()); }
  END_METHOD
  METHOD INTERNAL SetPage : BOOL
    VAR_INPUT Page : DINT; END_VAR
    {external hmi_set_page(PAGE.get()); }
    SetPage := TRUE;
  END_METHOD
  METHOD INTERNAL ResetPage : BOOL
    VAR_INPUT Page : DINT; END_VAR
    {external hmi_page_reset(PAGE.get()); }
    ResetPage := TRUE;
  END_METHOD
  METHOD INTERNAL Shown : DINT
    {external SHOWN_result.set(hmi_page_shown()); }
  END_METHOD
  METHOD INTERNAL SetShown : BOOL
    VAR_INPUT Page : DINT; END_VAR
    {external hmi_page_set_shown(PAGE.get()); }
    SetShown := TRUE;
  END_METHOD
  (* Starts the viewer's frame: keyboard, page changes, the screen's input and write-back. Returns the page whose
     screen body runs next, -1 when there is no screen the viewer may open. *)
  METHOD BeginFrame : DINT
    VAR page, shown : DINT; END_VAR
    Current := -1;
    BeginFrame := -1;
    IF Count = 0 THEN
      RETURN;
    END_IF;
    shown := Shown();
    page := CurrentPage();
    IF shown < 0 OR NOT CanShow(page) THEN
      page := Entry();
      IF page < 0 THEN
        RETURN;
      END_IF;
      ResetPage(page);
    END_IF;
    Screens[page]^.ApplyTheme();
    Keyboard.Handle();
    IF page <> shown THEN
      IF shown >= 0 AND shown < Count THEN
        Screens[shown]^.RunHide();
      END_IF;
      Screens[page]^.RunShow();
      SetShown(page);
    END_IF;
    Screens[page]^.RunInput();
    Current := page;
    BeginFrame := page;
  END_METHOD
  (* Lays out and draws the screen BeginFrame returned, then the keyboard on top. *)
  METHOD EndFrame : BOOL
    IF Current < 0 THEN
      HMI_Clear(COLOR.Background);
      IF Count > 0 THEN
        HMI_TextBox(0, 0, HMI_ScreenW(), HMI_ScreenH(), 'No screens for your role', 16, HMI_FONT#Regular,
          HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.TextMuted);
      END_IF;
      RETURN;
    END_IF;
    Screens[Current]^.RunDraw();
    Keyboard.Paint();
    EndFrame := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
