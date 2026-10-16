# Commit guards

Two hooks keep the history clean of terms that must not ship in this project:

- `pre-commit` — refuses a commit if any **staged content** matches the denylist
- `commit-msg` — refuses a commit if the **message** matches the denylist

Both read their patterns from a file that is **not** part of the repository:

```
.git/nemi-forbidden-patterns
```

One extended regular expression per line; blank lines are ignored. Keeping the
list untracked is the point — the very words we filter would otherwise live in
the repo we are trying to keep free of them.

## Enabling

```sh
git config core.hooksPath .githooks
```

That is a per-clone setting, so nothing here changes a teammate's environment.
If the denylist file is missing, both hooks exit quietly and normal git
behaviour is unchanged.

## False positives

If a legitimate change trips a pattern, edit `.git/nemi-forbidden-patterns`
(remove or narrow the line) rather than bypassing the hook with `--no-verify`,
so the guard keeps meaning what it says.
