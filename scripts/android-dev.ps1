# scripts/android-dev.ps1
# Reliable Android testing without a physical phone:
# 1) Starts Pixel_6 emulator (or Pixel_7)
# 2) Waits for boot
# 3) Starts Expo Metro (dev-client)
#
# Optional: install a development APK first (one-time):
#   eas build --profile development --platform android
#   then download the APK and: adb install -r path\to\app.apk
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\android-dev.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\android-dev.ps1 -Avd Pixel_7

param(
  [ValidateSet('Pixel_6', 'Pixel_7')]
  [string]$Avd = 'Pixel_6',
  [switch]$SkipMetro
)

$ErrorActionPreference = 'Stop'
$Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$Adb = Join-Path $Sdk 'platform-tools\adb.exe'
$Emu = Join-Path $Sdk 'emulator\emulator.exe'

if (!(Test-Path $Adb)) { throw "adb not found at $Adb — install Android Studio SDK Platform-Tools." }
if (!(Test-Path $Emu)) { throw "emulator not found at $Emu — install Android Emulator via SDK Manager." }

function Get-BootCompleted {
  try {
    return ((& $Adb shell getprop sys.boot_completed 2>$null) | Out-String).Trim()
  } catch {
    return ''
  }
}

$devices = & $Adb devices | Select-String -Pattern "`tdevice$"
if (-not $devices) {
  Write-Host "Starting emulator: $Avd ..."
  Start-Process -FilePath $Emu -ArgumentList @('-avd', $Avd, '-netdelay', 'none', '-netspeed', 'full') | Out-Null
} else {
  Write-Host "Emulator/device already connected."
}

Write-Host "Waiting for Android boot..."
$deadline = (Get-Date).AddMinutes(4)
while ((Get-Date) -lt $deadline) {
  if ((Get-BootCompleted) -eq '1') {
    Write-Host "Boot complete."
    break
  }
  Start-Sleep -Seconds 3
}
if ((Get-BootCompleted) -ne '1') {
  throw "Emulator did not finish booting in time."
}

& $Adb shell settings put system font_scale 1.0 | Out-Null
Write-Host ""
Write-Host "Font-scale stress tests (run in another terminal while app is open):"
Write-Host "  Default:  & `"$Adb`" shell settings put system font_scale 1.0"
Write-Host "  Large:    & `"$Adb`" shell settings put system font_scale 1.3"
Write-Host "  Largest:  & `"$Adb`" shell settings put system font_scale 1.6"
Write-Host "  Display density (optional):"
Write-Host "    & `"$Adb`" shell wm density 420   # reset often: wm density reset"
Write-Host ""

$pkg = 'com.pocketgamerguides.livefpl'
# Emulator reaches the host machine at 10.0.2.2 (adb reverse is flaky on some AVDs)
$metroUrl = 'http://10.0.2.2:8081'
$scheme = 'exp+snack-ff015f15-372f-48a4-a54d-e0dc668b6d1b'
$deepLink = "${scheme}://expo-development-client/?url=$([uri]::EscapeDataString($metroUrl))"

$hasApp = & $Adb shell pm path $pkg 2>$null
if (-not $hasApp) {
  Write-Host "LiveFPL is NOT installed on the emulator yet."
  Write-Host "One-time: build a development APK, then install it:"
  Write-Host "  eas build --profile development --platform android --non-interactive"
  Write-Host "  adb install -r path\to\LiveFPL.apk"
  Write-Host ""
} else {
  Write-Host "LiveFPL package found. Opening against Metro at $metroUrl ..."
  & $Adb reverse tcp:8081 tcp:8081 2>$null | Out-Null
  & $Adb shell am force-stop $pkg 2>$null | Out-Null
  & $Adb shell am start -a android.intent.action.VIEW -d $deepLink $pkg | Out-Null
}

if (-not $SkipMetro) {
  Write-Host "Starting Metro (dev-client, LAN)..."
  Write-Host "If the app times out, relaunch with:"
  Write-Host "  adb shell am start -a android.intent.action.VIEW -d `"$deepLink`" $pkg"
  Set-Location (Join-Path $PSScriptRoot '..')
  npx expo start --dev-client --lan
}
