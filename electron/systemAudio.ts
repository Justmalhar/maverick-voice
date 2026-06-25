// electron/systemAudio.ts — mute default system output while dictating (reduce mic bleed).
//
// darwin: DUCK/UNDUCK stdin commands on the globe-listener helper (CoreAudio).
// win32: PowerShell/COM IAudioEndpointVolume on the default render endpoint.
//
// Ref-counted so dictation→instruction chain segments don't restore audio between
// stopRecording and chainSession; forceUnduck() resets on cancel/discard/error.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { keyListener } from './keyListener'

const execFileAsync = promisify(execFile)

let enabled = true
let refCount = 0
let applied = false
/** Saved mute state on win32 (darwin saves inside globe-listener). */
let win32SavedMute: boolean | null = null

export function setDuckSystemAudioEnabled(value: boolean): void {
  enabled = value
}

export function isDuckSystemAudioEnabled(): boolean {
  return enabled
}

/** Increment ref-count; mute default output when count goes 0→1. */
export async function duck(): Promise<void> {
  if (!enabled) return
  refCount++
  if (refCount === 1) {
    await applyDuck()
  }
}

/** Decrement ref-count; restore output when count goes 1→0. */
export async function unduck(): Promise<void> {
  if (refCount <= 0) return
  refCount--
  if (refCount === 0) {
    await applyUnduck()
  }
}

/** Idempotent reset — use on cancel/discard/error when ref-count may be stale. */
export async function forceUnduck(): Promise<void> {
  refCount = 0
  await applyUnduck()
}

async function applyDuck(): Promise<void> {
  if (applied) return
  try {
    if (process.platform === 'darwin') {
      await keyListener.sendCommand('DUCK')
    } else if (process.platform === 'win32') {
      win32SavedMute = await win32GetMute()
      await win32SetMute(true)
    }
    applied = true
    console.log('[systemAudio] Duck applied')
  } catch (err) {
    console.warn('[systemAudio] Duck failed:', err instanceof Error ? err.message : err)
  }
}

async function applyUnduck(): Promise<void> {
  if (!applied) return
  try {
    if (process.platform === 'darwin') {
      await keyListener.sendCommand('UNDUCK')
    } else if (process.platform === 'win32') {
      await win32SetMute(win32SavedMute ?? false)
      win32SavedMute = null
    }
    applied = false
    console.log('[systemAudio] Unduck applied')
  } catch (err) {
    console.warn('[systemAudio] Unduck failed:', err instanceof Error ? err.message : err)
  }
}

const WIN32_AUDIO_HELPER = `
$ErrorActionPreference = 'Stop'
if (-not ('AudioVolume' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public enum EDataFlow { Render = 0 }
public enum ERole { Multimedia = 1 }

[Guid("A95664D2-9614-4D8F-A844-8AE7C1B87468"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl();
  [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-BFEA0603307C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("5CDF2C82-841E-4546-9722-0CF040782341"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
  [PreserveSig] int GetChannelCount(out uint pnChannelCount);
  [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
  [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
  [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
  [PreserveSig] int GetMute(out bool pbMute);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public static class AudioVolume {
  static IAudioEndpointVolume GetVolume() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object obj;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out obj));
    return (IAudioEndpointVolume)obj;
  }
  public static bool GetMute() {
    bool mute;
    Marshal.ThrowExceptionForHR(GetVolume().GetMute(out mute));
    return mute;
  }
  public static void SetMute(bool mute) {
    Guid guid = Guid.Empty;
    Marshal.ThrowExceptionForHR(GetVolume().SetMute(mute, ref guid));
  }
}
'@
}
`

async function win32GetMute(): Promise<boolean> {
  const script = `${WIN32_AUDIO_HELPER}; if ([AudioVolume]::GetMute()) { '1' } else { '0' }`
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script])
  return stdout.trim() === '1'
}

async function win32SetMute(mute: boolean): Promise<void> {
  const script = `${WIN32_AUDIO_HELPER}; [AudioVolume]::SetMute($${mute ? 'true' : 'false'})`
  await execFileAsync('powershell', ['-NoProfile', '-Command', script])
}

/** Test-only reset — clears ref-count and applied state between vitest cases. */
export function __resetSystemAudioForTests(): void {
  refCount = 0
  applied = false
  win32SavedMute = null
  enabled = true
}
