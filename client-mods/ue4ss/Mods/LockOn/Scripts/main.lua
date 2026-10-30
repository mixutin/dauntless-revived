print("[LOCK] LockOn loading...")
local FrameTick = require("FrameTick")
-- The Mod Menu's "Lock-on: change key" row counts its presses in lock_rebind.
local ModSettings = require("ModSettings")

-- Lock-on, Elden Ring style: the middle mouse button (R3 on a gamepad) locks the camera onto the
-- behemoth you are looking at, and a white dot marks it; press again to unlock. While locked the mouse no longer
-- turns the camera and the character faces the behemoth, so attacks go at it and A/D circle it.
-- Steering backwards (S, A+S, D+S) lets the character turn and run that way naturally, since the
-- game has no backpedal animations for most weapons. Local only: your own camera and facing.
--
-- Same building blocks as BehemothTracker (verified there in UE4SS_ObjectDump.txt):
--   targets : FindAllOf("ArchonBehemoth"), Actor:K2_GetActorLocation, GetCurrentHealth
--   camera  : ArchonPlayerController:GetControlRotation / SetControlRotation,
--             PlayerCameraManager:GetCameraLocation
--   marker  : StackableProgressBar_C.BoostIconBarImage with a ring texture, tagged by RenderOpacity
--   ticks   : Mods\shared\FrameTick (every frame, game thread)
--   input   : Controller:SetIgnoreLookInput / ResetIgnoreLookInput (mouse look off while locked)
--   facing  : Character.CharacterMovement.bOrientRotationToMovement / bUseControllerDesiredRotation

-- ---------------------------------------------------------------- settings

