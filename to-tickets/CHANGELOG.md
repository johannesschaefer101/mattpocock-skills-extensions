# Changelog

Changes to the `ticket-board` plugin and the `tickets` herdr mod. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.1]

### Removed
- herdr pane: **handoff + start agent**. A ticket holds what its session needs, so a session starts on the ticket alone. Notes written earlier are still removed after a week.

## [0.3.0]

### Added
- herdr pane: **handoff + start agent** asks an agent at work in the project for a handoff note on the ticket and starts the session when the note is saved.
- herdr pane: a handoff note is removed when its ticket closes, after a week, or when the handoff was cancelled or started without.
- herdr pane: a ticket that stops being blocked while the board is open is marked "new".
- An icon for the plugin.

### Changed
- The plugin lives in the `to-tickets` folder of `johannesschaefer101/mattpocock-skills-extensions` and is installed from that marketplace. An install from the earlier marketplace, `to-tickets-sidebar`, gets no updates: add the new one and install again.
- herdr pane: agents open in a split or a tab. "One pane", where all agents shared one pane, is gone.
- herdr pane: the pane shares its code with the wayfinder one (`scripts/herdr/board.js`).
- The launchd agent of `install-herdr.sh --watch` is `mattpocock-skills-extensions.herdr-mods`; running the script removes the earlier `ticket-board.herdr-mod`.

### Fixed
- herdr pane: a board opened while another board was open in another space showed that space's project.
- herdr pane: the tab made for a ticket kept its number instead of the ticket's name.

## [0.2.0]

### Added
- The `herdr` launcher: a ticket starts in a new herdr pane.
- The board as a pane of the herdr app (`herdr/tickets`), as a split, a tab or a floating window, with an install script and a watcher that keeps herdr's copy current.

## [0.1.0]

### Added
- The sidebar of the open tickets `/to-tickets` published: Ready, Needs you, Claimed, Blocked and In triage, from GitHub sub-issues and local `.scratch/<feature>/issues` files.
