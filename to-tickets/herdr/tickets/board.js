// Generated from scripts/herdr/board.js by scripts/build-herdr.sh. Do not edit.
// What the boards of this repository share: a pane that shows the tickets of a project in groups,
// knows which agent works on which, and starts, shows and stops agents. scripts/build-herdr.sh copies
// this file into each mod as board.js; a board is a class that extends Board and supplies what is
// its own, listed under "what a board supplies" below.
// Props: { folder?, argv?, side? } (the project; the agent program a ticket is given to, default
// ["claude"]; "left" to sit left of the pane it was split from).
// A session can start with a handoff note: an agent already at work in the project is asked to write
// one for the ticket, and the session starts when the note is saved.
// Keys bound to <mod>.up, <mod>.down, <mod>.start and <mod>.refresh in keys.json act on it too.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, panes, spaces, terminals, agents, props, run, theme, notify, openOverlay, pickFolder, watchFolder, nextCommand, window, home, focused } from "herdr";

const REFRESH_MS = 300000;
// A refresh the person or a finished agent asks for still waits this long after the last read of GitHub.
const FORCE_GAP_MS = 10000;
// How often a handoff note being written is looked for.
const HANDOFF_MS = 2000;
// How long a terminal just started may be missing from the window's list before it counts as gone.
const NEW_MS = 10000;
// A handoff note is removed after a week, as the wayfinder sidebar does. One that was cancelled is
// looked for this long: the agent asked for it may still write it.
const WEEK_MS = 7 * 86400000;
const DROPPED_MS = 3600000;
// How long a ticket that stopped being blocked is marked "new".
const FRESH_MS = 300000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Where a started agent goes. In both the board stays where it is.
const MODES = [
  { id: "split", label: "Split", about: "a pane of its own in this tab" },
  { id: "tab", label: "Tab", about: "a tab of its own in this space" },
];
const WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };

const local = (id) => (id?.includes("/") ? id.split("/").pop() : id);
const short = (path) => (path === home() ? "~" : path?.startsWith(home() + "/") ? "~" + path.slice(home().length) : path ?? "");
export const errorText = (e) => (e instanceof Error ? e.message : String(e)).replace(/^gh:\s*/, "").slice(0, 200);

export class Board extends View {
  // ---------- what a board supplies ----------
  // A set is a list of tickets with a title: { key, title, tickets }. A ticket has { id, title },
  // an assignee and a url or a path.

  /** The mod's name, and the heading of the pane. */
  get mod() { return "board"; }
  get title() { return "Board"; }
  /** The prefix of the labels a started terminal gets: <label>.ticket and <label>.root. */
  get label() { return this.mod; }
  /** The groups a ticket can be in, by status: { ready: { label, color }, … }. */
  get groups() { return {}; }
  /** The words that differ: { start, pick, reading, none }. */
  get texts() { return { start: "start agent", pick: "Show tickets", reading: "Reading…", none: "Nothing here." }; }

  /** The sets read from the project's files, and from GitHub (`this.repo`, with `this.github` the last read). */
  async loadLocal() { return []; }
  async loadGithub() { return []; }
  /** The repository on GitHub as "owner/name", or null. */
  async findRepo() { return null; }
  /** The order the sets are shown in. */
  merge(files, github) { return [...github, ...files]; }

  /** What a started terminal's label holds for a ticket, unique in the project. */
  refOf(_set, t) { return t.id; }
  /** The same for a session someone started by hand, from the prompt it was given; undefined when it is none of these. */
  sessionRef(_prompt) { return undefined; }
  /** What the agent is started with. */
  sessionPrompt(_set, t, _handoffPath) { return t.id; }
  /** The ids of the tickets this one still waits on. */
  waits(_set, _t) { return []; }
  /** The tickets of a set by status, in the order they are drawn: [[status, tickets], …]. */
  grouped(_set, _running) { return []; }
  /** Where the handoff note for a ticket goes, and what the agent that writes it is asked. */
  handoffFile(tmp, _set, t, now) { return `${tmp}/${this.mod}-handoffs/${t.id}-${now}.md`; }
  handoffPrompt(_set, t, path, _skill) { return `Write a handoff note for ${t.id} ${t.title} to ${path}.`; }

