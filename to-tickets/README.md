# to-tickets: ticket-board

The `/to-tickets` extension of [mattpocock-skills-extensions](../README.md): the Claude Code plugin `ticket-board` and the herdr mod `tickets`.

`ticket-board` is a Claude Code sidebar of the open tickets that the `/to-tickets` skill published. It sits beside the chat, groups the tickets by what can be done with them, and starts a session on one with a key press. `tickets` is [the same board as a herdr pane](#the-board-as-a-herdr-pane).

## What it shows

- **Tickets**: open GitHub sub-issues of a parent issue (the spec or plan that was broken down), and parentless issues labelled `ready-for-agent` or `ready-for-human`. Local tickets in `.scratch/<feature>/issues/*.md` are read too.
- **Groups**: Ready, Needs you (`ready-for-human`), Claimed (assigned), Blocked and In triage, with counts and the parent's progress in the banner.
- **Blocking**: GitHub's native issue dependencies; for local files the `Blocked by:` line. A "Blocked by" section in a GitHub issue body is not read.

Wayfinder maps and their tickets are left out: the [wayfinder-sidebar](../wayfinder) shows those.

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

`to-tickets/herdr/tickets` is the same board as a pane of herdr's own, with no Claude session behind it: a place to watch the tickets and the agents working on them, and to start more.

From the repository root:

```
./scripts/install-herdr.sh
herdr-app do pane.split --direction right --mod tickets
```

The first line copies every mod of this repository into `~/.config/herdr-app/mods`, this one as `tickets`; run it again after an update and open boards reload. The second line puts the board to the right of the focused pane; `herdr-app do tab.new --name Tickets --mod tickets` gives it a tab of its own. It shows the repository of the terminals beside it; click the repository name in its header to pick another folder.

For a key that puts the board beside the focused pane, add a line to the `global` section of `~/.config/herdr-app/keys.json`:

```
"cmd-shift-t": { "command": "pane.split", "args": { "direction": "right", "mod": "tickets", "props": { "side": "left" } } }
```

herdr splits to the right or below only; with `side` the board then trades places with the pane it was split from and sits on its left. Leave `props` out to keep it on the right. Each press adds a board; herdr's close-pane key closes it. herdr keeps an edited `keys.json` as yours, so shortcuts added by later herdr releases have to be added by hand.

`"cmd-shift-t": "mod.open:tickets"` instead opens the board as a window floating over the layout, showing the repository of the selected space, and the same key closes it. Drag it where it should sit; herdr remembers the spot. Its size is the `overlay` entry in `to-tickets/herdr/tickets/mod.json`.

Select a ticket and press **start agent** (or Enter): `claude '/implement <ticket>'` starts in the project folder, and the ticket moves to Claimed, where its row shows that agent's status for as long as the agent lives. **Agents open in** chooses where:

| Choice | The agent gets |
| --- | --- |
| Split | a pane of its own in the board's tab |
| Tab | a tab of its own, named after the ticket, in the board's space |

The board stays where it is in both. The row of agents at the top of the board goes to one with a click. **show agent** goes to a running agent, **stop** ends it after a question, **open** opens the ticket. Keys while the board has the keyboard: `↑`/`↓` (or `i`/`k`) move, Enter or `n` starts or shows, `o` opens, `r` refreshes, Esc deselects.

- **handoff + start agent** is there when an agent is at work in the project (with several, it asks which one). That agent is asked to write a handoff note for the ticket, and the session starts when the note is saved, told to read it first. **start without** starts at once, **cancel** drops the note. Notes go in `$TMPDIR/ticket-board-handoffs/`, never in the repository, and are removed when the ticket closes, after a week, or when the handoff was cancelled or started without. One ticket at a time.
- A ticket that stops being blocked while the board is open is marked **new** for five minutes, or until it is selected.
- An agent started from the Claude Code sidebar's "new pane" shows up on the board as well.
- GitHub is read every five minutes, on refresh, and when an agent stops working; local ticket files when they change.
- Props, as in `--props '{"folder":"/path/to/project"}'`: `folder` (the project), `command` (the slash command, default `implement`), `argv` (the agent program, default `["claude"]`), `side` (`"left"`: the board moves left of the pane it was split from).

## Install

At the prompt of a terminal session:

```
/plugin install ticket-board --marketplace johannesschaefer101/mattpocock-skills-extensions
```

Answer `y` to add the marketplace, then choose a scope. From a shell:

```
claude plugin install ticket-board --marketplace johannesschaefer101/mattpocock-skills-extensions
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `johannesschaefer101/mattpocock-skills-extensions`, then Add plugin.

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

From the repository root:

```
claude --plugin-dir to-tickets   # run it from this checkout
claude plugin validate to-tickets
claude plugin test to-tickets
./scripts/build-herdr.sh     # after a change to to-tickets/hooks/tickets.ts: rewrites to-tickets/herdr/tickets/tickets.js
herdr-app check to-tickets/herdr/tickets
./scripts/install-herdr.sh --watch   # macOS, once: herdr follows every mod of this checkout from then on
```

herdr reloads a mod when a file in `~/.config/herdr-app/mods/<name>` is saved, but not through a symlink to this folder, so the mod there is a copy. `install-herdr.sh` copies every mod it finds under `*/herdr/*/`, this one and the wayfinder one: each mod's `*.js` files and its `mod.json`. With `--watch` it also adds a launchd agent, `mattpocock-skills-extensions.herdr-mods`, that copies again whenever one of those files changes in any of the mods: a save, a build, a checkout or a pull reaches open boards within a second or two. A broken save shows under `errors` in `herdr-app status` while the boards keep the last good version.

The agent is not part of the repository. It lives in `~/Library/LaunchAgents/mattpocock-skills-extensions.herdr-mods.plist`, holds this checkout's path (run the script again if the folder moves) and starts at login. To remove it:

```
launchctl bootout gui/$(id -u)/mattpocock-skills-extensions.herdr-mods
rm ~/Library/LaunchAgents/mattpocock-skills-extensions.herdr-mods.plist
```

The pane is two parts. `scripts/herdr/board.js` is what this board and the wayfinder one share: where the pane is, which project it shows, starting, showing and stopping agents, handoff notes, and the drawing. `to-tickets/herdr/tickets/main.js` is what is this board's own: reading the tickets, their groups, and the lines under a selected ticket. A herdr mod is a plain folder of files, so each mod has a copy of the shared file as `board.js`: edit `scripts/herdr/board.js`, never the copies. `build-herdr.sh` and `install-herdr.sh` both write the copies, so with the launchd agent a save of the shared file reaches open boards too.

`herdr-app check` writes `gpui-kit.d.ts` and `jsconfig.json` into the folder it checks; `.gitignore` keeps them out.

## License

MIT
