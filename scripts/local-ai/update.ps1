# update.ps1 — Pull latest scripts from GitHub, then run gather
$InstallDir = "$env:ProgramData\sysupdate-ai"
$BaseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"

$files = @("analyze.js", "gather.ps1")
foreach ($f in $files) {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/$f?t=$(Get-Date -Format 'yyyyMMddHHmmss')" -OutFile "$InstallDir\$f" -UseBasicParsing -Headers @{'Cache-Control'='no-cache'} -ErrorAction Stop
    } catch {}
}

# Now run the freshly updated gather script
& "$InstallDir\gather.ps1"
