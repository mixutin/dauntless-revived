#pragma once
#include <windows.h>
#include <setupapi.h>
#include <hidsdi.h>
#include <Xinput.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>

#include "MinHook/MinHook.h"

#pragma comment(lib, "hid.lib")
#pragma comment(lib, "setupapi.lib")

// The 1.4.4 client only reads XInput (Xbox) gamepads, so a PS5 DualSense needed DS4Windows to pass
// as an Xbox pad. Read the DualSense ourselves (USB or Bluetooth HID) and answer the game's XInput
// calls with it, on the first slot no real XInput pad uses. Real Xbox pads keep working as before.
// The game's rumble goes to the DualSense too (the game's own Vibration switch still decides), and
// the mic mute button drives the Mod Menu (ue4ss/Mods/ModMenu), which otherwise needs a keyboard.
namespace DualSense {

constexpr uint16_t SonyVendor = 0x054C;
constexpr uint16_t DualSenseProduct = 0x0CE6;
constexpr uint16_t DualSenseEdgeProduct = 0x0DF2;

// The pad as XInput sees it, plus whether a DualSense is connected right now.
struct Snapshot {
    bool Connected = false;
    XINPUT_GAMEPAD Pad{};
};

inline SRWLOCK Lock = SRWLOCK_INIT;
inline Snapshot Current{};
inline std::atomic<DWORD> Packet{ 0 };

inline SHORT Axis(uint8_t Value, bool Invert) {
    int V = (static_cast<int>(Value) - 128) * 258;
    if (Invert) V = -V;
    if (V > 32767) V = 32767;
    if (V < -32768) V = -32768;
    return static_cast<SHORT>(V);
}

// The fields every DualSense input report carries, wherever the report puts them.
struct Fields {
    uint8_t LX, LY, RX, RY, L2, R2, Buttons0, Buttons1, Buttons2;
};

// USB report 0x01 (64 bytes) and Bluetooth report 0x31 (78 bytes) share one layout, the Bluetooth
// one a byte further on. Before the pad switches to 0x31, Bluetooth sends a short 0x01 report with
// its own order. Returns false for anything else.
inline bool ParseReport(const uint8_t* Report, size_t Length, Fields& Out) {
    if (!Report || Length == 0) return false;
    if (Report[0] == 0x01 && Length >= 64) {
        const uint8_t* B = Report + 1;
        Out = { B[0], B[1], B[2], B[3], B[4], B[5], B[7], B[8], B[9] };
        return true;
    }
    if (Report[0] == 0x31 && Length >= 12) {
        const uint8_t* B = Report + 2;
        Out = { B[0], B[1], B[2], B[3], B[4], B[5], B[7], B[8], B[9] };
        return true;
    }
    if (Report[0] == 0x01 && Length >= 10) {
        const uint8_t* B = Report + 1;
        Out = { B[0], B[1], B[2], B[3], B[7], B[8], B[4], B[5], B[6] };
        return true;
    }
    return false;
}

// Cross, circle, square and triangle sit where A, B, X and Y do on an Xbox pad. Create and the
// touchpad click are Back (the map on PS4), Options is Start.
inline XINPUT_GAMEPAD ToXInput(const Fields& F) {
    XINPUT_GAMEPAD P{};
    static constexpr WORD Hat[8] = {
        XINPUT_GAMEPAD_DPAD_UP,
        XINPUT_GAMEPAD_DPAD_UP | XINPUT_GAMEPAD_DPAD_RIGHT,
        XINPUT_GAMEPAD_DPAD_RIGHT,
        XINPUT_GAMEPAD_DPAD_DOWN | XINPUT_GAMEPAD_DPAD_RIGHT,
        XINPUT_GAMEPAD_DPAD_DOWN,
        XINPUT_GAMEPAD_DPAD_DOWN | XINPUT_GAMEPAD_DPAD_LEFT,
        XINPUT_GAMEPAD_DPAD_LEFT,
        XINPUT_GAMEPAD_DPAD_UP | XINPUT_GAMEPAD_DPAD_LEFT,
    };
    const uint8_t Direction = F.Buttons0 & 0x0F;
    if (Direction < 8) P.wButtons |= Hat[Direction];
    if (F.Buttons0 & 0x10) P.wButtons |= XINPUT_GAMEPAD_X;         // square
    if (F.Buttons0 & 0x20) P.wButtons |= XINPUT_GAMEPAD_A;         // cross
    if (F.Buttons0 & 0x40) P.wButtons |= XINPUT_GAMEPAD_B;         // circle
    if (F.Buttons0 & 0x80) P.wButtons |= XINPUT_GAMEPAD_Y;         // triangle
    if (F.Buttons1 & 0x01) P.wButtons |= XINPUT_GAMEPAD_LEFT_SHOULDER;
    if (F.Buttons1 & 0x02) P.wButtons |= XINPUT_GAMEPAD_RIGHT_SHOULDER;
    if (F.Buttons1 & 0x10) P.wButtons |= XINPUT_GAMEPAD_BACK;      // Create
    if (F.Buttons1 & 0x20) P.wButtons |= XINPUT_GAMEPAD_START;     // Options
    if (F.Buttons1 & 0x40) P.wButtons |= XINPUT_GAMEPAD_LEFT_THUMB;
    if (F.Buttons1 & 0x80) P.wButtons |= XINPUT_GAMEPAD_RIGHT_THUMB;
    if (F.Buttons2 & 0x02) P.wButtons |= XINPUT_GAMEPAD_BACK;      // touchpad click
    P.bLeftTrigger = F.L2;
    P.bRightTrigger = F.R2;
    P.sThumbLX = Axis(F.LX, false);
    P.sThumbLY = Axis(F.LY, true);
    P.sThumbRX = Axis(F.RX, false);
    P.sThumbRY = Axis(F.RY, true);
    return P;
}

inline void Publish(bool Connected, const XINPUT_GAMEPAD& Pad) {
    AcquireSRWLockExclusive(&Lock);
    const bool Changed = Current.Connected != Connected || std::memcmp(&Current.Pad, &Pad, sizeof Pad) != 0;
    Current.Connected = Connected;
    Current.Pad = Pad;
    ReleaseSRWLockExclusive(&Lock);
    if (Changed) Packet.fetch_add(1);
}

inline Snapshot Read() {
    AcquireSRWLockShared(&Lock);
    const Snapshot S = Current;
    ReleaseSRWLockShared(&Lock);
    return S;
}

// The game's two motors as XInput gives them (left: heavy, low frequency; right: light).
inline std::atomic<uint32_t> WantedRumble{ 0 };
inline HANDLE RumbleSignal = CreateEventW(nullptr, FALSE, FALSE, nullptr);


// ------------------------------------------------------------------ the Mod Menu from the pad

// The Mod Menu answers keys (Home opens and closes it, Up/Down choose, End switches). The mic mute
// button opens it (the game has no use for it, and Steam keeps the PS button for itself); while it
// is open the mute light is on, the d-pad chooses, cross switches and circle or mute closes it, and
// the game does not get those buttons. Keys are only sent while the game's window is in front.
inline std::atomic<bool> MenuOpen{ false };

inline void SetMenuOpen(bool Open) {
    if (MenuOpen.exchange(Open) != Open) SetEvent(RumbleSignal);
}

inline bool GameInFront() {
    DWORD Process = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &Process);
    return Process == GetCurrentProcessId();
}

