#!/usr/bin/env bash
set -euo pipefail

# Upstream repos for each subtree in referrences/
declare -A REFS=(
  ["BMAD-METHOD"]="https://github.com/bmad-code-org/BMAD-METHOD.git"
  ["OpenSpec"]="https://github.com/Fission-AI/OpenSpec.git"
  ["claude-task-master"]="https://github.com/eyaltoledano/claude-task-master.git"
  ["get-shit-done"]="https://github.com/gsd-build/get-shit-done.git"
  ["how-to-ralph-wiggum"]="https://github.com/ClaytonFarr/ralph-playbook.git"
  ["spec-kit"]="https://github.com/github/spec-kit.git"
)

for name in "${!REFS[@]}"; do
  url="${REFS[$name]}"
  remote="ref-${name}"
  prefix="referrences/${name}"

  # Add remote if it doesn't exist
  if ! git remote get-url "$remote" &>/dev/null; then
    echo "Adding remote: $remote -> $url"
    git remote add "$remote" "$url"
  fi

  echo "Pulling $name..."
  git subtree pull --prefix="$prefix" "$remote" main --squash -m "chore: update referrence $name" || \
    git subtree pull --prefix="$prefix" "$remote" master --squash -m "chore: update referrence $name" || \
    echo "  Warning: failed to pull $name (may need a different branch)"
done

echo "Done."
