param(
    [string]$Executable = 'C:\Program Files\Serveo\Serveo.exe',
    [string]$IconSource = (Join-Path $PSScriptRoot '..\build\icon.ico'),
    [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Serveo.lnk')
)

$ErrorActionPreference = 'Stop'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$iconSourcePath = (Resolve-Path -LiteralPath $IconSource).Path
$dataDirectory = Join-Path $env:APPDATA 'Serveo'
$backupDirectory = Join-Path $dataDirectory 'backups'
$iconDirectory = Join-Path $dataDirectory 'icons'
New-Item -ItemType Directory -Force -Path $backupDirectory, $iconDirectory | Out-Null

$iconHash = (Get-FileHash -LiteralPath $iconSourcePath -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
$version = (Get-Item -LiteralPath $executablePath).VersionInfo.ProductVersion -replace '[^0-9A-Za-z.-]', '_'
$iconPath = Join-Path $iconDirectory "serveo-$version-$iconHash.ico"
if (-not (Test-Path -LiteralPath $iconPath)) {
    Copy-Item -LiteralPath $iconSourcePath -Destination $iconPath
}

$backupPath = $null
if (Test-Path -LiteralPath $ShortcutPath) {
    $backupPath = Join-Path $backupDirectory "Serveo-shortcut-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').lnk"
    Copy-Item -LiteralPath $ShortcutPath -Destination $backupPath
}

# Create a fresh link instead of editing the installer-created link's opaque fields.
$temporaryPath = Join-Path $dataDirectory "shortcut-$([Guid]::NewGuid().ToString('N')).lnk"
try {
    $shortcutShell = New-Object -ComObject WScript.Shell
    $shortcut = $shortcutShell.CreateShortcut($temporaryPath)
    $shortcut.TargetPath = $executablePath
    $shortcut.WorkingDirectory = Split-Path -Parent $executablePath
    $shortcut.Description = 'Serveo - Keep business moving.'
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Save()
    Copy-Item -LiteralPath $temporaryPath -Destination $ShortcutPath -Force

    $verified = $shortcutShell.CreateShortcut($ShortcutPath)
    if ($verified.TargetPath -ne $executablePath -or $verified.IconLocation -ne "$iconPath,0") {
        throw 'Shortcut verification failed. The original shortcut is preserved in backups.'
    }

    if (-not ('ServeoShortcutNotification' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ServeoShortcutNotification {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);
}
'@
    }
    # SHCNE_UPDATEITEM / SHCNF_PATHW: refresh this link only.
    [ServeoShortcutNotification]::SHChangeNotify(0x00002000, 0x0005, $ShortcutPath, [IntPtr]::Zero)
    [PSCustomObject]@{
        Shortcut = $ShortcutPath
        Target = $verified.TargetPath
        Icon = $verified.IconLocation
        OriginalBackup = $backupPath
    } | Format-List
} finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
}