-- Two lock keys (Unreal key names), both always work: one for keyboard and mouse, one for gamepads.
local DEFAULT_KEY = "MiddleMouseButton"        -- keyboard/mouse, until the player picks another
local DEFAULT_PAD_KEY = "Gamepad_RightThumbstick" -- gamepad: R3 (right stick click)
local KEY_FILE = "ue4ss/Mods/LockOn/key.txt"   -- the chosen keys' Unreal names (keyboard, then pad), kept on this PC
local LABEL_FILE = "ue4ss/Mods/LockOn/key_label.txt" -- their readable names, shown by the Mod Menu
local TEXT_PATH = "/Game/UI/Chat/w_chat_log_label_bpw.w_chat_log_label_bpw_C"
local FONT_SRC = "/Game/UI/HUD/HealthStamina_bpw.HealthStamina_bpw_C:WidgetTree.HealthValueText"
local PROMPT_SIZE = 20
local MAX_LOCK_M = 80          -- only behemoths closer than this can be locked
local BREAK_M = 120            -- the lock breaks beyond this
local PICK_CONE_DEG = 45       -- how far from the centre of the view a behemoth may be to be picked
local TURN_SPEED = 14          -- how fast the camera turns to the target (higher = snappier)
local AIM_UP_CM = 150          -- fallback only: above the actor's root when its bounds are unknown
local TOGGLE_GAP = 0.35        -- seconds: a second click sooner than this is the same click
local BACK_ON = -0.35          -- steering this much backwards (vs the camera) = run that way
local BACK_OFF = -0.15         -- ...and back to facing the behemoth above this (no flicker)
local PITCH_BIAS = -6          -- degrees: look slightly down so the target sits above the middle
local DOT_SIZE = 11            -- solid white disc (pixels)
local GLOW_SIZE = 15           -- faint ring around it, a slight glow
local DOT_COLOR = {R = 1, G = 1, B = 1, A = 1}
local GLOW_COLOR = {R = 1, G = 1, B = 1, A = 0.35}
-- Bones to aim at, best first (matched as parts of the skeleton's bone names).
local AIM_BONES = {"chest", "spine_03", "spine3", "spine_02", "spine2", "spine", "torso", "body", "pelvis", "hips"}
local TAG = 0.993              -- RenderOpacity tag of this mod's widgets

local IMG_PATH = "/Game/UI/EndOfHunt/StackableProgressBar.StackableProgressBar_C"
local RING_TEXTURES = {
    "/Game/UI/Textures/Icons/skyfishing/ui_thin_white_ring.ui_thin_white_ring",
    "/Game/UI/Materials/WhiteRing.WhiteRing",
    "/Game/UI/Textures/Icons/Menu/EmptyCircle.EmptyCircle",
}
local VIS_SHOWN, VIS_HIDDEN = 3, 1

-- ---------------------------------------------------------------- state

local target = nil             -- locked behemoth
local held = nil               -- what the lock changed: {pc, move, orient, desired}
-- Written while locked, so a Ctrl+R reload in the middle of a lock can give mouse look and the
-- normal facing back (the new script cannot know what the old one changed otherwise).
local FLAG_FILE = "ue4ss/Mods/LockOn/locked.flag"
local dot = nil                -- {widgets = {...}, shown = bool}
local lastT = nil
local errLogged = {}

local function log(m) print("[LOCK] " .. tostring(m)) end
local function logOnce(k, m) if not errLogged[k] then errLogged[k] = true log(m) end end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

local function GetPC()
    local list = FindAllOf("ArchonPlayerController")
    local PC = list and list[1]
    if valid(PC) then return PC end
    return nil
end

local function FindOrLoad(path)
    local o = StaticFindObject(path)
    if valid(o) then return o end
    pcall(function() LoadAsset((path:gsub("%.[^./]+$", ""))) end)
    o = StaticFindObject(path)
    if valid(o) then return o end
    return nil
end

local function NormDeg(a)
    a = a % 360
    if a > 180 then a = a - 360 end
    return a
end

local function Alive(b)
    if not valid(b) then return false end
    local ok, hp = pcall(function() return b:GetCurrentHealth() end)
    return not (ok and type(hp) == "number" and hp <= 0)
end

local function CameraLocation(PC)
    local ok, loc = pcall(function() return PC.PlayerCameraManager:GetCameraLocation() end)
    if ok and loc then return {X = loc.X, Y = loc.Y, Z = loc.Z} end
    local okP, pawn = pcall(function() return PC:K2_GetPawn() end)
    if okP and valid(pawn) then
        local okL, l = pcall(function() return pawn:K2_GetActorLocation() end)
        if okL and l then return {X = l.X, Y = l.Y, Z = l.Z} end
    end
    return nil
end

local AimPointRoot             -- defined below, used as the last fallback
local boneFor = {}             -- behemoth full name -> chosen bone name (false = none found)

local function MeshOf(b)
    local ok, m = pcall(function() return b.Mesh end)
    if ok and valid(m) then return m end
    return nil
end

-- Picks a body bone once per behemoth and logs the skeleton, so the choice can be tuned.
local function ChooseBone(b, mesh)
    local key = "?"
    pcall(function() key = b:GetFullName() end)
    if boneFor[key] ~= nil then return boneFor[key] end
    local names = {}
    local okN, n = pcall(function() return mesh:GetNumBones() end)
    if okN and type(n) == "number" then
        for i = 0, n - 1 do
            local okB, nm = pcall(function() return mesh:GetBoneName(i):ToString() end)
            if okB and nm then names[#names + 1] = nm end
        end
    end
    local chosen = false
    for _, want in ipairs(AIM_BONES) do
        for _, nm in ipairs(names) do
            if nm:lower():find(want, 1, true) then chosen = nm break end
        end
        if chosen then break end
    end
    boneFor[key] = chosen
    log(string.format("skeleton: %d bones, aiming at %s", #names, chosen or "the mesh bounds"))
    if #names > 0 then log("bones: " .. table.concat(names, ", ", 1, math.min(#names, 80))) end
    return chosen
end

local function BoundsCenter(obj, isActor)
    local origin, extent = {}, {}
    local ok
    if isActor then
        ok = pcall(function() obj:GetActorBounds(false, origin, extent, false) end)
        if not (ok and type(origin.X) == "number") then
            origin, extent = {}, {}
            ok = pcall(function() obj:GetActorBounds(false, origin, extent) end)
        end
    else
        local K = StaticFindObject("/Script/Engine.Default__KismetSystemLibrary")
        local radius = {}
        ok = valid(K) and pcall(function() K:GetComponentBounds(obj, origin, extent, radius) end)
    end
    if ok and type(origin.X) == "number" then return {X = origin.X, Y = origin.Y, Z = origin.Z} end
    return nil
end

-- A point on the behemoth's body that follows its animation (a leap moves the mesh, while the
-- actor's root can stay on the ground): a body bone, else the mesh bounds, else the actor bounds.
local function AimPoint(b)
    local mesh = MeshOf(b)
    if mesh then
        local bone = ChooseBone(b, mesh)
        if bone then
            local ok, l = pcall(function() return mesh:GetSocketLocation(FName(bone)) end)
            if ok and l then return {X = l.X, Y = l.Y, Z = l.Z} end
        end
        local c = BoundsCenter(mesh, false)
        if c then return c end
    end
    local c = BoundsCenter(b, true)
    if c then return c end
    return AimPointRoot(b)
end

AimPointRoot = function(b)
    logOnce("bounds", "no bone or bounds: aiming above the actor's root")
    local okL, l = pcall(function() return b:K2_GetActorLocation() end)
    if not (okL and l) then return nil end
    return {X = l.X, Y = l.Y, Z = l.Z + AIM_UP_CM}
end

-- Yaw/pitch (degrees) from a to b, and the distance in metres.
local function LookAt(a, b)
    local dx, dy, dz = b.X - a.X, b.Y - a.Y, b.Z - a.Z
    local flat = math.sqrt(dx * dx + dy * dy)
    return math.deg(math.atan(dy, dx)), math.deg(math.atan(dz, flat)), math.sqrt(flat * flat + dz * dz) / 100
end

-- ---------------------------------------------------------------- marker dot

local function DestroyDot()
    if dot then
        for _, w in ipairs(dot.widgets) do
            if valid(w) then pcall(function() w:RemoveFromViewport() end) end
        end
    end
    dot = nil
end

local function FirstTexture(list)
    for _, p in ipairs(list) do
        local t = FindOrLoad(p)
        if t then return t, p:match("%.([%w_]+)$") end
    end
    return nil
end

-- One image widget (StackableProgressBar_C with its bar hidden), centred on its position.
local function MakeImage(PC, Lib, cls, tex, size, color, z)
    local w = Lib:Create(PC, cls, PC)
    if not valid(w) then return nil end
    local okI, img = pcall(function() return w.BoostIconBarImage end)
    local okB, bar = pcall(function() return w.ProgressBarComponent end)
    w:AddToViewport(z)
    if okB and valid(bar) then pcall(function() bar:GetParent():SetVisibility(VIS_HIDDEN) end) end
    if okI and valid(img) then
        pcall(function() img:SetBrushResourceObject(tex) end)
        pcall(function() img:SetBrushSize({X = size, Y = size}) end)
        pcall(function() img:SetColorAndOpacity(color) end)
        pcall(function() img:SetVisibility(VIS_SHOWN) end)
        pcall(function()
            local slot = img.Slot
            slot:SetAnchors({Minimum = {X = 0, Y = 0}, Maximum = {X = 0, Y = 0}})
            slot:SetAlignment({X = 0, Y = 0})
            slot:SetAutoSize(false)
            slot:SetPosition({X = 0, Y = 0})
            slot:SetSize({X = size, Y = size})
        end)
    end
    pcall(function() w:SetRenderOpacity(TAG) end)
    return w
end

-- A solid white disc with a faint ring around it. Built from the transparent ring texture, one
-- ring per pixel of radius so they fill the disc with no gaps (the game's filled-circle textures
-- have no alpha and show black square corners).
local function CreateDot(PC)
    DestroyDot()
    local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    local cls = FindOrLoad(IMG_PATH)
    if not (valid(Lib) and cls) then logOnce("cls", "widget classes not found") return end
    local ring, ringName = FirstTexture(RING_TEXTURES)
    if not ring then logOnce("tex", "no ring texture found") return end
    logOnce("dottex", "dot texture: " .. tostring(ringName))
    local d = {widgets = {}, sizes = {}, shown = true}
    local function add(size, color, z)
        local w = MakeImage(PC, Lib, cls, ring, size, color, z)
        if w then d.widgets[#d.widgets + 1] = w d.sizes[#d.sizes + 1] = size end
    end
    add(GLOW_SIZE, GLOW_COLOR, 1101)
    for size = DOT_SIZE, 2, -1 do add(size, DOT_COLOR, 1102) end
    dot = d
end

local function ShowDot(s)
    if not dot or dot.shown == s then return end
    for _, w in ipairs(dot.widgets) do
        if valid(w) then pcall(function() w:SetVisibility(s and VIS_SHOWN or VIS_HIDDEN) end) end
    end
    dot.shown = s
end

-- Screen pixel position of a world point, or nil when it is behind the camera / unknown.
local function ToScreen(PC, p)
    local out = {}
    local ok, onScreen = pcall(function()
        return PC:ProjectWorldLocationToScreen({X = p.X, Y = p.Y, Z = p.Z}, out, false)
    end)
    if ok and onScreen and type(out.X) == "number" then return out.X, out.Y end
    if not ok then logOnce("proj", "ProjectWorldLocationToScreen failed: " .. tostring(onScreen)) end
    return nil
end

local function PlaceDot(PC, p)
    if not dot then CreateDot(PC) end
    if not dot then return end
    local x, y = ToScreen(PC, p)
    if not x then ShowDot(false) return end
    for i, w in ipairs(dot.widgets) do
        if valid(w) then
            local size = dot.sizes[i]
            pcall(function()
                w:SetPositionInViewport({X = x, Y = y}, true)   -- pixels, like BehemothTracker
                w:SetDesiredSizeInViewport({X = size, Y = size})
                w:SetAlignmentInViewport({X = 0.5, Y = 0.5})
            end)
        end
    end
    ShowDot(true)
end

-- ---------------------------------------------------------------- lock / unlock

local function SetFlag(on)
    if on then
        local f = io.open(FLAG_FILE, "w")
        if f then f:write("locked\n") f:close() end
    else
        os.remove(FLAG_FILE)
    end
end

local function Movement(PC)
    local okP, pawn = pcall(function() return PC:K2_GetPawn() end)
    if not (okP and valid(pawn)) then return nil end
    local okM, move = pcall(function() return pawn.CharacterMovement end)
    if okM and valid(move) then return move end
    return nil
end

-- Mouse look off, and the character turns with the camera (which faces the target) instead of
-- towards where it walks: A/D then strafe sideways around the behemoth.
local function TakeOver(PC)
    held = {pc = PC}
    pcall(function() PC:SetIgnoreLookInput(true) end)
    local move = Movement(PC)
    if move then
        held.move = move
        pcall(function() held.orient = move.bOrientRotationToMovement end)
        pcall(function() held.desired = move.bUseControllerDesiredRotation end)
        held.facing = nil
    else
        logOnce("move", "no CharacterMovement on the pawn: the character keeps its own facing")
    end
    SetFlag(true)
end

local function GiveBack()
    if held then
        if valid(held.pc) then pcall(function() held.pc:ResetIgnoreLookInput() end) end
        if valid(held.move) then
            pcall(function() held.move.bOrientRotationToMovement = held.orient ~= false end)
            pcall(function() held.move.bUseControllerDesiredRotation = held.desired == true end)
        end
    end
    held = nil
    SetFlag(false)
end

-- Faces the behemoth, except while steering backwards (S, A+S, D+S): then the game's own facing,
-- towards where you run. Read from the movement input, not the keys, so rebinds and gamepads work
-- and W+S (no input) counts as standing. Two thresholds so it does not flicker.
local function Facing(PC, camYaw)
    if not (held and valid(held.move)) then return end
    local okP, pawn = pcall(function() return PC:K2_GetPawn() end)
    if not (okP and valid(pawn)) then return end
    local okI, v = pcall(function() return pawn:GetLastMovementInputVector() end)
    if not (okI and v) then return end
    local len = math.sqrt(v.X * v.X + v.Y * v.Y)
    local fwd = 0
    if len > 0.1 then
        local r = math.rad(camYaw)
        fwd = (v.X * math.cos(r) + v.Y * math.sin(r)) / len   -- 1 = W, -1 = S, 0 = A/D
    end
    local want = held.facing
    if len <= 0.1 or fwd > BACK_OFF then want = "target" elseif fwd < BACK_ON then want = "run" end
    want = want or "target"
    if want == held.facing then return end
    held.facing = want
    local face = want == "target"
    pcall(function() held.move.bOrientRotationToMovement = not face end)
    pcall(function() held.move.bUseControllerDesiredRotation = face end)
end

local function Unlock(why)
    if target then log("unlocked (" .. why .. ")") end
    target = nil
    GiveBack()
    ShowDot(false)
end

-- The behemoth nearest to the centre of the view, within reach.
local function PickTarget(PC)
    local cam = CameraLocation(PC)
    local okR, rot = pcall(function() return PC:GetControlRotation() end)
    if not (cam and okR and rot) then return nil end
    local best, bestAngle = nil, PICK_CONE_DEG
    for _, b in ipairs(FindAllOf("ArchonBehemoth") or {}) do
        if Alive(b) then
            local p = AimPoint(b)
            if p then
                local yaw, pitch, dist = LookAt(cam, p)
                if dist <= MAX_LOCK_M then
                    local dy = NormDeg(yaw - rot.Yaw)
                    local dp = NormDeg(pitch - rot.Pitch)
                    local angle = math.sqrt(dy * dy + dp * dp)
                    if angle < bestAngle then best, bestAngle = b, angle end
                end
            end
        end
    end
    return best
end

local lastToggle = -1e9

local function Toggle()
    -- One click sometimes arrives twice: lock and unlock in the same click looked like nothing.
    local now = os.clock()
    if now - lastToggle < TOGGLE_GAP then return end
    lastToggle = now
    if target then Unlock("key") return end
    local PC = GetPC()
    if not PC then return end
    local b = PickTarget(PC)
    if b then
        target = b
        lastT = nil
        TakeOver(PC)
        local name = "?"
        pcall(function() name = b:GetFullName() end)
        log("locked on " .. name)
    else
        log("nothing to lock on (no behemoth in view within " .. MAX_LOCK_M .. " m)")
    end
end

-- ---------------------------------------------------------------- every frame

local function Frame(t)
    if not target then lastT = t return end
    if not Alive(target) then Unlock("target gone") return end
    local PC = GetPC()
    if not PC then Unlock("no player") return end
    local cam = CameraLocation(PC)
    local p = AimPoint(target)
    if not (cam and p) then return end
    local yaw, pitch, dist = LookAt(cam, p)
    if dist > BREAK_M then Unlock("too far") return end

    if held and held.move ~= nil and not valid(held.move) then GiveBack() TakeOver(PC) end

    local dt = lastT and math.min(math.max(t - lastT, 0), 0.1) or 0.016
    lastT = t
    local okR, rot = pcall(function() return PC:GetControlRotation() end)
    if not (okR and rot) then logOnce("rot", "GetControlRotation failed") return end
    local alpha = 1 - math.exp(-TURN_SPEED * dt)
    local curPitch = NormDeg(rot.Pitch)
    local newYaw = rot.Yaw + NormDeg(yaw - rot.Yaw) * alpha
    local newPitch = curPitch + NormDeg(pitch + PITCH_BIAS - curPitch) * alpha
    local ok, err = pcall(function()
        PC:SetControlRotation({Pitch = newPitch, Yaw = newYaw, Roll = rot.Roll})
    end)
    if not ok then logOnce("set", "SetControlRotation failed: " .. tostring(err)) end

    Facing(PC, newYaw)
    PlaceDot(PC, p)
end

-- ---------------------------------------------------------------- startup

-- Ctrl+R restarts this script but leaves its old widgets on screen: remove the tagged ones.
local function RemoveOld()
    for _, cls in ipairs({"StackableProgressBar_C", "w_chat_log_label_bpw_C", "HUD_banner_bpw_C"}) do
        for _, w in ipairs(FindAllOf(cls) or {}) do
            local okV, inVp = pcall(function() return w:IsInViewport() end)
            local okO, op = pcall(function() return w.RenderOpacity end)
            if okV and inVp and okO and op and math.abs(op - TAG) < 0.0005 then
                pcall(function() w:RemoveFromViewport() end)
            end
        end
    end
end
pcall(function() ExecuteInGameThread(function() pcall(RemoveOld) end) end)

local function RestoreAfterReload()
    local f = io.open(FLAG_FILE, "r")
    if not f then return end
    f:close()
    local PC = GetPC()
    if PC then
        pcall(function() PC:ResetIgnoreLookInput() end)
        local move = Movement(PC)
        if move then
            pcall(function() move.bOrientRotationToMovement = true end)
            pcall(function() move.bUseControllerDesiredRotation = false end)
        end
    end
    SetFlag(false)
    log("reloaded during a lock: mouse look and facing given back")
end
pcall(function() ExecuteInGameThread(function() pcall(RestoreAfterReload) end) end)

-- ---------------------------------------------------------------- key choice

-- Keys are read from the game every frame (PlayerController:IsInputKeyDown with Unreal key names)
-- instead of UE4SS key binds: a held key counts once, nothing piles up on Ctrl+R, and gamepad
-- buttons work too. Normally only two keys are checked; "press a key" checks them all.
local DIGITS = {"Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"}
local KEYS = {}
for c in ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):gmatch(".") do KEYS[#KEYS + 1] = c end
for _, n in ipairs(DIGITS) do KEYS[#KEYS + 1] = n end
for _, n in ipairs(DIGITS) do KEYS[#KEYS + 1] = "NumPad" .. n end
for i = 1, 12 do KEYS[#KEYS + 1] = "F" .. i end
for _, n in ipairs({
    "MiddleMouseButton", "ThumbMouseButton", "ThumbMouseButton2", "LeftMouseButton", "RightMouseButton",
    "SpaceBar", "Tab", "CapsLock", "LeftShift", "RightShift", "LeftControl", "RightControl", "LeftAlt", "RightAlt",
    "Enter", "BackSpace", "Insert", "Delete", "Home", "End", "PageUp", "PageDown",
    "Up", "Down", "Left", "Right", "Multiply", "Add", "Subtract", "Decimal", "Divide",
    "Semicolon", "Equals", "Comma", "Hyphen", "Period", "Slash", "Tilde",
    "LeftBracket", "Backslash", "RightBracket", "Apostrophe", "Escape",
    "Gamepad_FaceButton_Bottom", "Gamepad_FaceButton_Right", "Gamepad_FaceButton_Left", "Gamepad_FaceButton_Top",
    "Gamepad_LeftShoulder", "Gamepad_RightShoulder", "Gamepad_LeftTrigger", "Gamepad_RightTrigger",
    "Gamepad_LeftThumbstick", "Gamepad_RightThumbstick", "Gamepad_Special_Left", "Gamepad_Special_Right",
    "Gamepad_DPad_Up", "Gamepad_DPad_Down", "Gamepad_DPad_Left", "Gamepad_DPad_Right",
}) do KEYS[#KEYS + 1] = n end
local KNOWN = {}
for _, k in ipairs(KEYS) do KNOWN[k] = true end

local KEY_NAMES = {
    MiddleMouseButton = "Mouse wheel", ThumbMouseButton = "Mouse 4", ThumbMouseButton2 = "Mouse 5",
    LeftMouseButton = "Left mouse", RightMouseButton = "Right mouse", SpaceBar = "Space", CapsLock = "Caps Lock",
    Gamepad_FaceButton_Bottom = "Cross (A)", Gamepad_FaceButton_Right = "Circle (B)",
    Gamepad_FaceButton_Left = "Square (X)", Gamepad_FaceButton_Top = "Triangle (Y)",
    Gamepad_LeftShoulder = "L1 (LB)", Gamepad_RightShoulder = "R1 (RB)",
    Gamepad_LeftTrigger = "L2 (LT)", Gamepad_RightTrigger = "R2 (RT)",
    Gamepad_LeftThumbstick = "L3", Gamepad_RightThumbstick = "R3",
    Gamepad_Special_Left = "Create (View)", Gamepad_Special_Right = "Options (Menu)",
    Gamepad_DPad_Up = "D-pad Up", Gamepad_DPad_Down = "D-pad Down",
    Gamepad_DPad_Left = "D-pad Left", Gamepad_DPad_Right = "D-pad Right",
}
-- Texts in the game's language (its current culture: es, es-MX, pt-BR... by the first two
-- letters), English for any other. Only what this mod shows: the banner and the key names.
local TEXTS = {
    en = {lock = "Lock-on", press = "press a key, mouse button or gamepad button (Esc cancels)",
          set = "Lock-on keys", same = "Lock-on keys unchanged",
          keys = {}},
    es = {lock = "Fijar objetivo", press = "pulsa una tecla, un botón del ratón o del mando (Esc cancela)",
          set = "Teclas de fijar objetivo", same = "Teclas de fijar objetivo sin cambios",
          keys = {MiddleMouseButton = "Rueda del ratón", ThumbMouseButton = "Ratón 4", ThumbMouseButton2 = "Ratón 5",
                  LeftMouseButton = "Clic izquierdo", RightMouseButton = "Clic derecho", SpaceBar = "Espacio",
                  CapsLock = "Bloq Mayús", Gamepad_DPad_Up = "Cruceta arriba", Gamepad_DPad_Down = "Cruceta abajo",
                  Gamepad_DPad_Left = "Cruceta izquierda", Gamepad_DPad_Right = "Cruceta derecha"}},
    de = {lock = "Zielerfassung", press = "drücke eine Taste, Maustaste oder Gamepad-Taste (Esc bricht ab)",
          set = "Tasten der Zielerfassung", same = "Tasten der Zielerfassung unverändert",
          keys = {MiddleMouseButton = "Mausrad", ThumbMouseButton = "Maus 4", ThumbMouseButton2 = "Maus 5",
                  LeftMouseButton = "Linke Maustaste", RightMouseButton = "Rechte Maustaste", SpaceBar = "Leertaste",
                  CapsLock = "Feststelltaste", Gamepad_DPad_Up = "Steuerkreuz oben", Gamepad_DPad_Down = "Steuerkreuz unten",
                  Gamepad_DPad_Left = "Steuerkreuz links", Gamepad_DPad_Right = "Steuerkreuz rechts"}},
    fr = {lock = "Verrouillage", press = "appuyez sur une touche, un bouton de souris ou de manette (Échap annule)",
          set = "Touches de verrouillage", same = "Touches de verrouillage inchangées",
          keys = {MiddleMouseButton = "Molette", ThumbMouseButton = "Souris 4", ThumbMouseButton2 = "Souris 5",
                  LeftMouseButton = "Clic gauche", RightMouseButton = "Clic droit", SpaceBar = "Espace",
                  CapsLock = "Verr. Maj", Gamepad_DPad_Up = "Croix haut", Gamepad_DPad_Down = "Croix bas",
                  Gamepad_DPad_Left = "Croix gauche", Gamepad_DPad_Right = "Croix droite"}},
    it = {lock = "Aggancio", press = "premi un tasto, un pulsante del mouse o del controller (Esc annulla)",
          set = "Tasti di aggancio", same = "Tasti di aggancio invariati",
          keys = {MiddleMouseButton = "Rotellina", ThumbMouseButton = "Mouse 4", ThumbMouseButton2 = "Mouse 5",
                  LeftMouseButton = "Clic sinistro", RightMouseButton = "Clic destro", SpaceBar = "Spazio",
                  CapsLock = "Bloc Maiusc", Gamepad_DPad_Up = "Croce su", Gamepad_DPad_Down = "Croce giù",
                  Gamepad_DPad_Left = "Croce sinistra", Gamepad_DPad_Right = "Croce destra"}},
    pt = {lock = "Travar alvo", press = "aperte uma tecla, um botão do mouse ou do controle (Esc cancela)",
          set = "Teclas de travar alvo", same = "Teclas de travar alvo sem mudanças",
          keys = {MiddleMouseButton = "Rodinha do mouse", ThumbMouseButton = "Mouse 4", ThumbMouseButton2 = "Mouse 5",
                  LeftMouseButton = "Clique esquerdo", RightMouseButton = "Clique direito", SpaceBar = "Espaço",
                  CapsLock = "Caps Lock", Gamepad_DPad_Up = "Direcional cima", Gamepad_DPad_Down = "Direcional baixo",
                  Gamepad_DPad_Left = "Direcional esquerda", Gamepad_DPad_Right = "Direcional direita"}},
    ru = {lock = "Захват цели", press = "нажмите клавишу, кнопку мыши или геймпада (Esc отменяет)",
          set = "Клавиши захвата цели", same = "Клавиши захвата цели не изменены",
          keys = {MiddleMouseButton = "Колёсико мыши", ThumbMouseButton = "Мышь 4", ThumbMouseButton2 = "Мышь 5",
                  LeftMouseButton = "Левая кнопка мыши", RightMouseButton = "Правая кнопка мыши", SpaceBar = "Пробел",
                  CapsLock = "Caps Lock", Gamepad_DPad_Up = "Крестовина вверх", Gamepad_DPad_Down = "Крестовина вниз",
                  Gamepad_DPad_Left = "Крестовина влево", Gamepad_DPad_Right = "Крестовина вправо"}},
    ja = {lock = "ロックオン", press = "キー、マウスボタン、またはゲームパッドのボタンを押してください（Esc でキャンセル）",
          set = "ロックオンのキー", same = "ロックオンのキーは変更なし",
          keys = {MiddleMouseButton = "マウスホイール", ThumbMouseButton = "マウス 4", ThumbMouseButton2 = "マウス 5",
                  LeftMouseButton = "左クリック", RightMouseButton = "右クリック", SpaceBar = "スペース",
                  CapsLock = "Caps Lock", Gamepad_DPad_Up = "方向キー上", Gamepad_DPad_Down = "方向キー下",
                  Gamepad_DPad_Left = "方向キー左", Gamepad_DPad_Right = "方向キー右"}},
}

local function Lang()
    local culture = ""
    pcall(function()
        local K = StaticFindObject("/Script/Engine.Default__KismetInternationalizationLibrary")
        culture = K:GetCurrentCulture():ToString()
    end)
    local code = culture:sub(1, 2):lower()
    return TEXTS[code] and code or "en"
end
local function Text() return TEXTS[Lang()] end

local function KeyLabel(name) return Text().keys[name] or KEY_NAMES[name] or name end
local function IsPadKey(name) return name:sub(1, 8) == "Gamepad_" end

-- Older versions stored UE4SS key names.
local OLD_NAMES = {MIDDLE_MOUSE_BUTTON = "MiddleMouseButton", XBUTTON_ONE = "ThumbMouseButton", XBUTTON_TWO = "ThumbMouseButton2"}

local function KeyName(line)
    local name = (line or ""):match("^%s*([%w_]+)")
    name = name and (OLD_NAMES[name] or name)
    if name and KNOWN[name] then return name end
    return nil
end

-- key.txt: the keyboard/mouse key on the first line, the gamepad button on the second. An older
-- one-line file holding a gamepad button keeps it as the gamepad key.
local function LoadKeys()
    local kb, pad = DEFAULT_KEY, DEFAULT_PAD_KEY
    local f = io.open(KEY_FILE, "r")
    if not f then return kb, pad end
    local a, b = KeyName(f:read("*l")), KeyName(f:read("*l"))
    f:close()
    for _, k in ipairs({a, b}) do
        if k then
            if IsPadKey(k) then pad = k else kb = k end
        end
    end
    return kb, pad
end

-- The Mod Menu shows the chosen keys by reading their readable names from LABEL_FILE.
local function SaveKeys(kb, pad)
    local f = io.open(KEY_FILE, "w")
    if f then f:write(kb .. "\n" .. pad .. "\n") f:close() end
    local l = io.open(LABEL_FILE, "w")
    if l then l:write(KeyLabel(kb) .. " / " .. KeyLabel(pad) .. "\n") l:close() end
end

local lockKey, padKey = LoadKeys()
SaveKeys(lockKey, padKey)        -- refreshes the label, and upgrades an old key file
local capturing = nil            -- {held = {...}} while waiting for "press a key"
local prompt = nil               -- {w, untilT}
local wasDown = {}               -- key name -> down last frame
local pollOk = nil               -- nil = not tried yet, true/false after the first try

local function HidePrompt()
    if prompt and valid(prompt.w) then pcall(function() prompt.w:RemoveFromViewport() end) end
    prompt = nil
end

-- The game's HUD banner (HUDBannerWidget: Title, SubText, Duration; DismissNotification plays its
-- way out). It stays up for Duration seconds, so "press a key" sets a very long one and dismisses
-- it when a key is pressed.
local BANNER_PATH = "/Game/UI/HUD/Notifications/HUD_banner_bpw.HUD_banner_bpw_C"
local FADE_TEXTURE = "/Game/UI/Textures/HUD/hud_gradientsides.hud_gradientsides"
local banner = nil

local function HideBanner()
    if banner and valid(banner) then
        local ok = pcall(function() banner:DismissNotification() end)
        if not ok then pcall(function() banner:RemoveFromViewport() end) end
    end
    banner = nil
end

local function Banner(title, sub, seconds)
    HideBanner()
    local PC = GetPC()
    local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    local cls = FindOrLoad(BANNER_PATH)
    if not (PC and valid(Lib) and cls) then logOnce("banner", "HUD banner not found: plain text prompts") return false end
    local w = Lib:Create(PC, cls, PC)
    if not valid(w) then return false end
    pcall(function() w.Duration = seconds or 100000 end)
    pcall(function() w.Title:SetText(FText(title)) end)
    pcall(function() w.SubText:SetText(FText(sub)) end)
    -- Only the text: no behemoth panel or icon.
    for _, part in ipairs({"BehemothInfoWidget", "TopIconContainer", "TopIconSpacer", "Icon"}) do
        pcall(function() w[part]:SetVisibility(VIS_HIDDEN) end)
    end
    -- Its own backing (hidden unless the HUD asks for it), with the HUD's side-fading gradient so
    -- the edges blend into the scene.
    pcall(function() w.BackgroundVisibility = VIS_SHOWN end)
    local fade = FindOrLoad(FADE_TEXTURE)
    if fade then
        -- The backing image (TitleBackground) gets the fading texture; the top and bottom lines
        -- keep the game's own metal. Found by walking the banner from its root, since
        -- GetWidgetFromName does not find it.
        local done = false
        local function Walk(o, depth)
            if done or not valid(o) or depth > 12 then return end
            local name, cls = "", ""
            pcall(function() name = o:GetFName():ToString() end)
            pcall(function() cls = o:GetClass():GetFName():ToString() end)
            if cls == "Image" and name:lower():find("background") then
                done = pcall(function() o:SetBrushFromTexture(fade, false) end)
                return
            end
            local n = 0
            pcall(function() n = o:GetChildrenCount() end)
            for i = 0, (n or 0) - 1 do
                local c = nil
                pcall(function() c = o:GetChildAt(i) end)
                Walk(c, depth + 1)
            end
        end
        local root = nil
        pcall(function() root = w.WidgetTree.RootWidget end)
        Walk(root, 0)
        if not done then logOnce("fadebg", "banner backing not found: it keeps its plain look") end
    else
        logOnce("fade", "no side-fading texture: plain banner backing")
    end
    w:AddToViewport(1200)
    -- Below the compass, in the upper middle of the screen.
    pcall(function()
        w:SetPositionInViewport({X = 0, Y = 0}, false)
        w:SetDesiredSizeInViewport({X = 1400, Y = 220})
        w:SetAnchorsInViewport({Minimum = {X = 0.5, Y = 0.26}, Maximum = {X = 0.5, Y = 0.26}})
        w:SetAlignmentInViewport({X = 0.5, Y = 0.5})
    end)
    pcall(function() w:SetRenderOpacity(TAG) end)
    banner = w
    return true
end

-- The HUD banner, else a line of text at the top middle of the screen in the HUD's font.
local function ShowPrompt(title, sub, seconds)
    HidePrompt()
    if Banner(title, sub, seconds) then return end
    local text = title .. ": " .. sub
    local PC = GetPC()
    local Lib = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    local cls = FindOrLoad(TEXT_PATH)
    if not (PC and valid(Lib) and cls) then log(text) return end
    local w = Lib:Create(PC, cls, PC)
    if not valid(w) then log(text) return end
    local okT, tb = pcall(function() return w.ChatLogLabelTextBlock end)
    if okT and valid(tb) then
        local src = StaticFindObject(FONT_SRC)
        if valid(src) then
            pcall(function() tb.Font.FontObject = src.Font.FontObject end)
            pcall(function() tb.Font.TypefaceFontName = src.Font.TypefaceFontName end)
        end
        pcall(function() tb.Font.Size = PROMPT_SIZE end)
        pcall(function()
            tb.Font.OutlineSettings.OutlineSize = 2
            tb.Font.OutlineSettings.OutlineColor = {R = 0, G = 0, B = 0, A = 1}
        end)
    end
    w:AddToViewport(1200)
    if okT and valid(tb) then
        pcall(function() tb:SetJustification(1) end)
        pcall(function() tb:SetColorAndOpacity({SpecifiedColor = {R = 1, G = 1, B = 1, A = 1}, ColorUseRule = 0}) end)
        pcall(function() tb:SetText(FText(text)) end)
    end
    pcall(function()
        w:SetPositionInViewport({X = 0, Y = 160}, true)
        w:SetDesiredSizeInViewport({X = 900, Y = 40})
        w:SetAnchorsInViewport({Minimum = {X = 0.5, Y = 0}, Maximum = {X = 0.5, Y = 0}})
        w:SetAlignmentInViewport({X = 0.5, Y = 0})
    end)
    pcall(function() w:SetRenderOpacity(TAG) end)
    prompt = {w = w, untilT = seconds and (os.clock() + seconds) or nil}
end

local function IsDown(PC, name)
    local ok, down = pcall(function() return PC:IsInputKeyDown({KeyName = FName(name)}) end)
    if not ok then
        if pollOk == nil then log("IsInputKeyDown failed: " .. tostring(down)) end
        pollOk = false
        return false
    end
    if pollOk == nil then pollOk = true log("key polling works") end
    return down == true
end

-- True once when a key goes down, not again while it is held.
local function Pressed(PC, name)
    local down = IsDown(PC, name)
    local was = wasDown[name]
    wasDown[name] = down
    return down and not was
end

local function StartCapture()
    local PC = GetPC()
    if not PC then return end
    -- Keys already held (the End that opened this) are not a choice until released.
    capturing = {held = {}}
    for _, k in ipairs(KEYS) do capturing.held[k] = IsDown(PC, k) end
    ShowPrompt(Text().lock, Text().press)
end

local function Capture(PC)
    for _, k in ipairs(KEYS) do
        local down = IsDown(PC, k)
        if capturing.held[k] then
            if not down then capturing.held[k] = false end
        elseif down then
            capturing = nil
            wasDown[k] = true            -- so the chosen key does not also lock right away
            if k == "Escape" then
                ShowPrompt(Text().same, KeyLabel(lockKey) .. " / " .. KeyLabel(padKey), 2.5)
            else
                -- A gamepad button replaces the gamepad key, anything else the keyboard/mouse key.
                if IsPadKey(k) then padKey = k else lockKey = k end
                SaveKeys(lockKey, padKey)
                log("lock keys set to " .. lockKey .. " / " .. padKey)
                ShowPrompt(Text().set, KeyLabel(lockKey) .. " / " .. KeyLabel(padKey), 2.5)
            end
            return
        end
    end
end

local function Keys()
    local PC = GetPC()
    if not PC then return end
    if capturing then Capture(PC) return end
    -- Both are read every frame so each one keeps track of its own press.
    local kb, pad = Pressed(PC, lockKey), Pressed(PC, padKey)
    if kb or pad then Toggle() end
end

-- A new press of the Mod Menu's "Lock-on: change key" row (it counts presses in lock_rebind)
-- opens "press a key".
local rebindSeen = nil
FrameTick.Every(0.25, "rebind", function()
    ModSettings.Load()
    local n = ModSettings.GetNum("lock_rebind", 0)
    if rebindSeen ~= nil and n ~= rebindSeen and not capturing then StartCapture() end
    rebindSeen = n
end)

FrameTick.Every(0, "keys", function()
    local ok, err = pcall(Keys)
    if not ok then logOnce("keys", "ERROR keys: " .. tostring(err)) end
    if prompt and prompt.untilT and os.clock() > prompt.untilT then HidePrompt() end
end)

FrameTick.Every(0, "lockon", function(t)
    local ok, err = pcall(Frame, t)
    if not ok then logOnce("frame", "ERROR Frame: " .. tostring(err)) end
end)
FrameTick.Start(log, "LockOn")
log("LockOn loaded - lock keys: " .. lockKey .. " / " .. padKey .. ", the Mod Menu changes them")
