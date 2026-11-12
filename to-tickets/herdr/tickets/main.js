// The open /to-tickets tickets of a project as a pane of its own: what is ready, who works on
// what and how that agent is doing, with a click to start an agent on a ticket or go to it.
// Props: those of board.js, and command (the slash command a ticket is started with, default "implement").
// The pane itself (where it is, starting and showing agents, drawing) is board.js.

import { div } from "gpui-kit";
import { exec, props } from "herdr";
import { Board } from "./board.js";
import { GROUPS, ISSUES_QUERY, githubSets, localSet, repoOfRemote, sessionPrompt, sessionRef, statusOf } from "./tickets.js";

const GROUP = {
  ready: { label: "Ready", color: "ansi2" },
  human: { label: "Needs you", color: "ansi5" },
  claimed: { label: "Claimed", color: "ansi4" },
  blocked: { label: "Blocked", color: "dim" },
  triage: { label: "In triage", color: "ansi3" },
};
const TEXTS = {
  start: "start agent",
  pick: "Show tickets",
  reading: "Reading tickets…",
  none: "No open tickets here. Looked for open GitHub sub-issues and ready-for-* issues, and for .scratch/<feature>/issues/*.md.",
};
// Every .scratch/<feature>/issues/*.md, a folder with a map.md (a wayfinder map) left out.
const LOCAL = 'for d in "$1"/.scratch/*/; do [ -d "${d}issues" ] || continue; [ -f "${d}map.md" ] && continue; for f in "${d}issues"/*.md; do [ -f "$f" ] || continue; printf "%s\\037" "$f"; cat "$f"; printf "\\036"; done; done';

export default class Tickets extends Board {
  get mod() { return "tickets"; }
  get title() { return "Tickets"; }
  get label() { return "ticket-board"; }
  get groups() { return GROUP; }
  get texts() { return TEXTS; }
  // A ticket holds what its session needs, so none starts with a handoff note.
  get handoffs() { return false; }

  command() {
    return String(props()?.command ?? "implement").trim().replace(/^\//, "") || "implement";
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

  // ---------- tickets and their sessions ----------

  // A ticket's ref names it in the whole project: "#64", or the path of its file. A session started
  // from the Claude Code sidebar's "new pane" has the same prompt, so it shows up on the board as well.
  refOf(_set, t) { return t.ref; }
  sessionRef(prompt) { return sessionRef(this.command(), prompt); }
  sessionPrompt(_set, t) { return sessionPrompt(this.command(), t.ref); }
  waits(_set, t) { return statusOf(t) === "blocked" ? t.blockedBy : []; }
  grouped(set, running) { return GROUPS.map((s) => [s, set.tickets.filter((t) => statusOf(t, running.has(t.ref)) === s)]); }

  // ---------- drawing ----------

  counter(set) { return set.total ? `✓ ${set.done}/${set.total}` : ""; }
  agentName(a) { return this.sets.flatMap((s) => s.tickets).find((x) => x.ref === a.ref)?.id ?? a.ref; }

  details(_t, set, ticket) {
    const title = (id) => set.tickets.find((x) => x.id === id)?.title ?? "";
    return [
      div().child(`${ticket.label || "no triage label"}${ticket.assignee ? ` · claimed by ${ticket.assignee}` : ""}`),
      ...ticket.blockedBy.map((b) => div().truncate().child(`waits on ${b} ${title(b)}`)),
      div().child(ticket.unblocks.length ? `unblocks ${ticket.unblocks.join(" ")}` : "unblocks nothing"),
    ];
  }
}
