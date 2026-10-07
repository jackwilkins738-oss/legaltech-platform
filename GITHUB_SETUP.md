# GitHub Canonical Repository Setup

The goal is to stop versioned ZIP/folder workflows and make one GitHub repository the source of truth.

## One-time setup on Windows
1. Extract/copy this repository to one permanent folder, for example:
   `C:\Users\<you>\Desktop\Proclaim\LegalTech`
2. Open PowerShell in that folder.
3. Run:
   `Set-ExecutionPolicy -Scope Process Bypass`
4. Run:
   `.\CONNECT_GITHUB.ps1`
5. GitHub CLI will ask you to authenticate in the browser if required.
6. The script creates a **private** repository named `legaltech-platform` in your account, runs tests/security/lint, commits, and pushes `main`.

To use a GitHub organisation or a different repository name:
`\.\CONNECT_GITHUB.ps1 -Owner YOUR_ORG -RepoName YOUR_REPO`

## Normal workflow afterwards
- `main` is the canonical branch.
- Create feature branches for substantive changes.
- Open PRs into `main`.
- GitHub Actions must be green before merge.
- Never commit real matter/client data, secrets, tokens, certificates, local SQLite files, or `.env` files.
- Keep raw TO evidence outside product-code changes until it has moved through the repository's evidence → analysis → decision gates.

## Recommended GitHub ruleset for `main`
After the initial push, configure a ruleset requiring:
- pull request before merge
- CI checks to pass
- branch up to date before merge
- conversation resolution
- no force pushes
- no deletion

For a two-founder repository, add both founders as repository collaborators and replace CODEOWNERS with the relevant usernames/team.