// Held for a moment: UE4SS polls the keyboard, and a press and release in the same instant is missed.
inline void TapKey(WORD VirtualKey) {
    std::thread([VirtualKey] {
        if (!GameInFront()) return;
        INPUT Key{};
        Key.type = INPUT_KEYBOARD;
        Key.ki.wVk = VirtualKey;
        Key.ki.wScan = static_cast<WORD>(MapVirtualKeyW(VirtualKey, MAPVK_VK_TO_VSC));
        Key.ki.dwFlags = KEYEVENTF_EXTENDEDKEY;
        SendInput(1, &Key, sizeof(INPUT));
        Sleep(60);
        Key.ki.dwFlags |= KEYEVENTF_KEYUP;
        SendInput(1, &Key, sizeof(INPUT));
    }).detach();
}

// Called with every report; acts on presses only.
inline void MenuButtons(const Fields& F) {
    static bool WasMute = false, WasCross = false, WasCircle = false, WasUp = false, WasDown = false;
    const uint8_t Direction = F.Buttons0 & 0x0F;
    const bool Mute = F.Buttons2 & 0x04, Cross = F.Buttons0 & 0x20, Circle = F.Buttons0 & 0x40;
    const bool Up = Direction == 7 || Direction == 0 || Direction == 1;
    const bool Down = Direction >= 3 && Direction <= 5;

    if (!GameInFront()) {
        WasMute = Mute; WasCross = Cross; WasCircle = Circle; WasUp = Up; WasDown = Down;
        return;
    }
    if (Mute && !WasMute) {
        TapKey(VK_HOME);
        SetMenuOpen(!MenuOpen);
    } else if (MenuOpen) {
        if (Circle && !WasCircle) {
            TapKey(VK_HOME);
            SetMenuOpen(false);
        } else {
            if (Up && !WasUp) TapKey(VK_UP);
            if (Down && !WasDown) TapKey(VK_DOWN);
            if (Cross && !WasCross) TapKey(VK_END);
        }
    }
    WasMute = Mute; WasCross = Cross; WasCircle = Circle; WasUp = Up; WasDown = Down;
}

