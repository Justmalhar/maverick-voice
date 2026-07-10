import AppKit
import CoreGraphics
import Foundation
import IOKit.hid

// Disable stdout buffering for real-time pipe communication with Electron
setbuf(stdout, nil)

var previousModifiers: NSEvent.ModifierFlags = []

func handleModifierChange(_ event: NSEvent) {
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

    // Fn/Globe key detection
    let hadFn = previousModifiers.contains(.function)
    let hasFn = mods.contains(.function)
    if !hadFn && hasFn {
        print("FN_DOWN")
    }
    if hadFn && !hasFn {
        print("FN_UP")
    }

    // Caps Lock detection (for instruction mode)
    let hadCaps = previousModifiers.contains(.capsLock)
    let hasCaps = mods.contains(.capsLock)
    if !hadCaps && hasCaps {
        print("CAPS_DOWN")
    }
    if hadCaps && !hasCaps {
        print("CAPS_UP")
    }

    // Right Option key detection (keyCode 61 = Right Option)
    if event.keyCode == 61 {
        let hadOption = previousModifiers.contains(.option)
        let hasOption = mods.contains(.option)
        if !hadOption && hasOption {
            print("RIGHT_OPTION_DOWN")
        }
        if hadOption && !hasOption {
            print("RIGHT_OPTION_UP")
        }
    }

    previousModifiers = mods

    // Modifier-combo dictation support: emit the full set of currently-held
    // modifiers on EVERY flagsChanged so the Electron side can resolve >=2
    // modifier combos (Discord-style PTT). Order is fixed (fn,shift,ctrl,
    // option,cmd) so the CSV is deterministic. "MODS:" (empty) when none held.
    // This is ADDITIVE — the FN_*/CAPS_*/RIGHT_OPTION_* tokens above are
    // unchanged for full backward compatibility.
    var modNames: [String] = []
    if mods.contains(.function) { modNames.append("fn") }
    if mods.contains(.shift) { modNames.append("shift") }
    if mods.contains(.control) { modNames.append("ctrl") }
    if mods.contains(.option) { modNames.append("option") }
    if mods.contains(.command) { modNames.append("cmd") }
    print("MODS:" + modNames.joined(separator: ","))
}

// ─── Stdin command handler ───
// Electron can send commands via stdin for fast keystroke simulation.
// Uses CGEvent instead of NSAppleScript to avoid blocking the main thread.
// NSAppleScript.executeAndReturnError() is synchronous and blocks the main
// run loop for ~30-40ms, which causes NSEvent global monitors to miss
// flagsChanged events (FN_UP) — corrupting the previousModifiers state
// and making the user need 3 Fn presses instead of 2.
// CGEvent posts asynchronously and never blocks the run loop.

// Key codes (from Carbon/Events.h)
let kVK_V: CGKeyCode = 9
let kVK_C: CGKeyCode = 8

func simulateKeystroke(_ keyCode: CGKeyCode) -> Bool {
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) else {
        return false
    }
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    keyDown.post(tap: .cgSessionEventTap)
    keyUp.post(tap: .cgSessionEventTap)
    return true
}

// Reply to a FRONTAPP request with the frontmost application's bundle id and
// localized name. NSWorkspace is an AppKit API — access it on the main thread
// (the stdin loop runs on a background queue). Empty fields when nil.
func reportFrontmostApp() {
    DispatchQueue.main.async {
        let app = NSWorkspace.shared.frontmostApplication
        let bundleId = app?.bundleIdentifier ?? ""
        let name = app?.localizedName ?? ""
        print("FRONTAPP:\(bundleId)|\(name)")
    }
}

// HEALTH: report whether this process can actually do its job. The NSEvent
// global monitor silently receives NOTHING without Input Monitoring
// (IOHIDCheckAccess listen-event grant), and PASTE/COPY CGEvent posting needs
// Accessibility (AXIsProcessTrusted). OK requires BOTH; anything less is
// NOPERM so Electron can surface the permission banner instead of a dead
// hotkey (LEGACY-ISSUES M6).
func reportHealth() {
    let listenOK = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted
    let axOK = AXIsProcessTrusted()
    print((listenOK && axOK) ? "HEALTH:OK" : "HEALTH:NOPERM")
}

func handleStdinCommand(_ command: String) {
    switch command {
    case "HEALTH":
        reportHealth()
    case "PASTE":
        if simulateKeystroke(kVK_V) {
            print("PASTE_OK")
        } else {
            fputs("PASTE_ERROR:Failed to create CGEvent\n", stderr)
        }
    case "COPY":
        if simulateKeystroke(kVK_C) {
            print("COPY_OK")
        } else {
            fputs("COPY_ERROR:Failed to create CGEvent\n", stderr)
        }
    case "FRONTAPP":
        reportFrontmostApp()
    default:
        break
    }
}

// Read stdin on a background thread so it doesn't block the run loop.
DispatchQueue.global(qos: .userInteractive).async {
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            handleStdinCommand(trimmed)
        }
    }
}

// Monitor global flagsChanged events (when other apps are focused)
NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
    handleModifierChange(event)
}

// Also monitor local flagsChanged events (when our app is focused)
NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
    handleModifierChange(event)
    return event
}

// Keep the run loop alive
NSApplication.shared.run()
