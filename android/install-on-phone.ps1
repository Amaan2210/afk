<#
.SYNOPSIS
  Builds the release APK and installs it on the phone plugged in over USB.

.DESCRIPTION
  One step in place of several: sets the signing variables (asking for the keystore's password,
  which is never saved or printed), builds the release APK, and installs it with adb.

  Without a keystore the APK is signed with the debug key. It still installs, but a later APK
  signed with the release key will not install over it.

.PARAMETER Keystore
  The release keystore. Default: afk-release.jks in your user folder (see docs/releasing.md).

.PARAMETER Alias
  The key's alias in the keystore. Default: afk.

.PARAMETER SkipBuild
  Install the APK that is already built.

.PARAMETER BuildOnly
  Build the APK and stop. No phone is needed: send the file to the phone and tap it there.

.EXAMPLE
  .\install-on-phone.ps1

.EXAMPLE
  .\install-on-phone.ps1 -BuildOnly
#>
param(
    [string]$Keystore = (Join-Path $env:USERPROFILE 'afk-release.jks'),
    [string]$Alias = 'afk',
    [switch]$SkipBuild,
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$AppId = 'io.github.amaankhan63.afk'
$Apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\release\app-release.apk'

function Find-Adb {
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $sdks = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
    foreach ($sdk in $sdks) {
        if (-not $sdk) { continue }
        $adb = Join-Path $sdk 'platform-tools\adb.exe'
        if (Test-Path $adb) { return $adb }
    }
    throw 'adb was not found. Install the Android SDK platform tools, or add adb to PATH.'
}

# The lines of `adb devices` that name a phone ready to use.
function Get-Phones([string]$Adb) {
    $lines = & $Adb devices
    return @($lines | Where-Object { $_ -match '^\S+\s+device$' })
}

if (-not $SkipBuild) {
    if (Test-Path $Keystore) {
        $secure = Read-Host "Password of $Keystore" -AsSecureString
        $password = (New-Object System.Net.NetworkCredential('', $secure)).Password
        # For this window's build only. A PKCS12 key has the keystore's password.
        $env:AFK_KEYSTORE_PATH = $Keystore
        $env:AFK_KEY_ALIAS = $Alias
        $env:AFK_KEYSTORE_PASSWORD = $password
        $env:AFK_KEY_PASSWORD = $password
    }
    else {
        Write-Warning "No keystore at $Keystore. The APK will be signed with the debug key."
        $env:AFK_KEYSTORE_PATH = ''
    }

    try {
        Write-Host 'Building the release APK (a few minutes)...'
        & (Join-Path $PSScriptRoot 'gradlew.bat') -p $PSScriptRoot ':app:assembleRelease'
        if ($LASTEXITCODE -ne 0) { throw "The build failed (exit code $LASTEXITCODE)." }
    }
    finally {
        # The password does not outlive the build.
        $env:AFK_KEYSTORE_PASSWORD = ''
        $env:AFK_KEY_PASSWORD = ''
    }
}

if (-not (Test-Path $Apk)) { throw "No APK at $Apk. Run this without -SkipBuild." }

if ($BuildOnly) {
    Write-Host "Built: $Apk"
    Write-Host 'Send this file to the phone and tap it there to install.'
    exit 0
}

$adb = Find-Adb
$phones = Get-Phones $adb
if ($phones.Count -eq 0) {
    throw 'No phone found. Plug it in over USB, turn on USB debugging, and accept the prompt on it.'
}
if ($phones.Count -gt 1) {
    throw "More than one device is connected. Unplug the others, or stop the emulator:`n$($phones -join "`n")"
}

Write-Host "Installing $Apk ..."
# Through cmd, so adb's error text is read as text: PowerShell 5.1 would stop on it.
$output = (cmd /c "`"$adb`" install -r `"$Apk`" 2>&1" | Out-String)
if ($LASTEXITCODE -eq 0 -and $output -match 'Success') {
    Write-Host 'Installed. Open AFK on the phone.'
    exit 0
}

Write-Host $output
# An APK signed with another key, or a copy left for another user of the phone
# ("App not installed for this user" in Settings > Apps), blocks the install.
if ($output -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE|conflict') {
    Write-Host 'An AFK already on the phone blocks this one: it was signed with another key,'
    Write-Host 'or a copy is left over for another user of the phone.'
    $answer = Read-Host 'Remove it and install again? The app forgets its pairing and settings. [y/N]'
    if ($answer -match '^[yY]') {
        & $adb uninstall $AppId | Out-Host
        & $adb install -r $Apk | Out-Host
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'Installed. Open AFK on the phone and pair again with afk pair.'
            exit 0
        }
    }
}
throw 'The APK was not installed.'
