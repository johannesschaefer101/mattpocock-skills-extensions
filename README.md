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
```

## License

MIT
