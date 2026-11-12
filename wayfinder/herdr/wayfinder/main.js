// The wayfinder maps of a project as a pane of its own: each map's destination and tickets, what is
// ready, who works on what and how that agent is doing, with a click to start a session on a ticket.
// Props: those of board.js.
// The pane itself (where it is, starting and showing agents, handoff notes, drawing) is board.js.

import { div } from "gpui-kit";
import { exec } from "herdr";
import { Board, errorText } from "./board.js";
import { SUB_ISSUES_QUERY, gqlTicket, issuesByNumber, issuesQuery, nextUnblocked, openBlockers, parseLocalTicket, parseMapBody, plainText, statusOf, subIssuesPage, taskListNumbers } from "./tracker.js";
import { handoffFile, handoffPrompt, sessionPrompt, sessionTicket } from "./launch.js";

const GROUPS = ["ready", "claimed", "blocked"];
const GROUP = {
  ready: { label: "Ready", color: "ansi2" },
  claimed: { label: "Claimed", color: "ansi4" },
  blocked: { label: "Blocked", color: "dim" },
};
const TEXTS = {
  start: "start session",
  pick: "Show wayfinder maps",
  reading: "Reading maps…",
  none: "No wayfinder map here. Looked for .scratch/<effort>/map.md and open GitHub issues labelled wayfinder:map. Run /wayfinder to chart one.",
};
// Every .scratch/<effort>/map.md with the .md files of its tickets/ (or issues/) folder.
const LOCAL = 'for d in "$1"/.scratch/*/; do [ -f "${d}map.md" ] || continue; printf "%s\\037" "${d}map.md"; cat "${d}map.md"; printf "\\036"; for s in tickets issues; do [ -d "${d}$s" ] || continue; for f in "${d}$s"/*.md; do [ -f "$f" ] || continue; printf "%s\\037" "$f"; cat "$f"; printf "\\036"; done; break; done; done';
const NONE = new Set();

// The board's sets are the maps: `m` is one of them.
export default class Wayfinder extends Board {
  get mod() { return "wayfinder"; }
  get title() { return "Wayfinder"; }
  get groups() { return GROUP; }
  get texts() { return TEXTS; }

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

  merge(files, github) { return [...files, ...github]; }

  // ---------- tickets and their sessions ----------

  // A ticket's id is unique in its map only. A session started by hand as `claude '/wayfinder <map>
  // <ticket>'` shows up on the board as well.
  refOf(m, t) { return `${m.key}|${t.id}`; }

  sessionRef(prompt) {
    const s = prompt.startsWith("/wayfinder ") ? sessionTicket(prompt.slice(11), this.sets) : undefined;
    return s ? `${s.mapKey}|${s.id}` : undefined;
  }

  sessionPrompt(m, t, handoffPath) { return sessionPrompt(m, t, handoffPath); }
  waits(m, t) { return openBlockers(t, m.tickets); }

  /** An agent's ticket is claimed before the claim reaches the ticket. */
  grouped(m, running) {
    const held = new Set(m.tickets.filter((t) => running.has(this.refOf(m, t))).map((t) => t.id));
    return GROUPS.map((s) => [s, m.tickets.filter((t) => statusOf(t, m.tickets, NONE, held) === s)]);
  }

  handoffFile(tmp, m, t, now) { return handoffFile(tmp, m, [t.id], now); }
  handoffPrompt(m, t, path, skill) { return handoffPrompt(m, [t], path, skill); }

  // ---------- drawing ----------

  counter(m) { return m.tickets.length ? `✓ ${m.tickets.filter((x) => x.closed).length}/${m.tickets.length}` : ""; }
  agentName(a) { return a.ref.slice(a.ref.lastIndexOf("|") + 1); }

  chips(t, ticket, quiet) {
    return [
      ...(ticket.hitl ? [div().flex_none().text_size(10).text_color(t.ansi5).child("HITL")] : []),
      ...(quiet && ticket.type !== "unknown" ? [div().flex_none().text_size(11).text_color(t.dim).child(ticket.type)] : []),
    ];
  }

  details(t, m, ticket, waits) {
    const title = (id) => m.tickets.find((x) => x.id === id)?.title ?? "";
    const { next, alsoWaits, more } = nextUnblocked(ticket, m.tickets);
    const unblocks = !next ? "unblocks nothing"
      : `unblocks ${next.id} ${next.title}${alsoWaits.length ? ` (also waits on ${alsoWaits.join(" ")})` : ""}${more ? ` and ${more} more` : ""}`;
    return [
      div().child(`${ticket.type === "unknown" ? "no type" : ticket.type} · ${ticket.hitl ? "needs you in the loop" : "runs on its own"}${ticket.assignee ? ` · claimed by ${ticket.assignee}` : ""}`),
      ...(ticket.warning ? [div().text_color(t.ansi3).child(ticket.warning)] : []),
      ...waits.map((b) => div().truncate().child(`waits on ${b} ${title(b)}`)),
      div().truncate().child(unblocks),
    ];
  }

  // The map's title opens it; under it its destination, and how much is decided and still open.
  head(t, m, rows) {
    const about = [m.decisions ? `${m.decisions} decided` : "", m.fog.length ? `${m.fog.length} not yet specified` : ""].filter(Boolean).join(" · ");
    return [
      div().id("wayfinder-map").flex_none().px(4).pt(10).font_semibold().cursor_pointer().hover((s) => s.opacity(0.85)).on_click(() => this.open(m.url ?? m.key)).child(m.title),
      ...(m.destination ? [div().flex_none().px(4).pt(2).text_size(12).text_color(t.muted).child(plainText(m.destination))] : []),
      ...(about ? [div().flex_none().px(4).pt(2).text_size(11).text_color(t.dim).child(about)] : []),
      ...(m.error ? [div().flex_none().px(4).pt(4).text_size(12).text_color(t.blocked).child(`This map could not be read: ${m.error}`)] : []),
      ...(!rows && !m.error ? [div().flex_none().px(4).pt(10).text_size(12).text_color(t.dim).child(m.tickets.length ? "Every ticket of this map is closed." : "This map has no tickets yet.")] : []),
    ];
  }
}
