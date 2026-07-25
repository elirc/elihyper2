# Publishes this repository to GitHub as hypernovaUSA/3build-nova.
#
# Everything is already committed locally: 15 stories delivered as 15 merged
# pull requests, each on its own branch with a PR-style merge commit. This
# script only pushes what exists.
#
# Run it AFTER authenticating, which has to be done interactively:
#
#   gh auth login
#
# Then:  .\push-to-github.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$Owner = 'hypernovaUSA'
$Repo  = '3build-nova'

Write-Host "Checking gh authentication..." -ForegroundColor Cyan
gh auth status
if ($LASTEXITCODE -ne 0) { throw "Not authenticated. Run 'gh auth login' first." }

Write-Host "`nCreating $Owner/$Repo (private)..." -ForegroundColor Cyan
# --source=. adds the remote and pushes the current branch in one step.
gh repo create "$Owner/$Repo" --private --source=. --remote=nova --push
if ($LASTEXITCODE -ne 0) { throw "Repository creation failed." }

Write-Host "`nPushing every story branch..." -ForegroundColor Cyan
# Pushed so the branches exist on GitHub and each PR's commits are browsable.
# They will show as already merged into main, because they are.
$branches = git branch --list 'feat/*' --format='%(refname:short)'
foreach ($b in $branches) {
  Write-Host "  $b"
  git push nova "${b}:${b}" --quiet
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  Repository: https://github.com/$Owner/$Repo"
Write-Host "  Actions:    https://github.com/$Owner/$Repo/actions"
Write-Host ""
Write-Host "Next steps you may want:" -ForegroundColor Yellow
Write-Host "  gh repo edit $Owner/$Repo --visibility public --accept-visibility-change-consequences"
Write-Host "  gh api -X PUT repos/$Owner/$Repo/collaborators/USERNAME -f permission=push"
