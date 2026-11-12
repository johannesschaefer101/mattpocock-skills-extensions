# mattpocock-skills-extensions

Extensions for [Matt Pocock's skills](https://github.com/mattpocock/skills): for each skill, a view of what it produced and a way to start agents on it. Each comes as a Claude Code plugin, a sidebar beside the chat, and as a mod for herdr, a desktop app for terminals and coding agents, where the same board is a pane. herdr is optional: the sidebars work without it.

| Skill | Folder | Claude Code plugin | herdr mod |
| --- | --- | --- | --- |
| `/to-tickets` | [to-tickets](to-tickets) | `ticket-board` | `tickets` |
| `/wayfinder` | [wayfinder](wayfinder) | `wayfinder-sidebar` | `wayfinder` |

Each folder has its own README.

`wayfinder` is by Nick Smits: a fork of [nicksmits1/wayfinder-sidebar](https://github.com/nicksmits1/wayfinder-sidebar), under its own MIT [LICENSE](wayfinder/LICENSE), with the herdr mod added.

## Claude Code plugins

At the prompt of a Claude Code session:

```
/plugin install ticket-board --marketplace johannesschaefer101/mattpocock-skills-extensions
/plugin install wayfinder-sidebar --marketplace johannesschaefer101/mattpocock-skills-extensions
```

Nothing else is needed: the plugins install straight from GitHub.

## herdr mods

The mods need a clone of this repository. From the repository root:

```
./scripts/install-herdr.sh
herdr-app do pane.split --direction right --mod tickets
herdr-app do pane.split --direction right --mod wayfinder
```

The first line copies both mods into `~/.config/herdr-app/mods`; each of the others puts a board to the right of the focused pane. See [to-tickets](to-tickets/README.md#the-board-as-a-herdr-pane) and [wayfinder](wayfinder/README.md#the-maps-as-a-herdr-pane) for keys, props and where agents open.

## Developing

`wayfinder` is a `git subtree` of [johannesschaefer101/wayfinder-sidebar](https://github.com/johannesschaefer101/wayfinder-sidebar), the fork named above. This copy leaves out the fork's own repository files (CI, contributing documents, demo videos). To take in changes from the fork, and delete those files again if the pull brings a conflict on them:

```
git subtree pull --prefix=wayfinder git@github.com:johannesschaefer101/wayfinder-sidebar.git graphql-github-loading
```

## License

MIT
