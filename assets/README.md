# Assets

- `icon.svg`: source for `.claude-plugin/icon.png`. Re-render with `rsvg-convert -w 1024 -h 1024 assets/icon.svg -o .claude-plugin/icon.png`.
- `demo.gif`: the hero GIF at the top of the README.
- `sidebar.png`: a still of the sidebar beside a chat.

## Recording the demo

The best moment to show is a new terminal tab opening already working the ticket. That tab opens outside the current terminal, so record the whole screen, not the terminal session.

1. Use a map with a few ticket types and at least one ticket of each status. Make the terminal about 160 columns wide and use a large font (16–18 pt) so the GIF stays readable when scaled down.
2. Record with [Kap](https://getkap.co) (exports GIF directly) or Cmd+Shift+5, then convert with `gifski --fps 15 --width 1200 in.mov -o demo.gif`.
3. Show, in about 10 seconds: select a ready ticket → `▶` → **handoff + start** → the spinner while the note is written → **launch** → the new iTerm tab starting `/wayfinder`.
4. Keep it under about 5 MB. Trim dead time at the start and end.
