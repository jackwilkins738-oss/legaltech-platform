param(
  [string]$RepoName = "legaltech-platform",
  [string]$Owner = ""
)

$ErrorActionPreference = "Stop"

function Need($cmd, $installHint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $cmd" -ForegroundColor Red
    Write-Host $installHint -ForegroundColor Yellow
    exit 1
  }
}

function Run-Python([string[]]$PyArgs) {
  if (Get-Command python -ErrorAction SilentlyContinue) {
    & python @PyArgs
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 @PyArgs
  } else {
    throw "Python 3 is required for repository security/knowledge checks. Install with: winget install --id Python.Python.3.12 -e"
  }
  if ($LASTEXITCODE -ne 0) { throw "Python check failed: $($PyArgs -join ' ')" }
}

Need "git" "Install Git for Windows: winget install --id Git.Git -e"
Need "gh"  "Install GitHub CLI: winget install --id GitHub.cli -e"
Need "node" "Install Node.js 22+: winget install --id OpenJS.NodeJS.LTS -e"

Write-Host "Checking GitHub authentication..." -ForegroundColor Cyan
& gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub login required. A browser login will open now." -ForegroundColor Yellow
  & gh auth login --web --git-protocol https
  if ($LASTEXITCODE -ne 0) { throw "GitHub authentication failed." }
}
& gh auth setup-git

$Login = (& gh api user --jq .login).Trim()
$UserId = (& gh api user --jq .id).Trim()
if ([string]::IsNullOrWhiteSpace($Owner)) { $Owner = $Login }
if ([string]::IsNullOrWhiteSpace($Owner)) { throw "Could not resolve GitHub owner." }

$fullRepo = "$Owner/$RepoName"
Write-Host "Target private repository: $fullRepo" -ForegroundColor Cyan

if (-not (Test-Path ".git")) { git init -b main }
git config core.autocrlf true

if (-not (git config user.name)) { git config user.name $Login }
if (-not (git config user.email)) { git config user.email "$UserId+$Login@users.noreply.github.com" }

# CODEOWNERS should identify the authenticated maintainer, even when the repo lives in an organisation.
$codeowners = ".github/CODEOWNERS"
if (Test-Path $codeowners) {
  (Get-Content $codeowners -Raw).Replace("@OWNER_PLACEHOLDER", "@$Login") | Set-Content $codeowners -NoNewline
}

# Never carry local runtime state into GitHub.
if (Test-Path "40_PLATFORM_FOUNDATION_BUILD/.dev-data") {
  Remove-Item "40_PLATFORM_FOUNDATION_BUILD/.dev-data" -Recurse -Force
}

Write-Host "Running current platform tests..." -ForegroundColor Cyan
Push-Location "40_PLATFORM_FOUNDATION_BUILD"
& npm test
$testExit = $LASTEXITCODE
Pop-Location
if ($testExit -ne 0) { throw "Platform tests failed; GitHub push aborted." }

Write-Host "Running repository security checks..." -ForegroundColor Cyan
Run-Python @("32_SECURITY_REGRESSION_AUTOMATION/run_security_policy_tests.py")
Run-Python @("32_SECURITY_REGRESSION_AUTOMATION/security_regression_scan.py", ".")

Write-Host "Running Claude knowledge lint..." -ForegroundColor Cyan
Run-Python @("36_CLAUDE_KNOWLEDGE_ARCHITECTURE/scripts/knowledge_lint.py")

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "chore: establish canonical LegalTech repository"
  if ($LASTEXITCODE -ne 0) { throw "Initial Git commit failed." }
}

& gh repo view $fullRepo --json name 1>$null 2>$null
$exists = ($LASTEXITCODE -eq 0)

if (-not $exists) {
  Write-Host "Creating private GitHub repository..." -ForegroundColor Cyan
  & gh repo create $fullRepo --private --source . --remote origin --push --description "LegalTech matter-progression platform and governed product knowledge base"
  if ($LASTEXITCODE -ne 0) { throw "GitHub repository creation/push failed." }
} else {
  Write-Host "Repository already exists; connecting origin if needed..." -ForegroundColor Cyan
  git remote get-url origin 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$fullRepo.git" }
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw "GitHub push failed." }
}

Write-Host ""
Write-Host "GitHub connected successfully: https://github.com/$fullRepo" -ForegroundColor Green
Write-Host "This folder is now the canonical local working copy." -ForegroundColor Green
Write-Host "Next: configure a main-branch ruleset requiring the CI checks before merge." -ForegroundColor Yellow
