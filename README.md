# mattpocock-skills-extensions

Extensions for [Matt Pocock's skills](https://github.com/mattpocock/skills): for each skill, a view of what it produced and a way to start agents on it. Today these are native mods of the herdr app and Claude Code sidebars.

| Skill | Folder | herdr mod | Claude Code plugin |
| --- | --- | --- | --- |
| `/to-tickets` | [to-tickets](to-tickets) | `tickets` | `ticket-board` |
| `/wayfinder` | [wayfinder](wayfinder) | `wayfinder` | `wayfinder-sidebar` |

Each folder has its own README.

## herdr mods

```
./scripts/install-herdr.sh
herdr-app do pane.split --direction right --mod tickets
herdr-app do pane.split --direction right --mod wayfinder
```

The first line copies both mods into `~/.config/herdr-app/mods`; each of the others puts a board to the right of the focused pane. See [to-tickets](to-tickets/README.md#the-board-as-a-herdr-pane) and [wayfinder](wayfinder/README.md#the-maps-as-a-herdr-pane) for keys, props and where agents open.

## Claude Code plugins

```
/plugin install ticket-board --marketplace johannesschaefer101/mattpocock-skills-extensions
/plugin install wayfinder-sidebar --marketplace johannesschaefer101/mattpocock-skills-extensions
```

## wayfinder

`wayfinder` is a `git subtree` of [johannesschaefer101/wayfinder-sidebar](https://github.com/johannesschaefer101/wayfinder-sidebar), a fork of [nicksmits1/wayfinder-sidebar](https://github.com/nicksmits1/wayfinder-sidebar) by Nick Smits, under its own MIT [LICENSE](wayfinder/LICENSE). This copy leaves out the fork's own repository files (CI, contributing documents, demo videos) and adds the herdr mod. To take in changes from the fork, and delete those files again if the pull brings a conflict on them:

```
git subtree pull --prefix=wayfinder git@github.com:johannesschaefer101/wayfinder-sidebar.git graphql-github-loading
```

## License

MIT
