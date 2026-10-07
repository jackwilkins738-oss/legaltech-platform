$ErrorActionPreference = "Stop"
if (-not (Test-Path ".git")) { throw "This folder is not linked to GitHub yet. Run CONNECT_GITHUB.ps1 first." }

git fetch origin
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "Local changes exist; refusing to overwrite them." -ForegroundColor Yellow
  git status --short
  exit 1
}
git pull --ff-only origin main
Write-Host "Updated to latest main." -ForegroundColor Green
