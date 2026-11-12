// The wayfinder maps of a project as a pane of its own: each map's destination and tickets, what is
// ready, who works on what and how that agent is doing, with a click to start a session on a ticket.
// Props: { folder?, argv?, side? } (the project; the agent program a ticket is given to, default
// ["claude"]; "left" to sit left of the pane it was split from).
// A session can start with a handoff note: an agent already at work in the project is asked to write
// one for the ticket, and the session starts when the note is saved.
// Keys bound to wayfinder.up, wayfinder.down, wayfinder.start and wayfinder.refresh in keys.json act on it too.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, panes, spaces, terminals, agents, props, run, theme, notify, openOverlay, pickFolder, watchFolder, nextCommand, window, home, focused } from "herdr";
import { SUB_ISSUES_QUERY, gqlTicket, issuesByNumber, issuesQuery, nextUnblocked, openBlockers, parseLocalTicket, parseMapBody, plainText, statusOf, subIssuesPage, taskListNumbers } from "./tracker.js";
import { handoffFile, handoffPrompt, sessionPrompt, sessionTicket } from "./launch.js";

const REFRESH_MS = 300000;
// A refresh the person or a finished agent asks for still waits this long after the last read of GitHub.
const FORCE_GAP_MS = 10000;
// How often a handoff note being written is looked for.
const HANDOFF_MS = 2000;
// How long a terminal just started may be missing from the window's list before it counts as gone.
const NEW_MS = 10000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GROUPS = ["ready", "claimed", "blocked"];
const GROUP = {
  ready: { label: "Ready", color: "ansi2" },
  claimed: { label: "Claimed", color: "ansi4" },
  blocked: { label: "Blocked", color: "dim" },
};
// Where a started agent goes. In both the board stays where it is.
const MODES = [
  { id: "split", label: "Split", about: "a pane of its own in this tab" },
  { id: "tab", label: "Tab", about: "a tab of its own in this space" },
];
const WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
// Every .scratch/<effort>/map.md with the .md files of its tickets/ (or issues/) folder.
const LOCAL = 'for d in "$1"/.scratch/*/; do [ -f "${d}map.md" ] || continue; printf "%s\\037" "${d}map.md"; cat "${d}map.md"; printf "\\036"; for s in tickets issues; do [ -d "${d}$s" ] || continue; for f in "${d}$s"/*.md; do [ -f "$f" ] || continue; printf "%s\\037" "$f"; cat "$f"; printf "\\036"; done; break; done; done';
const NONE = new Set();

const local = (id) => (id?.includes("/") ? id.split("/").pop() : id);
const short = (path) => (path === home() ? "~" : path?.startsWith(home() + "/") ? "~" + path.slice(home().length) : path ?? "");
const errorText = (e) => (e instanceof Error ? e.message : String(e)).replace(/^gh:\s*/, "").slice(0, 200);
/** A ticket across maps: what an agent's label holds. */
const refOf = (m, t) => `${m.key}|${t.id}`;

