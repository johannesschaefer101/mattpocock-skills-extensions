# ticket-board

A Claude Code sidebar of the open tickets that the `/to-tickets` skill published. It sits beside the chat, groups the tickets by what can be done with them, and starts a session on one with a key press.

## What it shows

- **Tickets**: open GitHub sub-issues of a parent issue (the spec or plan that was broken down), and parentless issues labelled `ready-for-agent` or `ready-for-human`. Local tickets in `.scratch/<feature>/issues/*.md` are read too.
- **Groups**: Ready, Needs you (`ready-for-human`), Claimed (assigned), Blocked and In triage, with counts and the parent's progress in the banner.
- **Blocking**: GitHub's native issue dependencies; for local files the `Blocked by:` line. A "Blocked by" section in a GitHub issue body is not read.

Wayfinder maps and their tickets are left out: the [wayfinder-sidebar](https://github.com/nicksmits1/wayfinder-sidebar) shows those.

## Using it

The sidebar opens by itself when the project has open tickets; `/tickets` opens it at any time. Select a ticket to see what it waits on and what it unblocks.

| Key | Does |
| --- | --- |
| `i` / `k` | move up / down |
| `o` | open the ticket on GitHub (or its file) |
| `n` | start `/implement <ticket>` in a new iTerm tab or herdr pane, in the folder this session works in |
| `g` | put `/implement <ticket>` in this session's prompt box |
| `r` | refresh |

A blocked ticket is not started in a new tab or pane.

## The board as a herdr pane

`herdr/tickets` is the same board as a pane of herdr's own, with no Claude session behind it: a place to watch the tickets and the agents working on them, and to start more.

```
./scripts/install-herdr.sh
herdr-app do pane.split --direction right --mod tickets
```

The first line copies the mod into `~/.config/herdr-app/mods/tickets`; run it again after an update and open boards reload. The second line puts the board to the right of the focused pane; `herdr-app do tab.new --name Tickets --mod tickets` gives it a tab of its own. It shows the repository of the terminals beside it; click the repository name in its header to pick another folder.

For a key that opens and closes the board, add a line to the `global` section of `~/.config/herdr-app/keys.json`:

```
"cmd-shift-t": "mod.open:tickets"
```

The board then opens as a window floating over the layout, showing the repository of the selected space, and the same key closes it. Drag it where it should sit; herdr remembers the spot. Its size is the `overlay` entry in `herdr/tickets/mod.json`. herdr keeps an edited `keys.json` as yours, so shortcuts added by later herdr releases have to be added by hand.

Select a ticket and press **start agent** (or Enter): `claude '/implement <ticket>'` starts in the project folder, and the ticket moves to Claimed, where its row shows that agent's status for as long as the agent lives. **Agents open in** chooses where:

| Choice | The agent gets |
| --- | --- |
| One pane | one pane beside the board, shared by all agents started this way; the row of agents at the top of the board picks the one it shows |
| Split | a pane of its own in the board's tab |
| Tab | a tab of its own, named after the ticket, in the board's space |

The board stays where it is in all three. **show agent** goes to a running agent, **stop** ends it after a question, **open** opens the ticket. Keys while the board has the keyboard: `↑`/`↓` (or `i`/`k`) move, Enter or `n` starts or shows, `o` opens, `r` refreshes, Esc deselects.

- With One pane, the first agent owns the shared pane and the later ones start as its sub-agents: herdr's own agents list shows them under it, and they keep running when it ends.
- An agent started from the Claude Code sidebar's "new pane" shows up on the board as well.
- GitHub is read every five minutes, on refresh, and when an agent stops working; local ticket files when they change.
- Props, as in `--props '{"folder":"/path/to/project"}'`: `folder` (the project), `command` (the slash command, default `implement`), `argv` (the agent program, default `["claude"]`).

## Install

At the prompt of a terminal session:

```
/plugin install ticket-board --marketplace johannesschaefer101/to-tickets-sidebar
```

Answer `y` to add the marketplace, then choose a scope. From a shell:

```
claude plugin install ticket-board --marketplace johannesschaefer101/to-tickets-sidebar
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `johannesschaefer101/to-tickets-sidebar`, then Add plugin.

It needs the [`gh` CLI](https://cli.github.com), signed in, for GitHub tickets. New tabs need macOS with iTerm or Terminal.app; elsewhere the command is copied to the clipboard. New panes need herdr with its window open and `herdr-app` on the `PATH`, on any system.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `launcher` | `iterm` | Where new sessions open: `iterm`, `terminal`, `herdr` (a split to the right of the focused pane, which closes when that session ends), or `copy`. A session inside herdr opens a herdr pane while this is `iterm`; `terminal` and `copy` are kept |
| `refreshSeconds` | `300` | How often GitHub is re-read while the sidebar is open (at least 30) |
| `implementCommand` | `implement` | The slash command a ticket is started with |

## GitHub usage

One GraphQL request per refresh (5 of the 5,000 points an hour) and no REST calls. All sessions on a repository share one read, polling stops while the sidebar is closed, and the session re-reads only after a `gh` command that changes a ticket. At most 100 open issues per repository are read.

## Developing

```
claude --plugin-dir .        # run it from this folder
claude plugin validate .
claude plugin test .
./scripts/build-herdr.sh     # after a change to hooks/tickets.ts: rewrites herdr/tickets/tickets.js
herdr-app check herdr/tickets
./scripts/install-herdr.sh --watch   # macOS, once: herdr follows herdr/tickets from then on
```

herdr reloads a mod when a file in `~/.config/herdr-app/mods/<name>` is saved, but not through a symlink to this folder, so the mod there is a copy. `install-herdr.sh --watch` makes the copy and adds a launchd agent, `ticket-board.herdr-mod`, that copies again whenever `main.js`, `tickets.js` or `mod.json` in `herdr/tickets` changes: a save, a build, a checkout or a pull reaches open boards within a second or two. A broken save shows under `errors` in `herdr-app status` while the boards keep the last good version.

The agent is not part of the repository. It lives in `~/Library/LaunchAgents/ticket-board.herdr-mod.plist`, holds this checkout's path (run the script again if the folder moves) and starts at login. To remove it:

```
launchctl bootout gui/$(id -u)/ticket-board.herdr-mod
rm ~/Library/LaunchAgents/ticket-board.herdr-mod.plist
```

`herdr-app check` writes `gpui-kit.d.ts` and `jsconfig.json` into the folder it checks; `.gitignore` keeps them out.

## License

MIT
