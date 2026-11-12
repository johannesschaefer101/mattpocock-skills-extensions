// The open /to-tickets tickets of a project as a pane of its own: what is ready, who works on
// what and how that agent is doing, with a click to start an agent on a ticket or go to it.
// Props: { folder?, command?, argv? } (the project; the slash command a ticket is started with,
// default "implement"; the agent program it is given to, default ["claude"]).
// Keys bound to tickets.up, tickets.down, tickets.start and tickets.refresh in keys.json act on it too.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, panes, spaces, terminals, agents, props, run, theme, notify, openOverlay, pickFolder, watchFolder, nextCommand, window, home } from "herdr";
import { GROUPS, ISSUES_QUERY, githubSets, localSet, repoOfRemote, statusOf, visibleOrder } from "./tickets.js";

const REFRESH_MS = 300000;
// A refresh the person or a finished agent asks for still waits this long after the last read of GitHub.
const FORCE_GAP_MS = 10000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GROUP = {
  ready: { label: "Ready", color: "ansi2" },
  human: { label: "Needs you", color: "ansi5" },
  claimed: { label: "Claimed", color: "ansi4" },
  blocked: { label: "Blocked", color: "dim" },
  triage: { label: "In triage", color: "ansi3" },
};
// Where a started agent goes. In all three the board stays where it is.
const MODES = [
  { id: "stack", label: "One pane", about: "one pane beside the board; pick the agent it shows here" },
  { id: "split", label: "Split", about: "a pane of its own in this tab" },
  { id: "tab", label: "Tab", about: "a tab of its own in this space" },
];
const WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
// Every .scratch/<feature>/issues/*.md, a folder with a map.md (a wayfinder map) left out.
const LOCAL = 'for d in "$1"/.scratch/*/; do [ -d "${d}issues" ] || continue; [ -f "${d}map.md" ] && continue; for f in "${d}issues"/*.md; do [ -f "$f" ] || continue; printf "%s\\037" "$f"; cat "$f"; printf "\\036"; done; done';

const local = (id) => (id?.includes("/") ? id.split("/").pop() : id);
const short = (path) => (path === home() ? "~" : path?.startsWith(home() + "/") ? "~" + path.slice(home().length) : path ?? "");