export default class Wayfinder extends View {
  init(_props, cx) {
    this.maps = [];
    this.active = localStorage.getItem("active") ?? "";
    this.sel = "";
    this.mode = MODES.find((m) => m.id === localStorage.getItem("mode"))?.id ?? "split";
    this.error = "";
    this.lastGh = 0;
    this.names = new Map();
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
    const tab = focused()?.tab, here = panes().filter((p) => p.mod === (props()?.mod ?? "wayfinder") && p.tab === tab);
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
    const me = this.pane ?? panes().find((p) => p.focused && p.mod === (props()?.mod ?? "wayfinder"))?.pane;
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
      const folder = await pickFolder({ prompt: "Show wayfinder maps" });
      if (!folder) return;
      localStorage.setItem("folder", folder);
      this.repo = undefined; this.maps = []; this.github = undefined; this.lastGh = 0; this.error = "";
      await this.locate();
      this.refresh(cx, true);
      this.watch(cx);
    });
  }

  // ---------- loading ----------

  async loadLocal() {
    const r = await exec("sh", ["-c", LOCAL, "wayfinder", this.root]);
    const byFolder = new Map();
    for (const record of r.stdout.split("\x1e")) {
      const cut = record.indexOf("\x1f");
      if (cut < 0) continue;
      const path = record.slice(0, cut).replace(/\/+/g, "/"), text = record.slice(cut + 1);
      const m = /^(.*\/\.scratch\/([^/]+))\/(?:map\.md|(?:tickets|issues)\/([^/]+))$/.exec(path);
      if (!m) continue;
      if (!byFolder.has(m[1])) byFolder.set(m[1], { name: m[2], map: "", files: [] });
      if (m[3]) byFolder.get(m[1]).files.push({ name: m[3], text, path });
      else byFolder.get(m[1]).map = text;
    }
    return [...byFolder].map(([base, f]) => ({
      key: `${base}/map.md`, tracker: "local", relPath: `.scratch/${f.name}/map.md`, ...parseMapBody(f.map, f.name),
      tickets: f.files.sort((a, b) => a.name.localeCompare(b.name)).map((x) => parseLocalTicket(x.name, x.text, x.path)),
    }));
  }

  async findRepo() {
    const view = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: this.root }).catch(() => null);
    return view?.code === 0 && view.stdout.trim() ? view.stdout.trim() : null;
  }

  /** One GraphQL request. `partial` accepts an answer that came with errors, such as a number that names no issue. */
  async ghQuery(query, vars = {}, partial = false) {
    const [owner = "", name = ""] = this.repo.split("/");
    const args = ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
    const r = await exec("gh", args, { cwd: this.root });
    let data;
    try { data = JSON.parse(r.stdout).data; } catch { /* no answer */ }
    if (data == null || (r.code !== 0 && !partial)) throw new Error(r.stderr.trim() || "gh api graphql failed");
    return data;
  }

  /** A map's tickets: its sub-issues, else the task list in its body. */
  async loadChildren(number, body) {
    let children = [], failed;
    try {
      let after;
      for (let page = 0; page < 10; page++) {
        const r = subIssuesPage(await this.ghQuery(SUB_ISSUES_QUERY, after ? { number, after } : { number }));
        children.push(...r.issues);
        if (!(after = r.next)) break;
      }
    } catch (e) { children = []; failed = e; }
    if (children.length) return children;
    const listed = taskListNumbers(body);
    if (!listed.length) { if (failed) throw failed; return []; }
    // A GitHub that could not answer for sub-issues is not asked for native blockers either.
    return issuesByNumber(await this.ghQuery(issuesQuery(listed, !failed), {}, true), listed);
  }

  /** The repository's open maps: one request for the list and one per map. A map that could not be read keeps the tickets it had. */
  async loadGithub() {
    const r = await exec("gh", ["issue", "list", "--repo", this.repo, "--label", "wayfinder:map", "--state", "open", "--json", "number,title,url,body", "--limit", "20"], { cwd: this.root });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "gh issue list failed");
    const out = [];
    for (const mi of JSON.parse(r.stdout)) {
      const key = `github:${this.repo}#${mi.number}`;
      const map = { key, tracker: "github", url: mi.url, repo: this.repo, number: mi.number, ...parseMapBody(`# ${mi.title}\n${mi.body ?? ""}`, mi.title) };
      try { out.push({ ...map, tickets: (await this.loadChildren(mi.number, mi.body ?? "")).map(gqlTicket) }); }
      catch (e) { out.push({ ...map, tickets: this.github?.find((m) => m.key === key)?.tickets ?? [], error: errorText(e) }); }
    }
    return out;
  }

  // Local files are read every time; GitHub once per REFRESH_MS, or after FORCE_GAP_MS when asked for.
  refresh(cx, force = false) {
    if (this.loading || !this.root) return;
    this.loading = true;
    const root = this.root;
    cx.spawn(async (cx) => {
      try {
        const files = await this.loadLocal().catch(() => []);
        if (this.repo === undefined) this.repo = await this.findRepo();
        const age = Date.now() - this.lastGh;
        if (this.repo && age >= (force ? FORCE_GAP_MS : REFRESH_MS - 1000)) {
          this.lastGh = Date.now(); // a failed read waits out the interval too
          try { this.github = await this.loadGithub(); this.error = ""; }
          catch (e) { this.error = errorText(e); }
        }
        if (this.root !== root) return;
        this.maps = [...files, ...(this.github ?? [])];
        this.loaded = true;
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // ---------- agents ----------

  /** The live terminals working on this project's map tickets, started here or as `claude '/wayfinder <map> <ticket>'`, by refOf. */
  running() {
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const withPane = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const out = new Map();
    for (const k of terminals()) {
      if (k.state !== "live" || k.address.includes("/")) continue;
      let ref = k.labels?.["wayfinder.root"] === this.root ? k.labels["wayfinder.ticket"] : undefined;
      const prompt = k.argv?.[k.argv.length - 1];
      if (!ref && /(^|\/)claude$/.test(k.argv?.[0] ?? "") && prompt?.startsWith("/wayfinder ") && (k.cwd === this.root || k.cwd?.startsWith(this.root + "/"))) {
        const s = sessionTicket(prompt.slice(11), this.maps);
        if (s) ref = `${s.mapKey}|${s.id}`;
      }
      if (!ref || out.has(ref)) continue;
      const status = listed.get(k.address) ?? (k.status === "error" ? "blocked" : k.status) ?? null;
      out.set(ref, { address: k.address, ref, status, pane: withPane.get(k.address) });
    }
    return out;
  }

  /** The ids of a map's tickets an agent runs on: claimed before the claim reaches the ticket. */
  held(m, running) {
    return new Set(m.tickets.filter((t) => running.has(refOf(m, t))).map((t) => t.id));
  }

  start(m, t, cx, handoffPath) {
    const running = this.running(), ref = refOf(m, t);
    if (running.has(ref)) { this.show(running.get(ref), cx); return; }
    const waits = openBlockers(t, m.tickets);
    if (waits.length) { notify({ title: `${t.id} still waits on ${waits.join(" ")}`, body: "Not started.", level: "warning" }); return; }
    const space = this.space(), tab = this.me()?.tab;
    if (!space || space.machine) { notify({ title: "Wayfinder starts agents on this computer only", level: "error" }); return; }
    const args = ["run", "--bg", "--json", "--no-notify", "--cwd", this.root,
      "--label", `wayfinder.ticket=${ref}`, "--label", `wayfinder.root=${this.root}`];
    // A terminal with herdr's labels gets a pane there: in the board's tab, or in a tab of its own.
    if (this.mode === "tab" || !tab) args.push("--label", `herdr.space=${local(space.id)}`);
    else args.push("--label", `herdr.space=${local(space.id)}`, "--label", `herdr.tab=${local(tab)}`);
    args.push("--", ...this.argv(), sessionPrompt(m, t, handoffPath));
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
        if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || `hc run: exit ${r.code}`);
        // Named once the window knows the terminal: see follow().
        if (this.mode === "tab") this.names.set(address, { name: `${t.id} ${t.title}`.slice(0, 40), at: Date.now() });
      } catch (e) { notify({ title: `Could not start ${t.id}`, body: String(e).slice(0, 200), level: "error" }); }
      cx.notify();
    });
  }

  // ---------- handoffs ----------

  /** The agents at work in this project that can be asked for a handoff note, by address. */
  writers(running) {
    // agents() has the agents with a pane; one without reports its status on the terminal.
    const listed = new Set(agents().map((a) => a.address));
    const onTicket = new Map([...running.values()].map((a) => [a.address, a.ref.slice(a.ref.lastIndexOf("|") + 1)]));
    return terminals()
      .filter((k) => k.state === "live" && !k.address.includes("/") && (listed.has(k.address) || k.status) && (k.cwd === this.root || k.cwd?.startsWith(this.root + "/")))
      .map((k) => ({ address: k.address, name: onTicket.get(k.address) ?? `${String(k.title ?? "").trim()} ${k.address}`.trim() }));
  }

  /** Asks an agent for a handoff note on a ticket; checkHandoff() starts the session once the note is there. */
  beginHandoff(m, t, w, cx) {
    if (this.flow) { notify({ title: "A handoff is being written", body: "Start without it or cancel it first.", level: "warning" }); return; }
    const waits = openBlockers(t, m.tickets);
    if (waits.length) { notify({ title: `${t.id} still waits on ${waits.join(" ")}`, body: "Not started.", level: "warning" }); return; }
    const flow = this.flow = { mapKey: m.key, id: t.id, from: w.address, name: w.name, path: "", seen: 0 };
    cx.spawn(async (cx) => {
      try {
        const tmp = (await exec("sh", ["-c", 'printf %s "${TMPDIR:-/tmp}"'])).stdout.trim() || "/tmp";
        // The handoff skill's own rules, when it is installed.
        const skill = await exec("sh", ["-c", 'cat "$1/.claude/skills/handoff/SKILL.md" 2>/dev/null || cat "$1/.agents/skills/handoff/SKILL.md" 2>/dev/null', "wayfinder", home()]).catch(() => null);
        const path = handoffFile(tmp, m, [t.id], Date.now());
        const r = await hc(["send", w.address, handoffPrompt(m, [t], path, skill?.stdout.trim() || undefined)]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `hc send: exit ${r.code}`);
        flow.path = path;
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
        const m = this.maps.find((x) => x.key === flow.mapKey), t = m?.tickets.find((x) => x.id === flow.id);
        if (flow.seen >= 2 && m && t) { this.flow = null; this.start(m, t, cx, flow.path); }
        else if (!there && !terminals().some((k) => k.address === flow.from && k.state === "live")) {
          this.flow = null;
          notify({ title: `${flow.name} ended before the handoff for ${flow.id} was written`, body: "Not started.", level: "warning" });
        }
      } finally { flow.busy = false; cx.notify(); }
    });
  }

  /** Ends the wait for a note. With `start`, the session starts without one; else the note is removed. */
  endHandoff(m, t, start, cx) {
    const flow = this.flow;
    this.flow = null;
    if (start) this.start(m, t, cx);
    else if (flow?.path) exec("rm", ["-f", flow.path]).catch(() => null);
    cx.notify();
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

  // ---------- drawing ----------

  activeMap() {
    return this.maps.find((m) => m.key === this.active) ?? this.maps[0];
  }

  /** The open tickets of a map by group, in the order they are drawn. */
  grouped(m, running) {
    const held = this.held(m, running);
    return GROUPS.map((s) => [s, m.tickets.filter((t) => statusOf(t, m.tickets, NONE, held) === s)]);
  }

  move(by) {
    const m = this.activeMap();
    const order = m ? this.grouped(m, this.running()).flatMap(([, list]) => list.map((t) => t.id)) : [];
    if (!order.length) return;
    const i = order.indexOf(this.sel);
    this.sel = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))];
  }

  key(e, cx) {
    const m = this.activeMap(), t = m?.tickets.find((x) => x.id === this.sel && !x.closed);
    const k = e.key;
    if (k === "up" || k === "i") this.move(-1);
    else if (k === "down" || k === "k") this.move(1);
    else if (k === "r") this.refresh(cx, true);
    else if (t && (k === "enter" || k === "n")) this.start(m, t, cx);
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

  row(t, m, ticket, s, running) {
    const selected = this.sel === ticket.id, a = running.get(refOf(m, ticket)), color = t[GROUP[s].color];
    const waits = openBlockers(ticket, m.tickets);
    const note = a ? "" : s === "claimed" ? ticket.assignee : s === "blocked" ? `waits on ${waits.join(" ")}` : "";
    const title = (id) => m.tickets.find((x) => x.id === id)?.title ?? "";
    const out = [
      h_flex().id(`row-${ticket.id}`).h(28).flex_none().pr(8).gap(8).items_center().rounded(6).cursor_pointer().when(selected, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.handle.focus(); this.sel = selected ? "" : ticket.id; cx.notify(); })
        .child(div().w(3).h(18).flex_none().rounded(2).bg(color))
        .child(div().flex_none().text_color(t.dim).child(ticket.id))
        .child(div().flex_1().min_w(0).truncate().text_color(s === "blocked" ? t.muted : t.foreground).when(selected, (el) => el.font_semibold()).child(ticket.title))
        .when(ticket.hitl, (el) => el.child(div().flex_none().text_size(10).text_color(t.ansi5).child("HITL")))
        .when(!a && !note && ticket.type !== "unknown", (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ticket.type)))
        .when(Boolean(note), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(note)))
        .when(Boolean(a), (el) => el.child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(WORDS[a.status] ?? "running")).child(this.dot(t, a.status))),
    ];
    if (!selected) return out;
    const { next, alsoWaits, more } = nextUnblocked(ticket, m.tickets);
    const writing = this.flow?.mapKey === m.key && this.flow.id === ticket.id, writers = this.writers(running);
    const canHandoff = !a && !writing && s === "ready" && writers.length > 0;
    const unblocks = !next ? "unblocks nothing"
      : `unblocks ${next.id} ${next.title}${alsoWaits.length ? ` (also waits on ${alsoWaits.join(" ")})` : ""}${more ? ` and ${more} more` : ""}`;
    out.push(
      v_flex().id(`detail-${ticket.id}`).flex_none().pl(19).pr(8).pt(2).pb(10).gap(3).text_size(12).text_color(t.muted)
        .child(div().text_color(t.foreground).child(ticket.title))
        .child(div().child(`${ticket.type === "unknown" ? "no type" : ticket.type} · ${ticket.hitl ? "needs you in the loop" : "runs on its own"}${ticket.assignee ? ` · claimed by ${ticket.assignee}` : ""}`))
        .when(Boolean(ticket.warning), (el) => el.child(div().text_color(t.ansi3).child(ticket.warning)))
        .children(waits.map((b) => div().truncate().child(`waits on ${b} ${title(b)}`)))
        .child(div().truncate().child(unblocks))
        .child(h_flex().pt(4).gap(6).flex_wrap()
          .child(a
            ? this.button(t, `show-${ticket.id}`, "show agent", (cx) => this.show(a, cx), true)
            : this.button(t, `start-${ticket.id}`, "start session", (cx) => this.start(m, ticket, cx), s === "ready"))
          .when(Boolean(a), (el) => el.child(this.button(t, `stop-${ticket.id}`, "stop", () => this.stop(a, ticket))))
          .when(canHandoff, (el) => el.child(this.button(t, `handoff-${ticket.id}`, "handoff + start session", (cx) => {
            if (writers.length === 1) this.beginHandoff(m, ticket, writers[0], cx);
            else this.asking = this.asking === ticket.id ? "" : ticket.id;
            cx.notify();
          })))
          .child(this.button(t, `open-${ticket.id}`, "open", () => this.open(ticket.url ?? ticket.path))))
        .when(writing, (el) => el
          .child(div().pt(4).text_color(t.foreground).child(`${this.flow.name} writes a handoff; the session starts when it is saved`))
          .child(h_flex().pt(2).gap(6).flex_wrap()
            .child(this.button(t, `nohandoff-${ticket.id}`, "start without", (cx) => this.endHandoff(m, ticket, true, cx)))
            .child(this.button(t, `cancel-${ticket.id}`, "cancel", (cx) => this.endHandoff(m, ticket, false, cx)))))
        // With several agents at work, the button asks which of them writes the note.
        .when(canHandoff && this.asking === ticket.id && writers.length > 1, (el) => el
          .child(h_flex().pt(4).gap(6).items_center().flex_wrap()
            .child(div().flex_none().child("handoff from"))
            .children(writers.slice(0, 6).map((w) => this.button(t, `handoff-${ticket.id}-${w.address}`, w.name.slice(0, 24), (cx) => { this.asking = ""; this.beginHandoff(m, ticket, w, cx); }))))),
    );
    return out;
  }

  render(cx) {
    const t = theme(), m = this.activeMap(), running = this.root ? this.running() : new Map();
    if (this.findMe() && !this.located) {
      this.located = true;
      cx.spawn(async (cx) => { await this.locate(); this.refresh(cx, true); this.watch(cx); });
    }
    this.place();
    this.follow(running, cx);
    const mode = MODES.find((x) => x.id === this.mode);
    const body = [];
    // A ticket an agent runs on is claimed, assigned or not.
    for (const [s, list] of m ? this.grouped(m, running) : []) {
      if (!list.length) continue;
      body.push(h_flex().flex_none().pt(8).pb(2).px(4).gap(6).text_size(11).font_semibold().text_color(t[GROUP[s].color]).child(GROUP[s].label).child(div().text_color(t.dim).child(String(list.length))));
      for (const ticket of list) body.push(...this.row(t, m, ticket, s, running));
    }
    const done = m?.tickets.filter((x) => x.closed).length ?? 0;
    const about = m ? [m.decisions ? `${m.decisions} decided` : "", m.fog.length ? `${m.fog.length} not yet specified` : ""].filter(Boolean).join(" · ") : "";
    const empty = !this.root ? "No folder. Click the folder name to pick a project."
      : !this.loaded ? "Reading maps…"
      : "No wayfinder map here. Looked for .scratch/<effort>/map.md and open GitHub issues labelled wayfinder:map. Run /wayfinder to chart one.";

    return v_flex().id("wayfinder").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).on_mouse_down("left", () => this.handle.focus())
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Wayfinder"))
        .child(div().id("wayfinder-folder").flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.choose(cx)).child(this.repo || short(this.root) || "pick a folder"))
        .when(Boolean(m?.tickets.length), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(`✓ ${done}/${m.tickets.length}`)))
        .child(div().id("wayfinder-refresh").flex_none().px(6).py(2).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
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
          .child(div().max_w(160).truncate().text_color(a.pane ? t.foreground : t.muted).child(a.ref.slice(a.ref.lastIndexOf("|") + 1)))))))
      .when(this.maps.length > 1, (el) => el.child(h_flex().flex_none().px(10).pt(8).gap(4).flex_wrap()
        .children(this.maps.map((x) => div().id(`map-${x.key}`).max_w(200).truncate().px(8).py(2).rounded(5).text_size(12).cursor_pointer()
          .text_color(x.key === m.key ? t.foreground : t.muted).when(x.key === m.key, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.active = x.key; localStorage.setItem("active", x.key); this.sel = ""; cx.notify(); }).child(x.title)))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(14).pt(8).text_size(12).text_color(t.blocked).child(`GitHub could not be read: ${this.error}`)))
      .child(v_flex().id("wayfinder-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .when(Boolean(m), (el) => el
          .child(div().id("wayfinder-map").flex_none().px(4).pt(10).font_semibold().cursor_pointer().hover((s) => s.opacity(0.85)).on_click(() => this.open(m.url ?? m.key)).child(m.title))
          .when(Boolean(m.destination), (x) => x.child(div().flex_none().px(4).pt(2).text_size(12).text_color(t.muted).child(plainText(m.destination))))
          .when(Boolean(about), (x) => x.child(div().flex_none().px(4).pt(2).text_size(11).text_color(t.dim).child(about)))
          .when(Boolean(m.error), (x) => x.child(div().flex_none().px(4).pt(4).text_size(12).text_color(t.blocked).child(`This map could not be read: ${m.error}`)))
          .when(!body.length && !m.error, (x) => x.child(div().flex_none().px(4).pt(10).text_size(12).text_color(t.dim).child(m.tickets.length ? "Every ticket of this map is closed." : "This map has no tickets yet.")))
          .children(body))
        .when(!m, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(empty))))
      .child(div().flex_none().px(14).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).truncate().child("↑↓ move · enter start · o open · r refresh"));
  }
}
