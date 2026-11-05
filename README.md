# wayfinder-sidebar

A Claude Code sidebar for [Matt Pocock's `/wayfinder`](https://github.com/mattpocock/skills) maps. It lists the map's open tickets grouped as **Ready**, **Claimed** and **Blocked**, colors each row by ticket type, and gives every row two buttons: one opens the ticket, the other starts a new Claude Code session working it. Before launching, it can have the current session write a handoff for the new one.

It reads your tracker as it is. Wayfinder, grilling and handoff skill files are never edited.

```
◎ I4 submitted on Canvas
  4 ready · 2 claimed · 10 blocked · ✓ 5 done
──────────────────────────────────────────────────
▸ Ready 4
▐ grill  07 P3: user-confirmed paym…        md  ▶ ▌
▐ task   10 Enforce bag allowance s…        md  ▶ ▌
◐ Claimed 2
▐ grill  06 P1 & P2: server-side co… ⠹ you  md  ▶ ▌
▐ task   09 Implement identity & se…  ⠹ 4f2  md  ▶ ▌
⧗ Blocked 10
▐ task   13 Implement P1/P2 policy … 06 +2  md  ▶ ▌
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install wayfinder-sidebar --marketplace <owner>/wayfinder-sidebar
```

From a shell:

```
claude plugin install wayfinder-sidebar --marketplace <owner>/wayfinder-sidebar
```

The sidebar docks beside the chat in fullscreen mode when the terminal is at least 110 columns wide. It opens by itself when the working directory has a map, and `/wayfinder-map` opens it any time.

## What it shows

- **Row chips.** The word at the left is the ticket type (`grill`, `proto`, `rsrch`, `task`) in its color. A solid word means the ticket needs you (HITL); a cut-out word means an agent can run it alone (AFK). The rest of the row is tinted in the same color.
- **Status.** Claimed tickets show a spinner and who holds them: `you` for this session, a short session id for another Claude Code tab running this mod, or `tab` otherwise. Blocked tickets show the ids they wait on, colored by those tickets' types.
- **Unblocking.** When a ticket resolves, the tickets it unblocked flash once as they move into Ready.
- **Fog and decisions.** The map's "Not yet specified" and resolved counts sit at the bottom; `r` lists the resolved tickets.

## Buttons and keys

Each row ends with `md` (or `gh`), which opens the ticket file in your editor or the issue in the browser, and `▶`, which starts a session on it. `▶` only works on ready tickets.

Pressing `▶` opens a confirmation under the row:

- **handoff + start** (`h`): the mod asks the current session to write a handoff note for the next one, then shows **launch** (`l`), **view** (`v`) and **discard** (`d`).
- **fresh** (`f`): launch straight away with no handoff.
- **cancel** (`c`).

With the pane focused (`ctrl+x`): `j`/`k` move, `o` opens, `s` starts, `x` picks several ready tickets so one `s` starts them all with one shared handoff, `r` shows resolved tickets, `g` refreshes. The mouse wheel scrolls the pane.

## Handoffs

The mod sends the current session a prompt asking it to write the note. The prompt follows the rules from the `handoff` skill (read from `~/.claude/skills/handoff/SKILL.md` when installed). Notes are saved under your system temp folder (`$TMPDIR/wayfinder-handoffs/`), never in the repo. Starting several tickets at once writes one note with a section per ticket. A note is deleted once all its tickets close, or after a week.

The new session starts as:

```
claude "/wayfinder <map> <ticket>  Context from the session that launched this one: read the \"## <ticket>\" section of <note> before anything else."
```

## Trackers

- **Local markdown**: `.scratch/<effort>/map.md` with tickets in `tickets/` or `issues/`. Both ticket shapes work: YAML frontmatter (`title`, `type`, `status`, `assignee`, `blocked_by`) and the skill doc's lines (`# Title`, `Type:`, `Status:`, `Blocked by:`).
- **GitHub**: open issues labelled `wayfinder:map` in the working directory's repository, read with the `gh` CLI. Tickets are the map's sub-issues (or a task list in its body), typed by `wayfinder:<type>` labels, and blocked by GitHub's native issue dependencies (or a `Blocked by: #n` line).

Task tickets count as AFK unless the file has `hitl: true` or the issue has a `wayfinder:hitl` label.

## How it stays current

Every tab running Claude Code runs its own copy of the mod against the same tracker. A tab's own edits to ticket files show at once; other tabs' edits show within a few seconds (the mod checks modification times); GitHub maps refresh every 45 seconds.

## Settings

In `/plugin` → wayfinder-sidebar → configure, or under `pluginConfigs` in settings:

| Setting | Default | |
|---|---|---|
| `launcher` | `iterm` | `iterm` (new iTerm tab), `terminal` (new Terminal.app window) or `copy` (copy the command) |
| `editor` | system default | command that opens a ticket file, such as `code`, `cursor` or `zed` |
| `pollSeconds` | `3` | how often local files are checked |
| `githubSeconds` | `45` | how often GitHub maps are re-read |

The first launch into iTerm or Terminal makes macOS ask whether Claude Code may control that app.

## Credits

Built for [Matt Pocock's skills](https://github.com/mattpocock/skills) (`wayfinder`, `grilling`, `handoff`). Ticket colors follow the Proschi plugin's palette.