export default class Tickets extends View {
  init(_props, cx) {
    this.sets = [];
    this.active = localStorage.getItem("active") ?? "";
    this.sel = "";
    this.mode = MODES.find((m) => m.id === localStorage.getItem("mode"))?.id ?? "stack";
    this.shown = localStorage.getItem("shown");
    this.error = "";
    this.lastGh = 0;
    this.names = new Map();
    this.handle = cx.focus_handle();
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    // "focus" arrives when pane.go moves onto this pane; the rest are keys.json's.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.key({ key: { up: "up", down: "down", start: "enter", refresh: "r" }[c] }, cx);
        cx.notify();
      }
    });
    cx.spawn(async (cx) => { await this.locate(); this.refresh(cx, true); this.watch(cx); });
  }

  // ---------- where this is ----------

  me() {
    const all = panes();
    return all.find((p) => p.pane === props()?.pane) ?? all.find((p) => p.mod && p.mod === props()?.mod) ?? all.find((p) => p.mod === "tickets");
  }

  space() {
    const tab = this.me()?.tab;
    return spaces().find((s) => s.tabs.some((t) => t.id === tab)) ?? spaces().find((s) => s.active);
  }

  command() {
    return String(props()?.command ?? "implement").trim().replace(/^\//, "") || "implement";
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
      const folder = await pickFolder({ prompt: "Show tickets" });
      if (!folder) return;
      localStorage.setItem("folder", folder);
      this.repo = undefined; this.sets = []; this.lastGh = 0; this.error = "";
      await this.locate();
      this.refresh(cx, true);
      this.watch(cx);
    });
  }

  // ---------- loading ----------

  async loadLocal() {
    const r = await exec("sh", ["-c", LOCAL, "tickets", this.root]);
    const byFolder = new Map();
    for (const record of r.stdout.split("\x1e")) {
      const cut = record.indexOf("\x1f");
      if (cut < 0) continue;
      const path = record.slice(0, cut), text = record.slice(cut + 1);
      const m = /^(.*\/\.scratch\/([^/]+))\/issues\/([^/]+)$/.exec(path.replace(/\/+/g, "/"));
      if (!m) continue;
      if (!byFolder.has(m[1])) byFolder.set(m[1], { feature: m[2], files: [] });
      byFolder.get(m[1]).files.push({ name: m[3], text, path: `${m[1]}/issues/${m[3]}`, relPath: `.scratch/${m[2]}/issues/${m[3]}` });
    }
    return [...byFolder].map(([base, f]) => localSet(base, f.feature, f.files.sort((a, b) => a.name.localeCompare(b.name)))).filter((s) => s.tickets.length);
  }

  async findRepo() {
    // The origin remote names the repository without a call to GitHub.
    const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: this.root }).catch(() => null);
    const repo = remote?.code === 0 ? repoOfRemote(remote.stdout) : undefined;
    if (repo) return repo;
    const view = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: this.root }).catch(() => null);
    return view?.code === 0 && view.stdout.trim() ? view.stdout.trim() : null;
  }

  /** One GraphQL request (5 points of the 5,000 an hour), whatever the number of tickets. */
  async loadGithub() {
    const [owner = "", name = ""] = this.repo.split("/");
    const r = await exec("gh", ["api", "graphql", "-f", `query=${ISSUES_QUERY}`, "-f", `o=${owner}`, "-f", `r=${name}`], { cwd: this.root });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "gh api graphql failed");
    return githubSets(this.repo, JSON.parse(r.stdout).data.repository.issues.nodes);
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
          catch (e) { this.error = String(e).slice(0, 200); }
        }
        if (this.root !== root) return;
        this.sets = [...(this.github ?? []), ...files];
        this.loaded = true;
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // ---------- agents ----------

  /** The live terminals started on this project's tickets, here or from the Claude Code sidebar, by ticket ref. */
  running() {
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const withPane = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const prefix = `/${this.command()} `, out = new Map();
    for (const k of terminals()) {
      if (k.state !== "live" || k.address.includes("/")) continue;
      let ref = k.labels?.["ticket-board.root"] === this.root ? k.labels["ticket-board.ticket"] : undefined;
      const prompt = k.argv?.[k.argv.length - 1];
      if (!ref && /(^|\/)claude$/.test(k.argv?.[0] ?? "") && prompt?.startsWith(prefix) && (k.cwd === this.root || k.cwd?.startsWith(this.root + "/"))) ref = prompt.slice(prefix.length);
      if (!ref || out.has(ref)) continue;
      const status = listed.get(k.address) ?? (k.status === "error" ? "blocked" : k.status) ?? null;
      out.set(ref, { address: k.address, ref, status, pane: withPane.get(k.address), stacked: k.labels?.["ticket-board.mode"] === "stack" });
    }
    return out;
  }

  /** The pane "One pane" agents show in: the one of them that has a pane in this tab. */
  host(running) {
    const tab = this.me()?.tab;
    return [...running.values()].find((a) => a.stacked && a.pane?.tab === tab)?.pane;
  }

  start(t, cx) {
    const running = this.running();
    if (statusOf(t, running.has(t.ref)) === "blocked") { notify({ title: `${t.id} still waits on ${t.blockedBy.join(" ")}`, body: "Not started.", level: "warning" }); return; }
    if (running.has(t.ref)) { this.show(running.get(t.ref), cx); return; }
    const space = this.space(), tab = this.me()?.tab, host = this.host(running);
    if (!space || space.machine) { notify({ title: "Tickets start agents on this computer only", level: "error" }); return; }
    const args = ["run", "--bg", "--json", "--no-notify", "--cwd", this.root,
      "--label", `ticket-board.ticket=${t.ref}`, "--label", `ticket-board.root=${this.root}`, "--label", `ticket-board.mode=${this.mode}`];
    // A terminal with herdr's labels gets a pane there. Without them it has none until it is shown: it
    // starts as a sub-agent of the shared pane's own agent, so herdr's agents list has it under that one.
    if (this.mode === "tab" || !tab) args.push("--label", `herdr.space=${local(space.id)}`);
    else if (this.mode === "split" || !host) args.push("--label", `herdr.space=${local(space.id)}`, "--label", `herdr.tab=${local(tab)}`);
    else args.push("--parent", host.terminal, "--outlive-parent");
    args.push("--", ...this.argv(), `/${this.command()} ${t.ref}`);
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
        if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || `hc run: exit ${r.code}`);
        if (this.mode === "tab") this.names.set(address, `${t.id} ${t.title}`.slice(0, 40));
        // Shown once the window knows the terminal: see follow().
        if (this.mode === "stack" && host) this.wanted = address;
      } catch (e) { notify({ title: `Could not start ${t.id}`, body: String(e).slice(0, 200), level: "error" }); }
      cx.notify();
    });
  }

  /** Brings an agent in front: its own pane, or the shared one for an agent without. */
  show(a, cx) {
    const running = this.running(), host = this.host(running);
    if (a.pane) {
      if (host && a.pane.pane === host.pane) { run("terminal.show", { pane: host.pane }); this.remember(a.address); }
      else run("pane.focus", { terminal: a.address });
    } else if (host) { run("terminal.show", { terminal: a.address, pane: host.pane }); this.remember(a.address); }
    else {
      // The pane it shared is gone: it gets one of its own in this tab, and the others share that.
      const space = this.space(), tab = this.me()?.tab;
      if (!space || !tab) return;
      cx.spawn(async () => { await hc(["label", a.address, `herdr.space=${local(space.id)}`, `herdr.tab=${local(tab)}`]).catch(() => null); });
    }
    cx.notify();
  }

  remember(address) {
    this.shown = address;
    localStorage.setItem("shown", address);
  }

  stop(a, t) {
    openOverlay({ mod: "confirm", kind: "dialog", width: 380, height: 170,
      props: { title: `Stop the agent on ${t?.id ?? a.ref}?`, detail: "Its session ends. What it has written stays.", command: { name: "terminal.kill", args: { terminal: a.address } } } });
  }

  open(t) {
    const target = t.url ?? t.path;
    if (target) exec(window()?.platform === "macos" ? "open" : "xdg-open", [target]).catch((e) => notify({ title: `Could not open ${target}`, body: String(e), level: "error" }));
  }

  // What waits for the window to know a new terminal: naming the tab made for a ticket, showing an agent
  // in the shared pane. And a finished agent makes GitHub worth reading again.
  follow(running, cx) {
    for (const [address, name] of this.names) {
      const pane = panes().find((p) => p.terminal === address);
      if (pane) { run("tab.rename", { id: pane.tab, name }); this.names.delete(address); }
      else if (!terminals().some((k) => k.address === address && k.state === "live")) this.names.delete(address);
    }
    const wanted = [...running.values()].find((a) => a.address === this.wanted), host = this.host(running);
    if (wanted && host) { run("terminal.show", { terminal: wanted.address, pane: host.pane }); this.remember(wanted.address); this.wanted = null; }
    const sig = [...running.values()].map((a) => `${a.address}:${a.status === "working"}`).sort().join(",");
    if (this.sig !== undefined && sig !== this.sig) this.refresh(cx, true);
    this.sig = sig;
  }

  // ---------- drawing ----------

  activeSet() {
    return this.sets.find((s) => s.key === this.active) ?? this.sets[0];
  }

  move(by) {
    const set = this.activeSet();
    const order = set ? visibleOrder(set, this.running()) : [];
    if (!order.length) return;
    const i = order.indexOf(this.sel);
    this.sel = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))];
  }

  key(e, cx) {
    const t = this.activeSet()?.tickets.find((x) => x.id === this.sel);
    const k = e.key;
    if (k === "up" || k === "i") this.move(-1);
    else if (k === "down" || k === "k") this.move(1);
    else if (k === "r") this.refresh(cx, true);
    else if (t && (k === "enter" || k === "n")) this.start(t, cx);
    else if (t && k === "o") this.open(t);
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

  row(t, ticket, s, running, set) {
    const selected = this.sel === ticket.id, a = running.get(ticket.ref), color = t[GROUP[s].color];
    const note = a ? "" : s === "claimed" ? ticket.assignee : s === "blocked" ? `waits on ${ticket.blockedBy.join(" ")}` : "";
    const title = (id) => set.tickets.find((x) => x.id === id)?.title ?? "";
    const out = [
      h_flex().id(`row-${ticket.id}`).h(28).flex_none().pr(8).gap(8).items_center().rounded(6).cursor_pointer().when(selected, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.handle.focus(); this.sel = selected ? "" : ticket.id; cx.notify(); })
        .child(div().w(3).h(18).flex_none().rounded(2).bg(color))
        .child(div().flex_none().text_color(t.dim).child(ticket.id))
        .child(div().flex_1().min_w(0).truncate().text_color(s === "blocked" ? t.muted : t.foreground).when(selected, (el) => el.font_semibold()).child(ticket.title))
        .when(Boolean(note), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(note)))
        .when(Boolean(a), (el) => el.child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(WORDS[a.status] ?? "running")).child(this.dot(t, a.status))),
    ];
    if (!selected) return out;
    out.push(
      v_flex().id(`detail-${ticket.id}`).flex_none().pl(19).pr(8).pt(2).pb(10).gap(3).text_size(12).text_color(t.muted)
        .child(div().text_color(t.foreground).child(ticket.title))
        .child(div().child(`${ticket.label || "no triage label"}${ticket.assignee ? ` · claimed by ${ticket.assignee}` : ""}`))
        .children(ticket.blockedBy.map((b) => div().truncate().child(`waits on ${b} ${title(b)}`)))
        .child(div().child(ticket.unblocks.length ? `unblocks ${ticket.unblocks.join(" ")}` : "unblocks nothing"))
        .child(h_flex().pt(4).gap(6).flex_wrap()
          .child(a
            ? this.button(t, `show-${ticket.id}`, "show agent", (cx) => this.show(a, cx), true)
            : this.button(t, `start-${ticket.id}`, "start agent", (cx) => this.start(ticket, cx), s === "ready"))
          .when(Boolean(a), (el) => el.child(this.button(t, `stop-${ticket.id}`, "stop", () => this.stop(a, ticket))))
          .child(this.button(t, `open-${ticket.id}`, "open", () => this.open(ticket)))),
    );
    return out;
  }

  render(cx) {
    const t = theme(), set = this.activeSet(), running = this.root ? this.running() : new Map();
    this.follow(running, cx);
    const host = this.host(running);
    const shown = host ? ([...running.values()].find((a) => a.address === this.shown) ?? [...running.values()].find((a) => a.pane?.pane === host.pane))?.address : null;
    const mode = MODES.find((m) => m.id === this.mode);
    const body = [];
    // A ticket an agent runs on is claimed, assigned or not.
    for (const s of GROUPS) {
      const list = set?.tickets.filter((x) => statusOf(x, running.has(x.ref)) === s) ?? [];
      if (!list.length) continue;
      body.push(h_flex().flex_none().pt(8).pb(2).px(4).gap(6).text_size(11).font_semibold().text_color(t[GROUP[s].color]).child(GROUP[s].label).child(div().text_color(t.dim).child(String(list.length))));
      for (const ticket of list) body.push(...this.row(t, ticket, s, running, set));
    }
    const empty = !this.root ? "No folder. Click the folder name to pick a project."
      : !this.loaded ? "Reading tickets…"
      : "No open tickets here. Looked for open GitHub sub-issues and ready-for-* issues, and for .scratch/<feature>/issues/*.md.";

    return v_flex().id("tickets").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).on_mouse_down("left", () => this.handle.focus())
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Tickets"))
        .child(div().id("tickets-folder").flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.choose(cx)).child(this.repo || short(this.root) || "pick a folder"))
        .when(Boolean(set?.total), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(`✓ ${set.done}/${set.total}`)))
        .child(div().id("tickets-refresh").flex_none().px(6).py(2).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx, true)).child(this.loading ? "…" : "↻")))
      .child(v_flex().flex_none().px(14).py(8).gap(4).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center().text_size(12)
          .child(div().flex_none().text_color(t.dim).child("Agents open in"))
          .children(MODES.map((m) => div().id(`mode-${m.id}`).px(8).py(2).rounded(5).cursor_pointer().text_color(m.id === this.mode ? t.foreground : t.muted)
            .when(m.id === this.mode, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.mode = m.id; localStorage.setItem("mode", m.id); cx.notify(); }).child(m.label))))
        .child(div().text_size(11).text_color(t.dim).child(mode.about)))
      .when(running.size > 0, (el) => el.child(h_flex().flex_none().px(10).py(6).gap(4).flex_wrap().border_b(1).border_color(t.border)
        .children([...running.values()].map((a) => {
          const ticket = this.sets.flatMap((s) => s.tickets).find((x) => x.ref === a.ref);
          return h_flex().id(`agent-${a.address}`).h(24).px(8).gap(6).items_center().rounded(6).text_size(12).cursor_pointer()
            .when(a.address === shown, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.show(a, cx))
            .child(this.dot(t, a.status))
            .child(div().max_w(160).truncate().text_color(a.pane || a.address === shown ? t.foreground : t.muted).child(ticket?.id ?? a.ref));
        }))))
      .when(this.sets.length > 1, (el) => el.child(h_flex().flex_none().px(10).pt(8).gap(4).flex_wrap()
        .children(this.sets.map((x) => div().id(`set-${x.key}`).max_w(200).truncate().px(8).py(2).rounded(5).text_size(12).cursor_pointer()
          .text_color(x.key === set.key ? t.foreground : t.muted).when(x.key === set.key, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.active = x.key; localStorage.setItem("active", x.key); this.sel = ""; cx.notify(); }).child(x.title)))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(14).pt(8).text_size(12).text_color(t.blocked).child(`GitHub could not be read: ${this.error}`)))
      .child(v_flex().id("tickets-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .when(Boolean(set), (el) => el.child(div().flex_none().px(4).pt(10).font_semibold().child(set.title)).children(body))
        .when(!set, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(empty))))
      .child(div().flex_none().px(14).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).truncate().child("↑↓ move · enter start · o open · r refresh"));
  }
}
