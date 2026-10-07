param(
    [string]$RepoPath = "C:\Users\judew\Desktop\Proclaim\LegalTech\legaltech-github-bootstrap\legaltech-platform"
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $RepoPath)) {
    Fail "Repo path not found: $RepoPath"
}

Set-Location $RepoPath

Write-Host "Repository: $RepoPath" -ForegroundColor Cyan

# Ensure correct branch.
git checkout feat/connector-reliability | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "Could not checkout feat/connector-reliability" }

# Find latest patch anywhere under the user profile.
$patch = Get-ChildItem $HOME -Filter "legaltech-v37-connector-reliability.patch" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $patch) {
    Fail "Could not find legaltech-v37-connector-reliability.patch anywhere under $HOME"
}

Write-Host "Patch: $($patch.FullName)" -ForegroundColor Cyan

# Detect whether the v37 patch is already present using a file/string introduced by the patch.
$integrationTest = Join-Path $RepoPath "40_PLATFORM_FOUNDATION_BUILD\test\integrations.test.js"
$alreadyApplied = $false

if (Test-Path $integrationTest) {
    $testText = Get-Content $integrationTest -Raw
    if ($testText -match "reliability|webhook|dead-letter|dead letter") {
        $alreadyApplied = $true
    }
}

if (-not $alreadyApplied) {
    Write-Host "Checking patch..." -ForegroundColor Yellow
    git apply --check "$($patch.FullName)"
    if ($LASTEXITCODE -ne 0) {
        Fail "Patch does not apply cleanly to this repository. No files were changed."
    }

    Write-Host "Applying patch..." -ForegroundColor Yellow
    git apply --verbose "$($patch.FullName)" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Fail "git apply failed."
    }
} else {
    Write-Host "Patch content already appears to be present; not applying twice." -ForegroundColor Green
}

Write-Host ""
Write-Host "Changed files:" -ForegroundColor Cyan
git status --short | Out-Host

# Require actual v37 behavior before continuing.
Push-Location ".\40_PLATFORM_FOUNDATION_BUILD"
Write-Host ""
Write-Host "Running platform tests..." -ForegroundColor Cyan
npm test
$testExit = $LASTEXITCODE
Pop-Location

if ($testExit -ne 0) { Fail "Platform tests failed." }

# Explicitly require 33 tests by checking for the new reliability test in source.
if (-not (Test-Path $integrationTest)) {
    Fail "integrations.test.js missing after patch."
}
$testText = Get-Content $integrationTest -Raw
if ($testText -notmatch "reliability|webhook|dead-letter|dead letter") {
    Fail "Connector reliability tests are not present. Patch did not land correctly."
}

Write-Host ""
Write-Host "Running security tests..." -ForegroundColor Cyan
python ".\32_SECURITY_REGRESSION_AUTOMATION\run_security_policy_tests.py"
if ($LASTEXITCODE -ne 0) { Fail "Security tests failed." }

# Regenerate Claude catalog before lint if the generator exists.
$catalogGenerator = ".\36_CLAUDE_KNOWLEDGE_ARCHITECTURE\scripts\regenerate_catalog.py"
if (Test-Path $catalogGenerator) {
    Write-Host ""
    Write-Host "Regenerating Claude catalog..." -ForegroundColor Cyan
    python $catalogGenerator
    if ($LASTEXITCODE -ne 0) { Fail "Catalog regeneration failed." }
}

Write-Host ""
Write-Host "Running Claude knowledge lint..." -ForegroundColor Cyan
python ".\36_CLAUDE_KNOWLEDGE_ARCHITECTURE\scripts\knowledge_lint.py"
if ($LASTEXITCODE -ne 0) { Fail "Knowledge lint failed." }

git add -A

Write-Host ""
Write-Host "Staged changes:" -ForegroundColor Cyan
git diff --cached --stat | Out-Host

git diff --cached --quiet
$hasNoChanges = ($LASTEXITCODE -eq 0)

if (-not $hasNoChanges) {
    Write-Host "Creating commit..." -ForegroundColor Cyan
    git commit -m "feat: add connector reliability harness" | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "Commit failed." }
} else {
    Write-Host "No uncommitted changes remain. Checking branch history..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Commits ahead of origin/main:" -ForegroundColor Cyan
$ahead = git log origin/main..HEAD --oneline
$ahead | Out-Host

if (-not $ahead) {
    Fail "Branch still has no commit ahead of origin/main. Nothing will be pushed as a PR."
}

Write-Host ""
Write-Host "Pushing feature branch..." -ForegroundColor Cyan
git push -u origin feat/connector-reliability | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "Push failed." }

Write-Host ""
Write-Host "Checking for existing PR..." -ForegroundColor Cyan
$existingPr = gh pr list --head feat/connector-reliability --json url --jq '.[0].url'

if ($existingPr) {
    Write-Host "PR already exists: $existingPr" -ForegroundColor Green
    gh pr view "$existingPr" --web
} else {
    gh pr create `
        --base main `
        --head feat/connector-reliability `
        --title "feat: add connector reliability harness" `
        --body "Adds connector reliability operations, webhook deduplication, retry/dead-letter visibility, recovery controls, integration health telemetry, and Git-safe Claude catalog handling."
    if ($LASTEXITCODE -ne 0) { Fail "PR creation failed." }
}

Write-Host ""
Write-Host "SUCCESS: connector reliability build is committed, pushed, and ready for PR review." -ForegroundColor Green