  /** What stands right of the folder name, such as "✓ 3/8". */
  counter(_set) { return ""; }
  /** What a row shows between the title and its note. `quiet`: the row has no note and no agent. */
  chips(_t, _ticket, _quiet) { return []; }
  /** The lines under a selected ticket's title. */
  details(_t, _set, _ticket, _waits) { return []; }
  /** What stands above a set's tickets. */
  head(t, set, _rows) { return [div().flex_none().px(4).pt(10).font_semibold().child(set.title)]; }
  /** The name of an agent in the row of agents. */
  agentName(a) { return a.ref; }

  // ---------- starting ----------

  init(_props, cx) {
    this.sets = [];
    this.active = localStorage.getItem("active") ?? "";
    this.sel = "";
    this.mode = MODES.find((m) => m.id === localStorage.getItem("mode"))?.id ?? "split";
    this.error = "";
    this.lastGh = 0;
    this.names = new Map();
    this.fresh = new Map();
    this.handle = cx.focus_handle();
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.timer.every(HANDOFF_MS, (cx) => this.checkHandoff(cx));
    // "focus" arrives when pane.go moves onto this pane; the rest are keys.json's.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.key({ key: { up: "up", down: "down", start: "enter", refresh: "r" }[c] }, cx);
        cx.notify();
      }
    });
    // Opened by mod.open as a window, it gets no "focus": herdr leaves the keyboard where it was.
    if (props()?.overlay) cx.spawn(async (cx) => {
      for (const ms of [0, 100]) { await cx.sleep(ms); if (!this.handle.is_focused()) this.handle.focus(); }
      cx.notify();
    });
  }

  // ---------- where this is ----------

  me() {
    const all = panes();
    return all.find((p) => p.pane === props()?.pane) ?? all.find((p) => p.pane === this.pane);
  }

  // herdr does not tell a mod pane which pane it is. Only the boards of the shown tab are drawn, so
  // while this one is drawn and that tab has one board, that is it. Kept for when it is not drawn.
  // With several boards there, it is the one with the focus (a board just split in has it), else any
  // of them: they share the tab, which is what tells the project.
  findMe() {
    const tab = focused()?.tab, here = panes().filter((p) => p.mod === (props()?.mod ?? this.mod) && p.tab === tab);
    if (here.length === 1) this.pane = here[0].pane;
    else if (here.length && !here.some((p) => p.pane === this.pane)) this.pane = (here.find((p) => p.focused) ?? here[0]).pane;
    // The project is looked for once this is known. A board that starts while it is not shown (herdr
    // starts every board again when a file of the mod is saved) would take the shown space's project.
    return Boolean(this.pane) || Boolean(props()?.overlay);
  }

  // pane.split opens to the right or below only: with side "left", the board trades places with the
  // pane it was split from, once.
  place() {
    if (this.placed || props()?.side !== "left") return;
    // A pane just split in has the focus, which tells it from another board in the tab.
    const me = this.pane ?? panes().find((p) => p.focused && p.mod === (props()?.mod ?? this.mod))?.pane;
    if (!me) return;
    this.placed = true;
    run("pane.swap", { pane: me, direction: "left" });
  }

  space() {
    const tab = this.me()?.tab;
    return spaces().find((s) => s.tabs.some((t) => t.id === tab)) ?? spaces().find((s) => s.active);
  }

  argv() {
    const argv = props()?.argv;
    return Array.isArray(argv) && argv.length ? argv.map(String) : ["claude"];
  }

  // The project: the folder it was given or the person picked, else the first repository a terminal beside it is in.
  async locate() {
    const space = this.space(), tab = this.me()?.tab;
    const tabs = new Set(space?.tabs.map((t) => t.id));
    const beside = panes().filter((p) => p.cwd && tabs.has(p.tab)).sort((a, b) => Number(b.tab === tab) - Number(a.tab === tab)).map((p) => p.cwd);
    const given = [localStorage.getItem("folder"), props()?.folder].filter(Boolean);
    for (const cwd of [...given, ...beside, space?.folder]) {
      if (!cwd) continue;
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => null);
      if (top?.code === 0 && top.stdout.trim()) { this.root = top.stdout.trim(); return; }
    }
    this.root = given[0] ?? beside[0] ?? space?.folder ?? "";
  }

  watch(cx) {
    const root = this.root;
    if (!root) return;
    cx.spawn(async (cx) => {
      try { while (this.root === root) { await watchFolder(`${root}/.scratch`); if (this.root === root) this.refresh(cx); } }
      catch { /* no .scratch folder: the timer and the refresh button read it */ }
    });
  }

  choose(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: this.texts.pick });
      if (!folder) return;
      localStorage.setItem("folder", folder);
      this.repo = undefined; this.sets = []; this.github = undefined; this.lastGh = 0; this.error = "";
      await this.locate();
      this.refresh(cx, true);
      this.watch(cx);
    });
  }

  // ---------- loading ----------

  // Local files are read every time; GitHub once per REFRESH_MS, or after FORCE_GAP_MS when asked for.
  refresh(cx, force = false) {
    if (this.loading || !this.root) return;
    this.loading = true;
    const root = this.root;
    cx.spawn(async (cx) => {
      try {
        const files = await this.loadLocal().then((x) => { this.localRead = true; return x; }, () => { this.localRead = false; return []; });
        if (this.repo === undefined) this.repo = await this.findRepo();
        const age = Date.now() - this.lastGh;
        if (this.repo && age >= (force ? FORCE_GAP_MS : REFRESH_MS - 1000)) {
          this.lastGh = Date.now(); // a failed read waits out the interval too
          try { this.github = await this.loadGithub(); this.error = ""; }
          catch (e) { this.error = errorText(e); }
        }
        if (this.root !== root) return;
        this.sets = this.merge(files, this.github ?? []);
        this.loaded = true;
        this.mark();
        this.tidy();
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // ---------- agents ----------

  /** The live terminals working on this project's tickets, started here or by hand, by refOf. */
  running() {
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const withPane = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const out = new Map();
    for (const k of terminals()) {
      if (k.state !== "live" || k.address.includes("/")) continue;
      let ref = k.labels?.[`${this.label}.root`] === this.root ? k.labels[`${this.label}.ticket`] : undefined;
      const prompt = k.argv?.[k.argv.length - 1];
      if (!ref && prompt && /(^|\/)claude$/.test(k.argv?.[0] ?? "") && (k.cwd === this.root || k.cwd?.startsWith(this.root + "/"))) ref = this.sessionRef(prompt);
      if (!ref || out.has(ref)) continue;
      const status = listed.get(k.address) ?? (k.status === "error" ? "blocked" : k.status) ?? null;
      out.set(ref, { address: k.address, ref, status, pane: withPane.get(k.address) });
    }
    return out;
  }

  start(set, t, cx, handoffPath) {
    const running = this.running(), ref = this.refOf(set, t);
    if (running.has(ref)) { this.show(running.get(ref), cx); return; }
    const waits = this.waits(set, t);
    if (waits.length) { notify({ title: `${t.id} still waits on ${waits.join(" ")}`, body: "Not started.", level: "warning" }); return; }
    const space = this.space(), tab = this.me()?.tab;
    if (!space || space.machine) { notify({ title: "Agents start on this computer only", level: "error" }); return; }
    const args = ["run", "--bg", "--json", "--no-notify", "--cwd", this.root,
      "--label", `${this.label}.ticket=${ref}`, "--label", `${this.label}.root=${this.root}`];
    // A terminal with herdr's labels gets a pane there: in the board's tab, or in a tab of its own.
    if (this.mode === "tab" || !tab) args.push("--label", `herdr.space=${local(space.id)}`);
    else args.push("--label", `herdr.space=${local(space.id)}`, "--label", `herdr.tab=${local(tab)}`);
    args.push("--", ...this.argv(), this.sessionPrompt(set, t, handoffPath));
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
        if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || `hc run: exit ${r.code}`);
        // Named once the window knows the terminal: see follow().
        if (this.mode === "tab") this.names.set(address, { name: `${t.id} ${t.title}`.slice(0, 40), at: Date.now() });
        if (handoffPath) this.keep({ path: handoffPath, key: set.key, id: t.id, at: Date.now() });
      } catch (e) { notify({ title: `Could not start ${t.id}`, body: String(e).slice(0, 200), level: "error" }); }
      cx.notify();
    });
  }

  /** Brings an agent in front. One without a pane (started outside herdr's window) gets one in this tab. */
  show(a, cx) {
    if (a.pane) run("pane.focus", { terminal: a.address });
    else {
      const space = this.space(), tab = this.me()?.tab;
      if (!space || !tab) return;
      cx.spawn(async () => { await hc(["label", a.address, `herdr.space=${local(space.id)}`, `herdr.tab=${local(tab)}`]).catch(() => null); });
    }
    cx.notify();
  }

  stop(a, t) {
    openOverlay({ mod: "confirm", kind: "dialog", width: 380, height: 170,
      props: { title: `Stop the agent on ${t.id}?`, detail: "Its session ends. What it has written stays.", command: { name: "terminal.kill", args: { terminal: a.address } } } });
  }

  open(target) {
    if (target) exec(window()?.platform === "macos" ? "open" : "xdg-open", [target]).catch((e) => notify({ title: `Could not open ${target}`, body: String(e), level: "error" }));
  }

  // What waits for the window to know a new terminal: naming the tab made for a ticket. And a finished
  // agent makes GitHub worth reading again.
  follow(running, cx) {
    for (const [address, { name, at }] of this.names) {
      const pane = panes().find((p) => p.terminal === address);
      if (pane) { run("tab.rename", { id: pane.tab, name }); this.names.delete(address); }
      // The window learns of a new terminal a moment after hc has started it: not there yet is not gone.
      else if (Date.now() - at > NEW_MS && !terminals().some((k) => k.address === address && k.state === "live")) this.names.delete(address);
    }
    // herdr sends "focus" for pane.go only. When the pane beside the board closes, the board becomes
    // the focused pane without it, so the keyboard is taken here, once per time the focus arrives.
    const mine = this.me()?.focused === true;
    if (mine && !this.mine) cx.spawn(async (cx) => {
      // Asked for while this draws, the keyboard does not come; a second try in case herdr moves it after.
      for (const ms of [0, 100]) { await cx.sleep(ms); if (!this.handle.is_focused()) this.handle.focus(); }
      cx.notify();
    });
    this.mine = mine;
    const sig = [...running.values()].map((a) => `${a.address}:${a.status === "working"}`).sort().join(",");
    if (this.sig !== undefined && sig !== this.sig) this.refresh(cx, true);
    this.sig = sig;
  }

  // ---------- handoffs ----------

  /** The agents at work in this project that can be asked for a handoff note, by address. */
  writers(running) {
    // agents() has the agents with a pane; one without reports its status on the terminal.
    const listed = new Set(agents().map((a) => a.address));
    const onTicket = new Map([...running.values()].map((a) => [a.address, this.agentName(a)]));
    return terminals()
      .filter((k) => k.state === "live" && !k.address.includes("/") && (listed.has(k.address) || k.status) && (k.cwd === this.root || k.cwd?.startsWith(this.root + "/")))
      .map((k) => ({ address: k.address, name: onTicket.get(k.address) ?? `${String(k.title ?? "").trim()} ${k.address}`.trim() }));
  }

  /** Asks an agent for a handoff note on a ticket; checkHandoff() starts the session once the note is there. */
  beginHandoff(set, t, w, cx) {
    if (this.flow) { notify({ title: "A handoff is being written", body: "Start without it or cancel it first.", level: "warning" }); return; }
    const waits = this.waits(set, t);
    if (waits.length) { notify({ title: `${t.id} still waits on ${waits.join(" ")}`, body: "Not started.", level: "warning" }); return; }
    const flow = this.flow = { key: set.key, id: t.id, from: w.address, name: w.name, path: "", seen: 0 };
    cx.spawn(async (cx) => {
      try {
        const tmp = ((await exec("sh", ["-c", 'printf %s "${TMPDIR:-/tmp}"'])).stdout.trim() || "/tmp").replace(/\/$/, "");
        // The handoff skill's own rules, when it is installed.
        const skill = await exec("sh", ["-c", 'cat "$1/.claude/skills/handoff/SKILL.md" 2>/dev/null || cat "$1/.agents/skills/handoff/SKILL.md" 2>/dev/null', this.mod, home()]).catch(() => null);
        const path = this.handoffFile(tmp, set, t, Date.now());
        const r = await hc(["send", w.address, this.handoffPrompt(set, t, path, skill?.stdout.trim() || undefined)]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `hc send: exit ${r.code}`);
        flow.path = path;
        localStorage.setItem("notesDir", path.slice(0, path.lastIndexOf("/")));
        // Cancelled, or started without, while the request was on its way.
        if (this.flow !== flow) this.keep({ path, at: Date.now(), dropped: true });
      } catch (e) {
        if (this.flow === flow) this.flow = null;
        notify({ title: `Could not ask ${w.name} for a handoff`, body: String(e).slice(0, 200), level: "error" });
      }
      cx.notify();
    });
  }

  // The note counts once it has been there for two looks in a row, so a file still being written is not read.
  checkHandoff(cx) {
    const flow = this.flow;
    if (!flow?.path || flow.busy) return;
    flow.busy = true;
    cx.spawn(async (cx) => {
      try {
        const there = (await exec("test", ["-s", flow.path]).catch(() => null))?.code === 0;
        if (this.flow !== flow) return;
        flow.seen = there ? flow.seen + 1 : 0;
        const set = this.sets.find((x) => x.key === flow.key), t = set?.tickets.find((x) => x.id === flow.id);
        if (flow.seen >= 2 && set && t) { this.flow = null; this.start(set, t, cx, flow.path); }
        else if (!there && !terminals().some((k) => k.address === flow.from && k.state === "live")) {
          this.flow = null;
          notify({ title: `${flow.name} ended before the handoff for ${flow.id} was written`, body: "Not started.", level: "warning" });
        }
      } finally { flow.busy = false; cx.notify(); }
    });
  }

  /** Ends the wait for a note. With `start`, the session starts without one. Either way nobody will read the note. */
  endHandoff(set, t, start, cx) {
    const flow = this.flow;
    this.flow = null;
    if (start) this.start(set, t, cx);
    if (flow?.path) { this.keep({ path: flow.path, at: Date.now(), dropped: true }); this.tidy(); }
    cx.notify();
  }

  /** The handoff notes this board asked for: { path, at }, with the ticket (key, id) a session reads it for, or `dropped`. */
  notes() {
    try { return JSON.parse(localStorage.getItem("notes") ?? "[]"); } catch { return []; }
  }

  keep(note) {
    localStorage.setItem("notes", JSON.stringify([...this.notes().filter((n) => n.path !== note.path), note]));
  }

  // Removes the notes nobody will read: of a ticket that is closed, of a handoff that was cancelled or
  // started without (the agent asked for it may still write it), and any that is a week old.
  tidy() {
    const now = Date.now(), gone = [], kept = [];
    for (const n of this.notes()) {
      if (n.dropped) { gone.push(n.path); if (now - n.at < DROPPED_MS) kept.push(n); continue; }
      // A ticket counts as closed only when the list it would be in was read.
      const read = n.key.startsWith("github:") ? Boolean(this.github) && !this.error : this.localRead === true;
      const open = this.sets.find((s) => s.key === n.key)?.tickets.some((t) => t.id === n.id && !t.closed);
      if (now - n.at > WEEK_MS || (read && !open)) gone.push(n.path); else kept.push(n);
    }
    localStorage.setItem("notes", JSON.stringify(kept));
    if (gone.length) exec("rm", ["-f", ...gone]).catch(() => null);
    const dir = localStorage.getItem("notesDir");
    if (dir) exec("find", [dir, "-name", "*.md", "-mtime", "+7", "-delete"]).catch(() => null);
  }

  // ---------- newly ready ----------

  // A ticket that was blocked at the last read and is ready now is marked "new" for a while, or until it is selected.
  mark() {
    const running = this.running(), now = new Map();
    for (const set of this.sets) for (const [s, list] of this.grouped(set, running)) for (const t of list) now.set(this.refOf(set, t), s);
    for (const [ref, s] of now) if (s === "ready" && this.statuses?.get(ref) === "blocked") this.fresh.set(ref, Date.now());
    this.statuses = now;
  }

  isFresh(ref) {
    const at = this.fresh.get(ref);
    if (at && Date.now() - at > FRESH_MS) this.fresh.delete(ref);
    return this.fresh.has(ref);
  }

  // ---------- drawing ----------

  activeSet() {
    return this.sets.find((s) => s.key === this.active) ?? this.sets[0];
  }

  move(by) {
    const set = this.activeSet();
    const order = set ? this.grouped(set, this.running()).flatMap(([, list]) => list.map((t) => t.id)) : [];
    if (!order.length) return;
    const i = order.indexOf(this.sel);
    this.sel = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))];
  }

  key(e, cx) {
    const set = this.activeSet(), t = set?.tickets.find((x) => x.id === this.sel && !x.closed);
    const k = e.key;
    if (k === "up" || k === "i") this.move(-1);
    else if (k === "down" || k === "k") this.move(1);
    else if (k === "r") this.refresh(cx, true);
    else if (t && (k === "enter" || k === "n")) this.start(set, t, cx);
    else if (t && k === "o") this.open(t.url ?? t.path);
    else if (k === "escape") this.sel = "";
    else return;
    cx.stop_propagation?.();
    cx.notify();
  }

  button(t, id, label, onClick, primary = false) {
    return div().id(id).px(9).py(3).rounded(6).border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12).cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  dot(t, status) {
    const glyph = status === "working" ? SPIN[0] : status === "idle" || !status ? "○" : "●";
    return div().w(12).flex_none().text_color(t[status] ?? t.dim).when(status === "working", (el) => el.frames(SPIN, 90)).child(glyph);
  }

  row(t, set, ticket, s, running) {
    const ref = this.refOf(set, ticket), selected = this.sel === ticket.id, a = running.get(ref), color = t[this.groups[s].color];
    const waits = this.waits(set, ticket);
    if (selected) this.fresh.delete(ref);
    const fresh = s === "ready" && this.isFresh(ref);
    const note = a ? "" : s === "claimed" ? ticket.assignee : s === "blocked" ? `waits on ${waits.join(" ")}` : "";
    const out = [
      h_flex().id(`row-${ticket.id}`).h(28).flex_none().pr(8).gap(8).items_center().rounded(6).cursor_pointer().when(selected, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.handle.focus(); this.sel = selected ? "" : ticket.id; cx.notify(); })
        .child(div().w(3).h(18).flex_none().rounded(2).bg(color))
        .child(div().flex_none().text_color(t.dim).child(ticket.id))
        .child(div().flex_1().min_w(0).truncate().text_color(s === "blocked" ? t.muted : t.foreground).when(selected, (el) => el.font_semibold()).child(ticket.title))
        .when(fresh, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.selected).text_size(10).text_color(t.ansi2).child("new")))
        .children(this.chips(t, ticket, !a && !note))
        .when(Boolean(note), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(note)))
        .when(Boolean(a), (el) => el.child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(WORDS[a.status] ?? "running")).child(this.dot(t, a.status))),
    ];
    if (!selected) return out;
    const writing = this.flow?.key === set.key && this.flow.id === ticket.id, writers = this.writers(running);
    const canHandoff = !a && !writing && s === "ready" && writers.length > 0;
    out.push(
      v_flex().id(`detail-${ticket.id}`).flex_none().pl(19).pr(8).pt(2).pb(10).gap(3).text_size(12).text_color(t.muted)
        .child(div().text_color(t.foreground).child(ticket.title))
        .children(this.details(t, set, ticket, waits))
        .child(h_flex().pt(4).gap(6).flex_wrap()
          .child(a
            ? this.button(t, `show-${ticket.id}`, "show agent", (cx) => this.show(a, cx), true)
            : this.button(t, `start-${ticket.id}`, this.texts.start, (cx) => this.start(set, ticket, cx), s === "ready"))
          .when(Boolean(a), (el) => el.child(this.button(t, `stop-${ticket.id}`, "stop", () => this.stop(a, ticket))))
          .when(canHandoff, (el) => el.child(this.button(t, `handoff-${ticket.id}`, `handoff + ${this.texts.start}`, (cx) => {
            if (writers.length === 1) this.beginHandoff(set, ticket, writers[0], cx);
            else this.asking = this.asking === ticket.id ? "" : ticket.id;
            cx.notify();
          })))
          .child(this.button(t, `open-${ticket.id}`, "open", () => this.open(ticket.url ?? ticket.path))))
        .when(writing, (el) => el
          .child(div().pt(4).text_color(t.foreground).child(`${this.flow.name} writes a handoff; the session starts when it is saved`))
          .child(h_flex().pt(2).gap(6).flex_wrap()
            .child(this.button(t, `nohandoff-${ticket.id}`, "start without", (cx) => this.endHandoff(set, ticket, true, cx)))
            .child(this.button(t, `cancel-${ticket.id}`, "cancel", (cx) => this.endHandoff(set, ticket, false, cx)))))
        // With several agents at work, the button asks which of them writes the note.
        .when(canHandoff && this.asking === ticket.id && writers.length > 1, (el) => el
          .child(h_flex().pt(4).gap(6).items_center().flex_wrap()
            .child(div().flex_none().child("handoff from"))
            .children(writers.slice(0, 6).map((w) => this.button(t, `handoff-${ticket.id}-${w.address}`, w.name.slice(0, 24), (cx) => { this.asking = ""; this.beginHandoff(set, ticket, w, cx); }))))),
    );
    return out;
  }

  render(cx) {
    const t = theme(), set = this.activeSet(), running = this.root ? this.running() : new Map();
    if (this.findMe() && !this.located) {
      this.located = true;
      cx.spawn(async (cx) => { await this.locate(); this.refresh(cx, true); this.watch(cx); });
    }
    this.place();
    this.follow(running, cx);
    const mode = MODES.find((x) => x.id === this.mode), counter = set ? this.counter(set) : "";
    const body = [];
    // A ticket an agent runs on is claimed, assigned or not.
    for (const [s, list] of set ? this.grouped(set, running) : []) {
      if (!list.length) continue;
      body.push(h_flex().flex_none().pt(8).pb(2).px(4).gap(6).text_size(11).font_semibold().text_color(t[this.groups[s].color]).child(this.groups[s].label).child(div().text_color(t.dim).child(String(list.length))));
      for (const ticket of list) body.push(...this.row(t, set, ticket, s, running));
    }
    const empty = !this.root ? "No folder. Click the folder name to pick a project." : !this.loaded ? this.texts.reading : this.texts.none;

    return v_flex().id(this.mod).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).on_mouse_down("left", () => this.handle.focus())
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(this.title))
        .child(div().id(`${this.mod}-folder`).flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.choose(cx)).child(this.repo || short(this.root) || "pick a folder"))
        .when(Boolean(counter), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(counter)))
        .child(div().id(`${this.mod}-refresh`).flex_none().px(6).py(2).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx, true)).child(this.loading ? "…" : "↻")))
      .child(v_flex().flex_none().px(14).py(8).gap(4).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center().text_size(12)
          .child(div().flex_none().text_color(t.dim).child("Agents open in"))
          .children(MODES.map((x) => div().id(`mode-${x.id}`).px(8).py(2).rounded(5).cursor_pointer().text_color(x.id === this.mode ? t.foreground : t.muted)
            .when(x.id === this.mode, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.mode = x.id; localStorage.setItem("mode", x.id); cx.notify(); }).child(x.label))))
        .child(div().text_size(11).text_color(t.dim).child(mode.about)))
      .when(running.size > 0, (el) => el.child(h_flex().flex_none().px(10).py(6).gap(4).flex_wrap().border_b(1).border_color(t.border)
        .children([...running.values()].map((a) => h_flex().id(`agent-${a.address}`).h(24).px(8).gap(6).items_center().rounded(6).text_size(12).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.show(a, cx))
          .child(this.dot(t, a.status))
          .child(div().max_w(160).truncate().text_color(a.pane ? t.foreground : t.muted).child(this.agentName(a)))))))
      .when(this.sets.length > 1, (el) => el.child(h_flex().flex_none().px(10).pt(8).gap(4).flex_wrap()
        .children(this.sets.map((x) => div().id(`set-${x.key}`).max_w(200).truncate().px(8).py(2).rounded(5).text_size(12).cursor_pointer()
          .text_color(x.key === set.key ? t.foreground : t.muted).when(x.key === set.key, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.active = x.key; localStorage.setItem("active", x.key); this.sel = ""; cx.notify(); }).child(x.title)))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(14).pt(8).text_size(12).text_color(t.blocked).child(`GitHub could not be read: ${this.error}`)))
      .child(v_flex().id(`${this.mod}-list`).flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .when(Boolean(set), (el) => el.children(this.head(t, set, body.length)).children(body))
        .when(!set, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(empty))))
      .child(div().flex_none().px(14).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).truncate().child("↑↓ move · enter start · o open · r refresh"));
  }
}
