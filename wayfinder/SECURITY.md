# Security

The mod runs a few local commands on your behalf: `gh` to read GitHub maps, `osascript` to open terminal tabs on macOS, your configured editor or `open`/`xdg-open` to open tickets, and `rm` on its own handoff notes in `$TMPDIR/wayfinder-handoffs/`. It sends ticket titles to the current Claude session when it asks for a handoff.

If you find a way to make it run something it shouldn't, such as a crafted ticket title or file name that escapes the launch command, please report it privately through [GitHub's private vulnerability reporting](https://github.com/nicksmits1/wayfinder-sidebar/security/advisories/new) instead of opening a public issue.
