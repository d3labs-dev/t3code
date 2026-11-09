# Sourced by scripts/custom-nightly-linux.sh. Files and closes the issues
# Chamaquita works: one per upstream nightly that does not merge or does not
# build on the customization branch. Chamaquita's pull request closes its issue
# when it merges, so a build that fails after that merge files a fresh issue.
# Needs `repository` and `branch` set by the caller.

job_title_suffix=": make it merge and build on ${branch}"

job_title() {
  printf 'Upstream nightly %s%s' "$1" "$job_title_suffix"
}

open_job_issues() {
  gh issue list --repo "$repository" --state open --limit 100 --json number,title \
    --jq ".[] | select(.title | endswith(\"${job_title_suffix}\")) | \"\(.number)\t\(.title)\""
}

# Closes every Job issue and Job pull request except the given tag's.
close_job_work() {
  local keep_tag="$1" reason="$2"
  local keep_title keep_branch number title
  keep_title="$(job_title "$keep_tag")"
  keep_branch="chamaquita/upstream-${keep_tag}"
  while IFS=$'\t' read -r number title; do
    [[ -n "$number" && "$title" != "$keep_title" ]] || continue
    gh issue close "$number" --repo "$repository" --comment "$reason"
  done < <(open_job_issues)
  for number in $(
    gh pr list --repo "$repository" --state open --base "$branch" --limit 100 --json number,headRefName \
      --jq ".[] | select((.headRefName | startswith(\"chamaquita/upstream-\")) and .headRefName != \"${keep_branch}\") | .number"
  ); do
    gh pr close "$number" --repo "$repository" --delete-branch --comment "$reason"
  done
}

# Files the Job issue for a tag unless one is already open, which means a Job
# is already working it. $2 is the Markdown that says what failed.
file_job_issue() {
  local tag="$1" failure="$2"
  local title job_branch issue_url
  title="$(job_title "$tag")"
  if open_job_issues | cut -f2 | grep -xF "$title" >/dev/null; then
    echo "An open issue already tracks ${tag}."
    return 0
  fi
  close_job_work "$tag" "Superseded by ${tag}."
  gh label create chamaquita --repo "$repository" --force --color 5319e7 \
    --description "Chamaquita works this issue as a Job" ||
    echo "Warning: could not create the chamaquita label."
  gh label create automerge --repo "$repository" --force --color 0e8a16 \
    --description "Chamaquita merges the Job's pull request once its checks pass" ||
    echo "Warning: could not create the automerge label."
  job_branch="chamaquita/upstream-${tag}"
  issue_url="$(gh issue create --repo "$repository" --title "$title" --body "$(cat <<EOF
Upstream nightly [${tag}](https://github.com/pingdotgg/t3code/releases/tag/${tag}) from \`main\` does not yet merge and build on \`${branch}\`, so no custom build is published. Chamaquita fixes it and, because this issue carries \`automerge\`, merges her pull request.

Base branch: \`${branch}\`
Job branch: \`${job_branch}\`
Upstream tag: \`${tag}\` from https://github.com/pingdotgg/t3code.git

${failure}

## Task

1. Start \`${job_branch}\` from \`origin/${branch}\`, or continue it if an earlier attempt pushed it. If \`git merge-base --is-ancestor ${tag} HEAD\` fails, fetch the tag with \`git fetch --no-tags https://github.com/pingdotgg/t3code.git tag ${tag}\` and merge it with \`git merge --no-ff ${tag}\`. Never rebase, squash, or cherry-pick: the nightly decides what is merged with that ancestor check, so only a merge commit keeps the tag an ancestor.
2. Resolve each conflicted hunk:
   - Classify it as disjoint (the sides changed different things, so keep both), same question with different answers (pick one side on the evidence), or superseded (one side's change makes the other's moot).
   - Touch only the conflicted regions, and leave every line git merged cleanly as it is.
   - Keep the fork's customizations and take upstream's changes. The fork's intent is in \`git log ${tag}..origin/${branch}\`; upstream's is in \`git log origin/${branch}..${tag}\` and its pull requests.
   - Take upstream's \`pnpm-lock.yaml\` and run \`pnpm install --ignore-scripts\` to reconcile it with the merged manifests.
3. Fix whatever stops it building. Upstream moves and renames code without conflicts, so adapt the fork's code to upstream's changes rather than editing upstream files. If the failure is not in the code, such as a missing secret, code signing, or a runner problem, change nothing and finish blocked with the reason.
4. Push \`${job_branch}\` and open a pull request into \`${branch}\`. Its body starts with \`Closes #\` and this issue's number, then has a table with one row per conflicted hunk or fix and the columns File:lines, Class, ${branch}, Upstream, Kept, and Why. If a push is refused for the workflows permission, change nothing and finish blocked with that reason.
5. The fork has no CI, so run \`vp run typecheck\` and \`vp run build:desktop\` before pushing. Once the pull request merges, the next nightly run publishes the build.
EOF
  )")"
  gh issue edit "$issue_url" --repo "$repository" --add-label chamaquita --add-label automerge ||
    echo "Warning: could not label ${issue_url} for Chamaquita."
}
