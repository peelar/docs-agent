# Documentation editing and publishing

Paige opens a workspace, edits files, shows the changes for review, and
publishes those exact reviewed changes as a draft pull request.

Authoring and publishing are separate:

1. `documentation_edit` opens the workspace and lets Paige list, search, read,
   write, remove, and review documentation files.
2. A review returns the complete patch and a `reviewId`. The ID covers the
   starting commit, changed paths, and exact resulting bytes.
3. `documentation_publish` always requires human approval and accepts that
   exact `reviewId`.
4. Publishing saves the request, creates a local checkpoint, writes the commit
   through GitHub, verifies the remote bytes, and creates a draft pull request.

The local checkpoint is not pushed. It lets Paige safely resume if publishing
stops after approval but before the GitHub work finishes. Recovery accepts only
known steps in that flow and refuses unknown branches, commits, or edits.

## Vocabulary

- `workspace`: the protected editable copy of the documentation repository
- `workspace record`: saved information needed to reopen and recover it
- `editor`: bounded file reading and editing inside the workspace
- `review`: the patch and changed paths shown before publishing
- `reviewId`: the SHA-256 ID for the exact reviewed changes
- `publish request`: the reviewed ID, branch, and commit message approved for
  publishing
- `publish checkpoint`: the local commit that freezes the reviewed changes
- `publish recovery`: restoration after an interrupted publish attempt
- `GitHub publisher`: the trusted remote branch, commit, and draft-PR writer
