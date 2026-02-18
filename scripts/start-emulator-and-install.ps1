# Start Android emulator and install APK (Windows)
# Prerequisites: One AVD created in Android Studio (Device Manager)

$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
$Emulator = "$SdkRoot\emulator\emulator.exe"
$Adb = "$SdkRoot\platform-tools\adb.exe"

# 1) List AVDs - use the first one if you have multiple
$avds = & $Emulator -list-avds 2>&1
if (-not $avds) {
    Write-Host "No Android Virtual Device found." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Create one first:"
    Write-Host "  1. Open Android Studio"
    Write-Host "  2. More Actions -> Virtual Device Manager (or Tools -> Device Manager)"
    Write-Host "  3. Create Device -> pick a phone (e.g. Pixel 6) -> Next"
    Write-Host "  4. Select a system image (e.g. API 36) -> Next -> Finish"
    Write-Host ""
    Write-Host "Then run this script again."
    exit 1
}

$avdName = ($avds | Select-Object -First 1).Trim()
Write-Host "Starting emulator: $avdName"
Start-Process -FilePath $Emulator -ArgumentList "-avd", $avdName -WindowStyle Normal

# Wait for emulator to boot
Write-Host "Waiting for emulator to boot (about 30-45 seconds)..."
& $Adb wait-for-device 2>$null
Start-Sleep -Seconds 5
$bootOk = $false
for ($i = 0; $i -lt 60; $i++) {
    $boot = & $Adb shell getprop sys.boot_completed 2>$null
    if ($boot -match "1") { $bootOk = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $bootOk) {
    Write-Host "Emulator may still be booting. You can install the APK manually when it's ready."
}

# 2) Install APK if path provided
$apkPath = $args[0]
if ($apkPath -and (Test-Path $apkPath)) {
    Write-Host "Installing APK: $apkPath"
    & $Adb install -r $apkPath
} else {
    Write-Host ""
    Write-Host "To install your APK, run:"
    Write-Host "  & '$Adb' install -r `"C:\path\to\your.apk`""
    Write-Host ""
    Write-Host "To capture crash logs after opening the app:"
    Write-Host "  & '$Adb' logcat -c; & '$Adb' logcat *:E AndroidRuntime:E"
}
