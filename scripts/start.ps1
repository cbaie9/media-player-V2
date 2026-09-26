# Lance media-player-v2 depuis PowerShell
# Usage :  .\scripts\start.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "=== media-player-v2 ===" -ForegroundColor Cyan
Write-Host ""

# Vérifie Node
try {
  $nodeVersion = (node --version).TrimStart('v')
  $major = [int]($nodeVersion -split '\.')[0]
  if ($major -lt 20) {
    Write-Host "❌ Node $nodeVersion détecté. Node 20+ requis." -ForegroundColor Red
    exit 1
  }
  Write-Host "✅ Node $nodeVersion" -ForegroundColor Green
} catch {
  Write-Host "❌ Node introuvable. Installez Node 20+ : https://nodejs.org" -ForegroundColor Red
  exit 1
}

# Vérifie les dépendances
if (-not (Test-Path "node_modules")) {
  Write-Host "📦 Installation des dépendances..." -ForegroundColor Yellow
  npm install
}

# Lance le doctor
Write-Host ""
node scripts/doctor.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ Corrigez les erreurs ci-dessus avant de démarrer." -ForegroundColor Red
  exit 1
}

# Démarre
Write-Host ""
npm start