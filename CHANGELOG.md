# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- A session started with `/wayfinder <map> <ticket>` (as ▶ starts them) shows that ticket as its own from the first turn, and every other tab shows it as claimed, before the claim reaches the ticket file.
- Context bars: this session's context fill and that of each other tab holding a ticket, against a per-session budget (`contextBudget`, default 200k).

### Changed
- Tokyo Night colors (from LazyVim), with row tints mixed into the pane's grey, and a bold outline around the pane.
- Key hints sit in a bar pinned to the bottom of the docked pane.
- Context bars and claimed rows name tickets and context use instead of short session ids.
- New banner bar at the top of the pane: ◈ WAYFINDER on the left, ready / claimed / blocked / done counts on the right.
- The map destination wraps to two lines instead of being cut at one, and markdown such as `**bold**` is shown as plain text.
- A selected ticket's details name the ticket it unblocks next (preferring one that becomes ready), with a count of the rest, instead of a bare count.

## [0.1.0]

### Added
- Sidebar listing a wayfinder map's open tickets as Ready, Claimed and Blocked, colored by type.
- `▶` to start a new Claude Code session on a ticket, with an optional handoff from the current session.
- Picking several ready tickets and starting them with one shared handoff.
- Local markdown maps (`.scratch/<effort>/map.md`) and GitHub maps (`wayfinder:map` issues).
- Claim tracking across tabs, and a flash when tickets become unblocked.
- Linux fallbacks: `xdg-open` for opening tickets, and the clipboard for launch commands.