// ------------------------------------------------------------------ the pad itself

// The open pad: the device path (output goes through a handle of its own, so a write never waits
// behind the blocking read) and whether it is on Bluetooth (another output report, with a CRC).
inline SRWLOCK PadLock = SRWLOCK_INIT;
inline std::wstring PadPath;
inline bool PadBluetooth = false;

// The first DualSense the system lists, opened for reading. INVALID_HANDLE_VALUE if none.
inline HANDLE OpenPad(USHORT& InputLength) {
    GUID HidGuid;
    HidD_GetHidGuid(&HidGuid);
    HDEVINFO Set = SetupDiGetClassDevsW(&HidGuid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
    if (Set == INVALID_HANDLE_VALUE) return INVALID_HANDLE_VALUE;

    HANDLE Found = INVALID_HANDLE_VALUE;
    SP_DEVICE_INTERFACE_DATA Interface{ sizeof(SP_DEVICE_INTERFACE_DATA) };
    for (DWORD i = 0; Found == INVALID_HANDLE_VALUE && SetupDiEnumDeviceInterfaces(Set, nullptr, &HidGuid, i, &Interface); i++) {
        DWORD Size = 0;
        SetupDiGetDeviceInterfaceDetailW(Set, &Interface, nullptr, 0, &Size, nullptr);
        if (Size == 0) continue;
        std::string Buffer(Size, '\0');
        auto* Detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(Buffer.data());
        Detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
        if (!SetupDiGetDeviceInterfaceDetailW(Set, &Interface, Detail, Size, nullptr, nullptr)) continue;

        HANDLE Device = CreateFileW(Detail->DevicePath, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
        if (Device == INVALID_HANDLE_VALUE) continue;

        HIDD_ATTRIBUTES Attributes{ sizeof(HIDD_ATTRIBUTES) };
        PHIDP_PREPARSED_DATA Preparsed = nullptr;
        HIDP_CAPS Caps{};
        const bool IsPad = HidD_GetAttributes(Device, &Attributes) && Attributes.VendorID == SonyVendor &&
            (Attributes.ProductID == DualSenseProduct || Attributes.ProductID == DualSenseEdgeProduct) &&
            HidD_GetPreparsedData(Device, &Preparsed) && HidP_GetCaps(Preparsed, &Caps) == HIDP_STATUS_SUCCESS;
        if (Preparsed) HidD_FreePreparsedData(Preparsed);
        if (IsPad && Caps.InputReportByteLength > 0) {
            InputLength = Caps.InputReportByteLength;
            AcquireSRWLockExclusive(&PadLock);
            PadPath = Detail->DevicePath;
            PadBluetooth = Caps.InputReportByteLength > 64;
            ReleaseSRWLockExclusive(&PadLock);
            Found = Device;
        } else {
            CloseHandle(Device);
        }
    }
    SetupDiDestroyDeviceInfoList(Set);
    return Found;
}

// ------------------------------------------------------------------ rumble

inline uint32_t Crc32(const uint8_t* Data, size_t Length, uint32_t Crc = 0xFFFFFFFF) {
    for (size_t i = 0; i < Length; i++) {
        Crc ^= Data[i];
        for (int b = 0; b < 8; b++) Crc = (Crc >> 1) ^ (0xEDB88320u & (0u - (Crc & 1)));
    }
    return Crc;
}

// Sends the motors with the DualSense's "compatible vibration" (the classic two-motor rumble).
inline bool SendRumble(HANDLE Out, bool Bluetooth, uint8_t Heavy, uint8_t Light, bool MuteLight) {
    uint8_t Report[78] = {};
    DWORD Size;
    if (Bluetooth) {
        static uint8_t Sequence = 0;
        Report[0] = 0x31;
        Report[1] = static_cast<uint8_t>((Sequence++ & 0x0F) << 4);
        Report[2] = 0x10;
        Report[3] = 0x01 | 0x02;    // compatible vibration, haptics select
        Report[4] = 0x01;           // mic mute light
        Report[5] = Light;
        Report[6] = Heavy;
        Report[11] = MuteLight;
        const uint8_t Seed = 0xA2;  // Bluetooth output reports are checked from this header byte on
        const uint32_t Crc = ~Crc32(Report, 74, Crc32(&Seed, 1));
        std::memcpy(Report + 74, &Crc, 4);
        Size = 78;
    } else {
        Report[0] = 0x02;
        Report[1] = 0x01 | 0x02;
        Report[2] = 0x01;
        Report[3] = Light;
        Report[4] = Heavy;
        Report[9] = MuteLight;
        Size = 48;
    }
    DWORD Written = 0;
    return WriteFile(Out, Report, Size, &Written, nullptr) && Written == Size;
}

inline void RumbleLoop() {
    HANDLE Out = INVALID_HANDLE_VALUE;
    std::wstring OutPath;
    for (;;) {
        WaitForSingleObject(RumbleSignal, INFINITE);
        AcquireSRWLockShared(&PadLock);
        const std::wstring Path = PadPath;
        const bool Bluetooth = PadBluetooth;
        ReleaseSRWLockShared(&PadLock);
        if (Path.empty()) continue;
        if (Out == INVALID_HANDLE_VALUE || Path != OutPath) {
            if (Out != INVALID_HANDLE_VALUE) CloseHandle(Out);
            Out = CreateFileW(Path.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
            OutPath = Path;
            if (Out == INVALID_HANDLE_VALUE) continue;
        }
        const uint32_t Motors = WantedRumble.load();
        if (!SendRumble(Out, Bluetooth, static_cast<uint8_t>(Motors >> 8), static_cast<uint8_t>(Motors), MenuOpen.load())) {
            CloseHandle(Out);
            Out = INVALID_HANDLE_VALUE;
        }
    }
}

// ------------------------------------------------------------------ reading

// The engine (UE4's XInput interface) only checks which pads are connected when Windows reports a
// device change, and asks once, right then: a DualSense plugged in or paired while the game runs is
// opened here a moment later, so that one check misses it and the game never sees it. Once the pad
// is answering, tell the game's windows that devices changed, and the engine checks again.
inline BOOL CALLBACK NotifyWindow(HWND Window, LPARAM) {
    DWORD Process = 0;
    GetWindowThreadProcessId(Window, &Process);
    if (Process == GetCurrentProcessId()) PostMessageW(Window, WM_DEVICECHANGE, 0x0007 /* DBT_DEVNODES_CHANGED */, 0);
    return TRUE;
}

inline void TellGameAboutPad() {
    EnumWindows(NotifyWindow, 0);
}

// Reads the pad on its own thread. Looks for one every second while none is connected.
inline void ReaderLoop() {
    for (;;) {
        USHORT Length = 0;
        HANDLE Pad = OpenPad(Length);
        if (Pad == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }
        // Over Bluetooth the full 0x31 report only starts after the host reads feature report 0x05
        // (the calibration data); until then the pad sends the short 0x01 report.
        uint8_t Feature[64] = { 0x05 };
        HidD_GetFeature(Pad, Feature, 41);

        std::string Report(Length, '\0');
        bool Announced = false;
        for (;;) {
            DWORD Read = 0;
            if (!ReadFile(Pad, Report.data(), Length, &Read, nullptr) || Read == 0) break;
            Fields F{};
            if (!ParseReport(reinterpret_cast<const uint8_t*>(Report.data()), Read, F)) continue;
            MenuButtons(F);
            Publish(true, ToXInput(F));
            // First good report of this connection: the XInput hook now answers for the pad.
            if (!Announced) {
                Announced = true;
                TellGameAboutPad();
            }
        }
        CloseHandle(Pad);
        AcquireSRWLockExclusive(&PadLock);
        PadPath.clear();
        ReleaseSRWLockExclusive(&PadLock);
        SetMenuOpen(false);
        Publish(false, XINPUT_GAMEPAD{});
    }
}

// ------------------------------------------------------------------ the game's XInput calls

using GetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using SetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_VIBRATION*);
using GetCapabilitiesFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_CAPABILITIES*);
inline GetStateFn OrigGetState = nullptr;
inline SetStateFn OrigSetState = nullptr;
inline GetCapabilitiesFn OrigGetCapabilities = nullptr;
// Which slots a real XInput pad answered on the last poll.
inline std::atomic<uint32_t> RealPads{ 0 };

inline void NoteReal(DWORD UserIndex, bool Connected) {
    if (UserIndex >= XUSER_MAX_COUNT) return;
    if (Connected) RealPads.fetch_or(1u << UserIndex);
    else RealPads.fetch_and(~(1u << UserIndex));
}

// The DualSense takes the first slot no real pad uses.
inline bool IsOurSlot(DWORD UserIndex) {
    const uint32_t Real = RealPads.load();
    for (DWORD i = 0; i < XUSER_MAX_COUNT; i++)
        if (!(Real & (1u << i))) return i == UserIndex;
    return false;
}

inline DWORD WINAPI GetStateHook(DWORD UserIndex, XINPUT_STATE* State) {
    const DWORD Result = OrigGetState(UserIndex, State);
    NoteReal(UserIndex, Result == ERROR_SUCCESS);
    if (Result == ERROR_SUCCESS || !State || !IsOurSlot(UserIndex)) return Result;
    const Snapshot S = Read();
    if (!S.Connected) return Result;
    State->dwPacketNumber = Packet.load();
    State->Gamepad = S.Pad;
    // The Mod Menu has the d-pad, cross and circle while it is open; the rest still reaches the game.
    if (MenuOpen) State->Gamepad.wButtons &= ~(XINPUT_GAMEPAD_DPAD_UP | XINPUT_GAMEPAD_DPAD_DOWN | XINPUT_GAMEPAD_DPAD_LEFT |
        XINPUT_GAMEPAD_DPAD_RIGHT | XINPUT_GAMEPAD_A | XINPUT_GAMEPAD_B);
    return ERROR_SUCCESS;
}

inline DWORD WINAPI SetStateHook(DWORD UserIndex, XINPUT_VIBRATION* Vibration) {
    const DWORD Result = OrigSetState(UserIndex, Vibration);
    if (Result == ERROR_SUCCESS || !Vibration || !IsOurSlot(UserIndex) || !Read().Connected) return Result;
    const uint32_t Motors = (static_cast<uint32_t>(Vibration->wLeftMotorSpeed >> 8) << 8) | (Vibration->wRightMotorSpeed >> 8);
    if (WantedRumble.exchange(Motors) != Motors) SetEvent(RumbleSignal);
    return ERROR_SUCCESS;
}

inline DWORD WINAPI GetCapabilitiesHook(DWORD UserIndex, DWORD Flags, XINPUT_CAPABILITIES* Capabilities) {
    const DWORD Result = OrigGetCapabilities(UserIndex, Flags, Capabilities);
    if (Result == ERROR_SUCCESS || !Capabilities || !IsOurSlot(UserIndex) || !Read().Connected) return Result;
    *Capabilities = {};
    Capabilities->Type = XINPUT_DEVTYPE_GAMEPAD;
    Capabilities->SubType = XINPUT_DEVSUBTYPE_GAMEPAD;
    Capabilities->Gamepad.wButtons = 0xF3FF;
    Capabilities->Gamepad.bLeftTrigger = 0xFF;
    Capabilities->Gamepad.bRightTrigger = 0xFF;
    Capabilities->Gamepad.sThumbLX = Capabilities->Gamepad.sThumbLY = static_cast<SHORT>(0xFFC0);
    Capabilities->Gamepad.sThumbRX = Capabilities->Gamepad.sThumbRY = static_cast<SHORT>(0xFFC0);
    Capabilities->Vibration.wLeftMotorSpeed = Capabilities->Vibration.wRightMotorSpeed = 0xFFFF;
    return ERROR_SUCCESS;
}

template <typename Fn>
inline bool Hook(HMODULE Module, const char* Name, Fn Detour, Fn* Original) {
    void* Target = reinterpret_cast<void*>(GetProcAddress(Module, Name));
    if (!Target || MH_CreateHook(Target, reinterpret_cast<void*>(Detour), reinterpret_cast<void**>(Original)) != MH_OK) return false;
    return MH_EnableHook(Target) == MH_OK;
}

// Call once from the client hooks, after MH_Initialize. The client imports XINPUT1_3.dll.
inline void Install() {
    HMODULE XInput = GetModuleHandleW(L"xinput1_3.dll");
    if (!XInput) return;
    if (!Hook(XInput, "XInputGetState", &GetStateHook, &OrigGetState)) return;
    Hook(XInput, "XInputSetState", &SetStateHook, &OrigSetState);
    Hook(XInput, "XInputGetCapabilities", &GetCapabilitiesHook, &OrigGetCapabilities);
    std::thread(ReaderLoop).detach();
    std::thread(RumbleLoop).detach();
}

}
