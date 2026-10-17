print("[MM] ModMenu loading...")
local FrameTick = require("FrameTick")
local ModSettings = require("ModSettings")

-- In-game menu with two sections:
--   MODS     - turns UE4SS mods on/off by rewriting Mods\mods.txt (applies on Ctrl+R, because
--              UE4SS reads mods.txt at startup and on every hot reload)
--   SETTINGS - on/off settings of the mods, saved by ModSettings (shared\ModSettings) and picked
--              up by the mods within a second - no Ctrl+R needed
--
-- Keys:  Home = open/close   Up/Down (or PgUp/PgDn) = select   End = switch the selected row
--
-- How it draws (chosen because some HUD text widgets only repaint when their size changes):
--   * the menu is built fresh every time it opens and removed when it closes;
--   * text never changes after a label is created;
--   * the selection is a highlight bar that is MOVED to the selected row (moving always repaints);
--   * a switch that changes is removed and drawn again.
--
-- Widgets (verified in UE4SS_ObjectDump.txt):
--   rectangles: /Game/UI/EndOfHunt/StackableProgressBar.StackableProgressBar_C - a ProgressBar at
--               100% with a solid fill colour (no texture), BoostIconBarImage hidden
--   text      : /Game/UI/Chat/w_chat_log_label_bpw.w_chat_log_label_bpw_C (ChatLogLabelTextBlock),
--               font copied from HealthStamina_bpw.HealthValueText (the player's HP numbers)
-- Every widget is tagged with RenderOpacity 0.997 so a reload removes only the menu's widgets.
-- Gotcha: SetPositionInViewport resets viewport anchors - set anchors AFTER it.

-- ---------------------------------------------------------------- settings

-- Mods that ship with UE4SS, and this menu: not shown (their mods.txt lines are left alone).
local HIDDEN = {
    ModMenu = true, Keybinds = true,
    CheatManagerEnablerMod = true, ConsoleCommandsMod = true, ConsoleEnablerMod = true,
    SplitScreenMod = true, LineTraceMod = true, BPML_GenericFunctions = true, BPModLoaderMod = true,
    jsbLuaProfilerMod = true,
}
-- Friendlier names for known mods (anything else shows its folder name).
local DISPLAY = {BehemothHealthBars = "Behemoth Health Bars", BehemothTracker = "Behemoth Tracker",
                  CraftStar = "Uncrafted Weapons", LockOn = "Lock-on"}

-- The SETTINGS section. Keys and defaults must match the mods that read them.
local SETTINGS = {
    {key = "bhb_shield", label = "Health bars: shield bar", default = true},
    {key = "bhb_text",   label = "Health bars: HP numbers", default = true},
    {key = "bhb_dual",   label = "Health bars: two bars in escalations", default = true},
    {key = "trk_always", label = "Tracker: show at any distance", default = false},
    -- choice setting: End cycles through the choices; stored as their number (1, 2, 3)
    {key = "cst_color", label = "Uncrafted weapons: name colour", default = 2, choices = {
        {name = "Red",    color = {R = 1.00, G = 0.25, B = 0.25, A = 1}},
        {name = "Gold",   color = {R = 1.00, G = 0.78, B = 0.20, A = 1}},
        {name = "Purple", color = {R = 0.72, G = 0.42, B = 1.00, A = 1}},
    }},
    -- action setting: End runs it (the stored number counts the presses; the mod watches it)
    -- shows: the setting holding the current key's code, written by the mod
    {key = "lock_rebind", label = "Lock-on: change key", default = 0, action = "Press End", showsFile = "LockOn/key_label.txt"},
}

local MENU_X, MENU_Y = 40, 300          -- top-left of the panel (UI units)
local PANEL_W = 520
local PAD_X, PAD_Y = 20, 12
local TITLE_SIZE = 22
local SECTION_SIZE = 15
local TEXT_SIZE = 17
local HINT_SIZE = 13
local SIGNATURE = "-zfxstatic"          -- shown at the right end of the title line
local SIGNATURE_SIZE = 14
local ROW_H = math.floor(TEXT_SIZE * 1.8 + 0.5)
local SWITCH_W, SWITCH_H = 44, 20       -- the on/off switch at the right of every row
local KNOB = 14
local LINE_THICK = 2
local SLIDE_SECS = 0.65

local FILL_COLOR = {R = 0.0, G = 0.0, B = 0.0, A = 0.82}
local LINE_COLOR = {R = 0.35, G = 0.75, B = 1.00, A = 1.0}         -- blue edges, dividers, headers
local HILITE_COLOR = {R = 0.35, G = 0.75, B = 1.00, A = 0.30}       -- selected row
local WHITE = {R = 1, G = 1, B = 1, A = 1}
local GREY = {R = 0.70, G = 0.70, B = 0.70, A = 1}
local SWITCH_ON = {R = 0.25, G = 0.75, B = 0.35, A = 1}
local SWITCH_OFF = {R = 0.30, G = 0.30, B = 0.30, A = 1}
local SWITCH_PENDING = {R = 0.90, G = 0.70, B = 0.20, A = 1}       -- mod switched, not applied yet
local KNOB_COLOR = {R = 0.95, G = 0.95, B = 0.95, A = 1}
local PENDING_COLOR = {R = 1.00, G = 0.85, B = 0.35, A = 1}
local TAG_OPACITY = 0.997

local TEXT_PATH = "/Game/UI/Chat/w_chat_log_label_bpw.w_chat_log_label_bpw_C"
local TEXT_ASSET = "/Game/UI/Chat/w_chat_log_label_bpw"
local PANEL_PATH = "/Game/UI/EndOfHunt/StackableProgressBar.StackableProgressBar_C"
local PANEL_ASSET = "/Game/UI/EndOfHunt/StackableProgressBar"
local FONT_SRC = "/Game/UI/HUD/HealthStamina_bpw.HealthStamina_bpw_C:WidgetTree.HealthValueText"

-- ESlateVisibility: 3 HitTestInvisible, 1 Collapsed
local VIS_SHOWN, VIS_HIDDEN = 3, 1

-- ---------------------------------------------------------------- state

local ui = nil          -- the open menu: {ctx, widgets, labels, switches, hilite, rowY, hintY}
local isOpen = false
local cursor = 1
local entries = {}      -- shown mods: {name, on, loadedOn, lineIndex}
local items = {}        -- every selectable row: {kind = "mod", entry} or {kind = "setting", setting}
local lines = {}        -- raw lines of mods.txt
local eol = "\n"
local modsDir = nil
local rects = {}        -- widget -> resting {x, y}, so the slide-in can offset all of them
local slideX = 0
local slide = nil       -- running slide-in: {start, dist}
local GS = nil

local function log(m) print("[MM] " .. tostring(m)) end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

-- ---------------------------------------------------------------- mods.txt

local function FindModsDir()
    local src = debug.getinfo(1, "S").source or ""
    src = src:gsub("^@", ""):gsub("/", "\\")
    -- ...\Mods\ModMenu\Scripts\main.lua  ->  ...\Mods\
    local dir = src:match("^(.*\\)[^\\]+\\[Ss]cripts\\[^\\]+$")
    if dir then return dir end
    return "ue4ss\\Mods\\"
end

local function ReadModsTxt()
    local f = io.open(modsDir .. "mods.txt", "rb")
    if not f then log("cannot open " .. modsDir .. "mods.txt") return false end
    local data = f:read("*a")
    f:close()
    eol = data:find("\r\n", 1, true) and "\r\n" or "\n"
    lines = {}
    for line in (data .. "\n"):gmatch("([^\n]*)\n") do
        lines[#lines + 1] = (line:gsub("\r$", ""))
    end
    if lines[#lines] == "" and data:sub(-1) == "\n" then lines[#lines] = nil end
    return true
end

-- True when the mod's folder has a script. mods.txt can name mods that are gone (it is kept when
-- an update removes a mod), and those are not shown.
local function ModExists(name)
    local f = io.open(modsDir .. name .. "\\Scripts\\main.lua", "rb")
    if f then f:close() return true end
    return false
end

-- keepLoaded: remember which state each mod was LOADED with (to mark unapplied changes)
local function ParseEntries(keepLoaded)
    local old = {}
    for _, e in ipairs(entries) do old[e.name] = e.loadedOn end
    entries = {}
    for i, line in ipairs(lines) do
        if not line:match("^%s*;") then
            local name, val = line:match("^%s*(.-)%s*:%s*([01])%s*$")
            if name and name ~= "" and not HIDDEN[name] and ModExists(name) then
                local on = (val == "1")
                local loadedOn = on
                if keepLoaded and old[name] ~= nil then loadedOn = old[name] end
                entries[#entries + 1] = {name = name, on = on, loadedOn = loadedOn, lineIndex = i}
            end
        end
    end
end

local function WriteModsTxt()
    local f = io.open(modsDir .. "mods.txt", "wb")
    if not f then log("cannot write " .. modsDir .. "mods.txt") return false end
    f:write(table.concat(lines, eol) .. eol)
    f:close()
    return true
end

local function BuildItems()
    items = {}
    for _, e in ipairs(entries) do items[#items + 1] = {kind = "mod", entry = e} end
    for _, s in ipairs(SETTINGS) do items[#items + 1] = {kind = "setting", setting = s} end
end

-- ---------------------------------------------------------------- widget helpers

local function GetPC()
    local list = FindAllOf("ArchonPlayerController")
    local PC = list and list[1]
    if valid(PC) then return PC end
    return nil
end

local function FindOrLoad(path, asset)
    local o = StaticFindObject(path)
    if valid(o) then return o end
    pcall(function() LoadAsset(asset) end)
    o = StaticFindObject(path)
    if valid(o) then return o end
    log("not found: " .. path)
    return nil
end

-- Places a top-level widget (UI units, from the top-left of the screen) and remembers its
-- resting position for the slide-in.
local function PlaceWidget(w, x, y, sx, sy)
    if not valid(w) then return end
    rects[w] = {x = x, y = y}
    pcall(function()
        w:SetPositionInViewport({X = x + slideX, Y = y}, false)
        w:SetDesiredSizeInViewport({X = sx, Y = sy})
        w:SetAnchorsInViewport({Minimum = {X = 0, Y = 0}, Maximum = {X = 0, Y = 0}})
        w:SetAlignmentInViewport({X = 0, Y = 0})
    end)
end

local function Track(w)
    ui.widgets[#ui.widgets + 1] = w
    pcall(function() w:SetRenderOpacity(TAG_OPACITY) end)
    pcall(function() w:SetVisibility(VIS_SHOWN) end)
end

local function Untrack(w)
    if valid(w) then pcall(function() w:RemoveFromViewport() end) end
    rects[w] = nil
    for i, x in ipairs(ui.widgets) do
        if x == w then table.remove(ui.widgets, i) break end
    end
end

-- A solid rectangle: StackableProgressBar at 100% with a flat fill colour.
local function MakeSolid(color, z)
    local c = ui.ctx
    local w = c.Lib:Create(c.PC, c.panelCls, c.PC)
    if not valid(w) then return nil end
    local okB, bar = pcall(function() return w.ProgressBarComponent end)
    if not (okB and valid(bar)) then return nil end
    local o = {w = w, bar = bar}
    local okP, box = pcall(function() return bar:GetParent() end)
    if okP and valid(box) then
        o.sizeBox = box
        local okS, s = pcall(function() return box.Slot end)
        if okS and valid(s) then o.boxSlot = s end
    end
    w:AddToViewport(z)
    pcall(function() bar:SetPercent(1) end)
    pcall(function() bar:SetFillColorAndOpacity(color) end)
    pcall(function() w.BoostIconBarImage:SetVisibility(VIS_HIDDEN) end)
    Track(w)
    return o
end

local function LayoutSolid(o, x, y, w, h)
    if not (o and valid(o.w)) then return end
    w, h = math.max(1, w), math.max(1, h)
    PlaceWidget(o.w, x, y, w, h)
    if valid(o.sizeBox) then
        pcall(function()
            o.sizeBox:SetWidthOverride(w)
            o.sizeBox:SetHeightOverride(h)
        end)
    end
    if valid(o.boxSlot) then
        local s = o.boxSlot
        pcall(function() s:SetAnchors({Minimum = {X = 0, Y = 0}, Maximum = {X = 0, Y = 0}}) end)
        pcall(function() s:SetAlignment({X = 0, Y = 0}) end)
        pcall(function() s:SetAutoSize(false) end)
        pcall(function() s:SetPosition({X = 0, Y = 0}) end)
        pcall(function() s:SetSize({X = w, Y = h}) end)
    end
end

-- A text label. Its text is set once, in the same frame it is created, and never changed.
local function MakeLabel(text, size, color, x, y, w, z)
    local c = ui.ctx
    local l = c.Lib:Create(c.PC, c.textCls, c.PC)
    if not valid(l) then log("text Create failed") return nil end
    local okT, tb = pcall(function() return l.ChatLogLabelTextBlock end)
    if not (okT and valid(tb)) then log("ChatLogLabelTextBlock not readable") return nil end
    if valid(c.fontSrc) then
        local src = c.fontSrc
        pcall(function() tb.Font.FontObject = src.Font.FontObject end)
        pcall(function() tb.Font.TypefaceFontName = src.Font.TypefaceFontName end)
    end
    pcall(function() tb.Font.Size = size end)
    pcall(function()
        tb.Font.OutlineSettings.OutlineSize = 2
        tb.Font.OutlineSettings.OutlineColor = {R = 0, G = 0, B = 0, A = 1}
    end)
    l:AddToViewport(z)
    -- set AFTER AddToViewport: the widget's construct writes its default "Chat Log" text
    pcall(function() tb:SetText(FText(text)) end)
    pcall(function() tb:SetJustification(0) end)
    pcall(function() tb:SetColorAndOpacity({SpecifiedColor = color, ColorUseRule = 0}) end)
    PlaceWidget(l, x, y, w, math.floor(size * 1.6 + 0.5))
    Track(l)
    return l
end

-- A label whose RIGHT edge sits at `right` (the widget ignores text justification, so the
-- text is measured and the widget moved left by its width).
local function MakeLabelRight(text, size, color, right, y, z)
    local l = MakeLabel(text, size, color, right - 200, y, 200, z)
    if not valid(l) then return nil end
    local w = nil
    pcall(function()
        local tb = l.ChatLogLabelTextBlock
        tb:ForceLayoutPrepass()
        local d = tb:GetDesiredSize()
        if d.X and d.X > 0 then w = math.ceil(d.X) end
    end)
    w = w or math.floor(#text * size * 0.55 + 0.5)      -- estimate if it can't be measured
    PlaceWidget(l, right - w, y, w + 2, math.floor(size * 1.6 + 0.5))
    return l
end

-- Sets a named label to `text`; if it differs, the old widget is replaced by a new one.
local function SetLabel(key, text, size, color, x, y, w, z)
    local cur = ui.labels[key]
    if cur and valid(cur.w) and cur.text == text then return end
    if cur then Untrack(cur.w) end
    ui.labels[key] = {w = MakeLabel(text, size, color, x, y, w, z), text = text}
end

-- ---------------------------------------------------------------- menu

local function DestroyUI()
    slide = nil
    if not ui then return end
    for _, w in ipairs(ui.widgets) do
        if valid(w) then pcall(function() w:RemoveFromViewport() end) end
    end
    ui = nil
    rects = {}
end

local function AnyPending()
    for _, e in ipairs(entries) do
        if e.on ~= e.loadedOn then return true end
    end
    return false
end

local function ItemState(it)
    if it.kind == "mod" then return it.entry.on, it.entry.on ~= it.entry.loadedOn end
    return ModSettings.Get(it.setting.key, it.setting.default), false
end

-- The switch at the right end of row i: a track (green on / grey off / amber = mod change not
-- applied yet) with a knob on the right (on) or left (off). Drawn again whenever it changes.
-- A choice setting shows its current choice (in its own colour) where the switch would be.
local function DrawChoice(i, s)
    local n = ModSettings.GetNum(s.key, s.default)
    if not s.choices[n] then n = s.default end
    local ch = s.choices[n]
    local cur = ui.switches[i]
    if cur and cur.look == ch.name then return end
    if cur and cur.label then Untrack(cur.label) end
    local label = MakeLabelRight(ch.name, TEXT_SIZE, ch.color, MENU_X + PANEL_W - PAD_X, ui.rowY[i], 1003)
    ui.switches[i] = {label = label, look = ch.name}
end

-- An action setting shows its current value where the switch would be (e.g. the chosen key,
-- read from a file its mod keeps in its own folder), else what to press.
local function ShownValue(s)
    if not (s.showsFile and modsDir) then return nil end
    local f = io.open(modsDir .. s.showsFile, "r")
    if not f then return nil end
    local v = f:read("*l")
    f:close()
    if v and v:match("%S") then return v:match("^%s*(.-)%s*$") end
    return nil
end

local function DrawAction(i, s)
    local shown = ShownValue(s)
    local text, color = shown or s.action, shown and WHITE or GREY
    local cur = ui.switches[i]
    if cur and cur.look == text then return end
    if cur and cur.label then Untrack(cur.label) end
    local label = MakeLabelRight(text, TEXT_SIZE, color, MENU_X + PANEL_W - PAD_X, ui.rowY[i], 1003)
    ui.switches[i] = {label = label, look = text}
end

local function DrawSwitch(i)
    local it = items[i]
    if not (ui and it and ui.rowY[i]) then return end
    if it.kind == "setting" and it.setting.choices then DrawChoice(i, it.setting) return end
    if it.kind == "setting" and it.setting.action then DrawAction(i, it.setting) return end
    local on, pending = ItemState(it)
    local look = (on and "1" or "0") .. (pending and "p" or "")
    local cur = ui.switches[i]
    if cur and cur.look == look then return end
    if cur then
        if cur.track then Untrack(cur.track.w) end
        if cur.knob then Untrack(cur.knob.w) end
    end
    local x = MENU_X + PANEL_W - PAD_X - SWITCH_W
    local y = ui.rowY[i] + math.floor((ROW_H - SWITCH_H) / 2) - 3
    local trackColor = pending and SWITCH_PENDING or (on and SWITCH_ON or SWITCH_OFF)
    local track = MakeSolid(trackColor, 1002)
    LayoutSolid(track, x, y, SWITCH_W, SWITCH_H)
    local gap = math.floor((SWITCH_H - KNOB) / 2)
    local knob = MakeSolid(KNOB_COLOR, 1003)
    LayoutSolid(knob, on and (x + SWITCH_W - gap - KNOB) or (x + gap), y + gap, KNOB, KNOB)
    ui.switches[i] = {track = track, knob = knob, look = look}
end

local function RefreshHint()
    if not ui then return end
    local text, color = "Up/Down  select     End  switch     Home  close", GREY
    if AnyPending() then text, color = "*  mods change after Ctrl+R  (settings apply at once)", PENDING_COLOR end
    SetLabel("hint", text, HINT_SIZE, color, MENU_X + PAD_X, ui.hintY, PANEL_W - 2 * PAD_X, 1003)
end

local function MoveHilite()
    if not (ui and ui.hilite and ui.rowY[cursor]) then return end
    local inset = LINE_THICK + 4
    LayoutSolid(ui.hilite, MENU_X + inset, ui.rowY[cursor] - 3, PANEL_W - 2 * inset, ROW_H - 2)
end

local function BuildUI()
    DestroyUI()
    local PC = GetPC()
    if not PC then log("no player controller yet") return false end
    local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    if not valid(Lib) then log("widget library not found") return false end
    local panelCls = FindOrLoad(PANEL_PATH, PANEL_ASSET)
    local textCls = FindOrLoad(TEXT_PATH, TEXT_ASSET)
    if not (panelCls and textCls) then return false end
    ui = {
        ctx = {PC = PC, Lib = Lib, panelCls = panelCls, textCls = textCls, fontSrc = StaticFindObject(FONT_SRC)},
        widgets = {}, labels = {}, switches = {}, rowY = {},
    }

    -- vertical layout: title, divider, mod rows, SETTINGS header, divider, setting rows, hint
    local x, y = MENU_X, MENU_Y
    local titleH = math.floor(TITLE_SIZE * 1.6 + 0.5)
    local sectionH = math.floor(SECTION_SIZE * 1.6 + 0.5)
    local div1 = y + PAD_Y + titleH + 2
    local cy = div1 + 10
    local idx = 0
    for _ = 1, #entries do idx = idx + 1 ui.rowY[idx] = cy cy = cy + ROW_H end
    local noMods = (#entries == 0)
    if noMods then cy = cy + ROW_H end
    local sectionY = cy + 8
    local div2 = sectionY + sectionH
    cy = div2 + 10
    for _ = 1, #SETTINGS do idx = idx + 1 ui.rowY[idx] = cy cy = cy + ROW_H end
    ui.hintY = cy + 4
    local h = ui.hintY + math.floor(HINT_SIZE * 1.6 + 0.5) + PAD_Y - y
    local t = LINE_THICK

    -- panel: fill, highlight, four edges, two dividers
    LayoutSolid(MakeSolid(FILL_COLOR, 1000), x, y, PANEL_W, h)
    ui.hilite = MakeSolid(HILITE_COLOR, 1001)
    for _, r in ipairs({{x, y, PANEL_W, t}, {x, y + h - t, PANEL_W, t}, {x, y, t, h}, {x + PANEL_W - t, y, t, h},
                        {x + PAD_X, div1, PANEL_W - 2 * PAD_X, 1}, {x + PAD_X, div2, PANEL_W - 2 * PAD_X, 1}}) do
        LayoutSolid(MakeSolid(LINE_COLOR, 1002), r[1], r[2], r[3], r[4])
    end

    -- texts
    local textW = PANEL_W - 2 * PAD_X - SWITCH_W - 10
    MakeLabel("MODS", TITLE_SIZE, WHITE, x + PAD_X, y + PAD_Y, PANEL_W - 2 * PAD_X, 1003)
    MakeLabelRight(SIGNATURE, SIGNATURE_SIZE, LINE_COLOR, x + PANEL_W - PAD_X,
        y + PAD_Y + math.floor((TITLE_SIZE - SIGNATURE_SIZE) * 1.1 + 0.5), 1003)
    if noMods then MakeLabel("No mods to show", TEXT_SIZE, GREY, x + PAD_X, div1 + 10, textW, 1003) end
    MakeLabel("SETTINGS", SECTION_SIZE, LINE_COLOR, x + PAD_X, sectionY, textW, 1003)
    for i, it in ipairs(items) do
        local name = it.kind == "mod" and (DISPLAY[it.entry.name] or it.entry.name) or it.setting.label
        MakeLabel(name, TEXT_SIZE, WHITE, x + PAD_X, ui.rowY[i], textW, 1003)
        DrawSwitch(i)
    end
    RefreshHint()
    MoveHilite()
    log("menu built (" .. #entries .. " mods, " .. #SETTINGS .. " settings, " .. #ui.widgets .. " widgets)")
    return true
end

-- ---------------------------------------------------------------- slide-in

local function SetSlide(dx)
    slideX = dx
    for w, r in pairs(rects) do
        if valid(w) then
            pcall(function() w:SetPositionInViewport({X = r.x + dx, Y = r.y}, false) end)
        end
    end
end

-- Real time from the engine (os.clock runs fast in-game, so it is not used for timing).
local function Now()
    if not valid(GS) then GS = StaticFindObject("/Script/Engine.Default__GameplayStatics") end
    local ok, t = pcall(function() return GS:GetRealTimeSeconds(GetPC()) end)
    if ok and type(t) == "number" then return t end
    return nil
end

local function SlideStep()
    if not slide then return end
    if not ui then slide = nil return end
    local now = Now()
    if not now then pcall(SetSlide, 0) slide = nil return end
    local t = math.min(1, (now - slide.start) / SLIDE_SECS)
    local eased = 1 - (1 - t) ^ 3                               -- ease-out cubic
    local ok = pcall(SetSlide, -slide.dist * (1 - eased))
    if not ok or t >= 1 then
        pcall(SetSlide, 0)
        slide = nil
    end
end

local function StartSlide()
    local start = Now()
    if not start or not FrameTick.IsRunning() then SetSlide(0) return end
    local dist = MENU_X + PANEL_W + 40
    SetSlide(-dist)
    slide = {start = start, dist = dist}
end

-- ---------------------------------------------------------------- actions

local function Open()
    if ReadModsTxt() then ParseEntries(true) end
    ModSettings.Load()
    BuildItems()
    if cursor > #items then cursor = #items end
    if cursor < 1 then cursor = 1 end
    slideX = -(MENU_X + PANEL_W + 40)          -- build off-screen, then slide in
    local ok, res = pcall(BuildUI)
    if not ok then log("ERROR building menu: " .. tostring(res)) DestroyUI() return end
    if not res then DestroyUI() return end
    isOpen = true
    local okS, eS = pcall(StartSlide)
    if not okS then log("ERROR slide: " .. tostring(eS)) SetSlide(0) end
end

local function Close()
    isOpen = false
    DestroyUI()
    slideX = 0
end

local function Move(d)
    if not (isOpen and ui) or #items == 0 then return end
    cursor = ((cursor - 1 + d) % #items) + 1
    MoveHilite()
end

local function SwitchMod()
    if not ReadModsTxt() then return end      -- re-read so outside edits aren't overwritten
    local count = #entries
    ParseEntries(true)
    if #entries ~= count then Open() return end   -- list changed outside the game: rebuild
    BuildItems()
    local it = items[cursor]
    local e = it and it.entry
    if not e then return end
    e.on = not e.on
    lines[e.lineIndex] = e.name .. " : " .. (e.on and "1" or "0")
    if WriteModsTxt() then
        log(e.name .. " -> " .. (e.on and "ON" or "OFF") .. " (Ctrl+R to apply)")
    end
end

local function SwitchSetting(s)
    ModSettings.Load()
    if s.action then
        local n = ModSettings.GetNum(s.key, 0) + 1
        if ModSettings.SetNum(s.key, n) then
            log("action " .. s.key .. " (" .. n .. ")")
        else
            log("cannot write " .. ModSettings.FILE)
        end
        return
    end
    if s.choices then
        local n = ModSettings.GetNum(s.key, s.default) % #s.choices + 1
        if ModSettings.SetNum(s.key, n) then
            log("setting " .. s.key .. " -> " .. s.choices[n].name)
        else
            log("cannot write " .. ModSettings.FILE)
        end
        return
    end
    local on = not ModSettings.Get(s.key, s.default)
    if ModSettings.Set(s.key, on) then
        log("setting " .. s.key .. " -> " .. (on and "ON" or "OFF"))
    else
        log("cannot write " .. ModSettings.FILE)
    end
end

local function Switch()
    if not (isOpen and ui) then return end
    local it = items[cursor]
    if not it then return end
    if it.kind == "mod" then SwitchMod() else SwitchSetting(it.setting) end
    -- an action hands the keyboard to its mod (e.g. "press a key"): close the menu
    if it.kind == "setting" and it.setting.action then Close() return end
    if not ui then return end                 -- rebuilt or closed meanwhile
    DrawSwitch(cursor)
    RefreshHint()
end

-- ---------------------------------------------------------------- startup

-- Hot reload leaves the old menu on screen; remove every widget tagged as the menu's
-- (including the text widgets older versions of this menu used).
local function RemoveOldMenus()
    local n = 0
    for _, cls in ipairs({"w_chat_log_label_bpw_C", "w_hud_playerID_C", "StackableProgressBar_C"}) do
        local list = FindAllOf(cls)
        if list then
            for _, w in ipairs(list) do
                local okV, inVp = pcall(function() return w:IsInViewport() end)
                local okO, op = pcall(function() return w.RenderOpacity end)
                if okV and inVp and okO and op and math.abs(op - TAG_OPACITY) < 0.0005 then
                    if pcall(function() w:RemoveFromViewport() end) then n = n + 1 end
                end
            end
        end
    end
    if n > 0 then log("removed " .. n .. " old menu widget(s) from a previous load") end
end

-- BehemothHealthBars removes its own widgets when it loads. If it was just switched off it
-- won't load, so its leftovers are removed here (untagged widgets; other mods tag theirs 0.99x).
local function CleanupDisabled()
    if not ReadModsTxt() then return end
    for _, line in ipairs(lines) do
        local name, val = line:match("^%s*(.-)%s*:%s*([01])%s*$")
        if name == "BehemothHealthBars" and val == "0" then
            for _, cls in ipairs({"StackableProgressBar_C", "w_chat_log_label_bpw_C"}) do
                local list = FindAllOf(cls)
                if list then
                    for _, w in ipairs(list) do
                        local okV, inVp = pcall(function() return w:IsInViewport() end)
                        local okO, op = pcall(function() return w.RenderOpacity end)
                        local tagged = okO and type(op) == "number" and op > 0.99 and op < 0.9995
                        if okV and inVp and not tagged then pcall(function() w:RemoveFromViewport() end) end
                    end
                end
            end
            log("BehemothHealthBars is off - removed its leftover widgets")
        end
    end
end

modsDir = FindModsDir()
log("mods folder: " .. modsDir)
if ReadModsTxt() then ParseEntries(false) end
BuildItems()
log(#entries .. " mods shown (built-in UE4SS mods hidden), " .. #SETTINGS .. " settings")

pcall(function()
    ExecuteInGameThread(function()
        pcall(RemoveOldMenus)
        pcall(CleanupDisabled)
    end)
end)

-- Key callbacks arrive on UE4SS's input thread. They only add the action to a plain Lua list;
-- the per-frame FrameTick (game thread) runs it. Nothing is handed to ExecuteInGameThread, so a
-- hot reload (Ctrl+R) can never leave a queued call pointing into an unloaded script - that
-- crashed the game. Without FrameTick (no HUD yet) the action runs directly.
local pending = {}

local function RunPending()
    while #pending > 0 do
        local a = table.remove(pending, 1)
        local okF, eF = pcall(a.fn)
        if not okF then log("ERROR " .. a.key .. ": " .. tostring(eF)) end
    end
end

local function Bind(keyName, fn)
    local k = Key[keyName]
    if k == nil then log("key name not valid in this UE4SS: " .. keyName) return end
    local ok, err = pcall(function()
        RegisterKeyBind(k, function()
            if FrameTick.IsRunning() then
                if #pending < 8 then pending[#pending + 1] = {key = keyName, fn = fn} end
            else
                local okF, eF = pcall(fn)
                if not okF then log("ERROR " .. keyName .. ": " .. tostring(eF)) end
            end
        end)
    end)
    if not ok then log("ERROR binding " .. keyName .. ": " .. tostring(err)) end
end

local function Up() Move(-1) end
local function Down() Move(1) end

Bind("HOME", function() if isOpen then Close() else Open() end end)
Bind("UP_ARROW", Up)
Bind("DOWN_ARROW", Down)
Bind("PAGE_UP", Up)
Bind("PAGE_DOWN", Down)
Bind("END", Switch)

FrameTick.Every(0, "menu", function()
    RunPending()
    SlideStep()
end)
FrameTick.Start(log, "ModMenu")

log("ModMenu loaded. Home = open/close")
