# mattpocock-skills-extensions

Extensions for [Matt Pocock's skills](https://github.com/mattpocock/skills): for each skill, a view of what it produced and a way to start agents on it. Today these are native mods of the herdr app and Claude Code sidebars.

| Skill | Folder | herdr mod | Claude Code plugin |
| --- | --- | --- | --- |
| `/to-tickets` | [to-tickets](to-tickets) | `tickets` | `ticket-board` |
| `/wayfinder` | [wayfinder](wayfinder) | planned | `wayfinder-sidebar` |

Each folder has its own README.

## herdr mods

```
./scripts/install-herdr.sh
herdr-app do pane.split --direction right --mod tickets
```

The first line copies the mod into `~/.config/herdr-app/mods/tickets`. See [to-tickets](to-tickets/README.md#the-board-as-a-herdr-pane) for keys, props and where agents open.

## Claude Code plugins

```
/plugin install ticket-board --marketplace johannesschaefer101/mattpocock-skills-extensions
/plugin install wayfinder-sidebar --marketplace johannesschaefer101/mattpocock-skills-extensions
```

## wayfinder

`wayfinder` is a `git subtree` of [johannesschaefer101/wayfinder-sidebar](https://github.com/johannesschaefer101/wayfinder-sidebar), a fork of [nicksmits1/wayfinder-sidebar](https://github.com/nicksmits1/wayfinder-sidebar) by Nick Smits, under its own MIT [LICENSE](wayfinder/LICENSE). To take in changes from the fork:

```
git subtree pull --prefix=wayfinder git@github.com:johannesschaefer101/wayfinder-sidebar.git graphql-github-loading
```

## License

MIT
