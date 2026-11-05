# Contributing

Thanks for helping. Issues and pull requests are both welcome. For anything bigger than a small fix, open an issue first so we can agree on the shape before you write it.

## Good first contributions

- **Launchers for other terminals:** kitty, WezTerm, Ghostty, tmux, GNOME Terminal and so on. See `launchArgv` in `hooks/launch.ts`.
- **Ticket formats** the parser gets wrong. Attach the file (with private details removed) to an issue, or add it as a test case in `hooks/tracker.test.ts`.
- **Windows support**, which is untested.

## Run it from a clone

```sh
git clone https://github.com/nicksmits1/wayfinder-sidebar
cd wayfinder-sidebar
claude --plugin-dir .
```

That session loads the mod straight from the folder. Changes take effect when the turn that made them ends, or the next time you start the session. You need a project with a map to see anything. Run `/wayfinder` in a scratch repo to chart one, or copy the fixture from `hooks/pane.test.tsx` into a `.scratch/` folder.

If you installed the mod from the marketplace as well, disable that copy while developing (`/plugin` → wayfinder-sidebar → disable) so the two don't both load.

## Checks

Run these before opening a pull request. CI runs the first two.

```sh
claude plugin validate .   # manifest, hooks module and state contract
claude plugin test .       # hooks/*.test.ts(x)
tsc -p .                   # type-check (see below)
```

The first time Claude Code loads the mod, it writes the API types to `.claude-plugin/types/`, which `tsconfig.json` extends. That folder is gitignored. Run `claude --plugin-dir .` once before `tsc -p .` (TypeScript 5: `npx -p typescript@5 tsc -p .`).

## Layout

| File | What's in it |
|---|---|
| `hooks/register.tsx` | Events, loading the maps, actions and the pane drawing. Uses `$` (the engine). |
| `hooks/tracker.ts` | Pure parsing and status logic: ticket files, map bodies, GitHub issues, ready/blocked. |
| `hooks/launch.ts` | Pure strings: the handoff prompt, launch commands and platform choices. |
| `types/index.d.ts` | Shared types and the `$.state` contract. |
| `.claude-plugin/plugin.json` | Manifest and user settings. |

Keep logic you can test without `$` in `tracker.ts` or `launch.ts` and cover it in `tracker.test.ts`. The pane test (`pane.test.tsx`) mounts the sidebar against a fake file system.

If you change the fields of a value kept in `$.state`, bump its `shape` tag in `register.tsx` (for example `maps-1` → `maps-2`) so a running session drops the old value instead of misreading it.

## Pull requests

- Keep each PR to one change and explain why.
- Add or update a test for behavior changes.
- Update `README.md` for anything a user would notice, and add a line under **Unreleased** in `CHANGELOG.md`.
- For visual changes, a screenshot or GIF in the PR helps a lot.

## Releasing (maintainers)

1. Move the **Unreleased** notes in `CHANGELOG.md` under the new version.
2. Bump `version` in `.claude-plugin/plugin.json`.
3. Commit, tag `vX.Y.Z` and push the tag. Users get it with `/plugin marketplace update`.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
