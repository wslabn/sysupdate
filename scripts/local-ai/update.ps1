# update.ps1 — Pull latest scripts from GitHub
$InstallDir = "$env:ProgramData\sysupdate-ai"
$BaseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"

$files = @("analyze.js", "gather.ps1", "update.ps1")
foreach ($f in $files) {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing -ErrorAction Stop
    } catch {}
}
