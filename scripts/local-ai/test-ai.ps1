# test-ai.ps1 — Quick test to check if local AI is available in Edge
# Run this first to see if the machine supports window.ai

$InstallDir = "$env:ProgramData\sysupdate-ai"

# Check Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not installed. Run install.ps1 first." -ForegroundColor Red
    exit 1
}

# Check if deps installed
if (-not (Test-Path "$InstallDir\node_modules")) {
    Write-Host "Dependencies not installed. Run install.ps1 first." -ForegroundColor Red
    exit 1
}

# Create a minimal test script
$testScript = @"
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const edgePath = edgePaths.find(p => fs.existsSync(p));
if (!edgePath) { console.log('RESULT: Edge not found'); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: edgePath, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.goto('about:blank');

const result = await page.evaluate(async () => {
  if (!window.ai) return 'NOT AVAILABLE - window.ai does not exist';
  try {
    const status = await window.ai.canCreateTextSession();
    return 'STATUS: ' + status;
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
});

await browser.close();
console.log('RESULT: ' + result);
"@

$testPath = "$InstallDir\test-check.js"
$testScript | Set-Content $testPath -Encoding UTF8

Push-Location $InstallDir
Write-Host "`nChecking local AI availability in Edge..." -ForegroundColor Cyan
$output = node test-check.js 2>&1
Write-Host $output

if ($output -match "STATUS: readily") {
    Write-Host "`n[OK] Local AI is ready! You can run gather.ps1" -ForegroundColor Green
} elseif ($output -match "STATUS: after-download") {
    Write-Host "`n[WAIT] Model is downloading. Try again in a few minutes." -ForegroundColor Yellow
} elseif ($output -match "NOT AVAILABLE") {
    Write-Host "`n[FAIL] window.ai not available. Enable the flag in Edge:" -ForegroundColor Red
    Write-Host "  1. Open edge://flags/#optimization-guide-on-device-model" -ForegroundColor Gray
    Write-Host "  2. Set to 'Enabled BypassPerfRequirement'" -ForegroundColor Gray
    Write-Host "  3. Restart Edge" -ForegroundColor Gray
} else {
    Write-Host "`n[?] Unexpected result. Check Edge flags." -ForegroundColor Yellow
}

Remove-Item $testPath -Force
Pop-Location
