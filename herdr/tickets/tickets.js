// Generated from hooks/tickets.ts by scripts/build-herdr.sh. Do not edit.
export const ISSUES_QUERY = `query($o:String!,$r:String!){repository(owner:$o,name:$r){issues(first:100,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){nodes{
number title url labels(first:20){nodes{name}} assignees(first:3){nodes{login}}
parent{number title url labels(first:20){nodes{name}} subIssuesSummary{total completed}}
subIssuesSummary{total} blockedBy(first:30){nodes{number state}} blocking(first:30){nodes{number state}}}}}}`;
const names = (l) => l.nodes.map(n => n.name);
const isWayfinder = (l) => names(l).some(n => n.startsWith('wayfinder:'));
const openIds = (edges) => edges.filter(e => e.state.toUpperCase() === 'OPEN').map(e => `#${e.number}`);
export function kindOf(text) {
    if (text.includes('ready-for-human'))
        return 'human';
    return text.includes('ready-for-agent') ? 'agent' : 'triage';
}
const TRIAGE = ['ready-for-agent', 'ready-for-human', 'needs-triage', 'needs-info'];
/**
 * Groups a repo's open issues into ticket sets. A ticket is a sub-issue of a parent (the spec or
 * plan /to-tickets broke down), or a parentless issue carrying a ready-for-* label. Wayfinder
 * maps and their tickets are left to the wayfinder sidebar, and a parent is a set, not a ticket.
 */
export function githubSets(repo, issues) {
    const sets = new Map();
    for (const i of issues) {
        if (isWayfinder(i.labels) || (i.parent && isWayfinder(i.parent.labels)))
            continue;
        if (!i.parent && i.subIssuesSummary.total > 0)
            continue;
        const label = names(i.labels).find(n => TRIAGE.includes(n)) ?? '';
        if (!i.parent && kindOf(label) === 'triage')
            continue;
        const key = i.parent ? `github:${repo}#${i.parent.number}` : `github:${repo}`;
        let set = sets.get(key);
        if (!set) {
            set = i.parent
                ? { key, tracker: 'github', title: i.parent.title, url: i.parent.url, total: i.parent.subIssuesSummary.total, done: i.parent.subIssuesSummary.completed, tickets: [], order: i.parent.number }
                : { key, tracker: 'github', title: 'Tickets without a parent', total: 0, done: 0, tickets: [], order: Infinity };
            sets.set(key, set);
        }
        set.tickets.push({
            id: `#${i.number}`,
            title: i.title,
            kind: kindOf(label),
            label,
            assignee: i.assignees.nodes[0]?.login ?? '',
            blockedBy: openIds(i.blockedBy.nodes),
            unblocks: openIds(i.blocking.nodes),
            url: i.url,
            ref: `#${i.number}`,
        });
    }
    return [...sets.values()]
        .sort((a, b) => a.order - b.order)
        .map(({ order: _order, ...set }) => ({ ...set, tickets: set.tickets.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) }));
}
/** "git@github.com:o/r.git" or "https://github.com/o/r" → "o/r"; undefined for any other host. */
export const repoOfRemote = (url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(url.trim())?.[1];
// ---------- local files ----------
/** "02-extra-properties.md" → "02", "2" → "02". */
export const localId = (ref) => /^(\d+)/.exec(ref.trim())?.[1]?.padStart(2, '0') ?? ref.trim();
/** One `.scratch/<feature>/issues` folder, its files in the /to-tickets template: "# 01: Title", "**Blocked by:** 01, 02", "**Status:** ready-for-agent". */
export function localSet(key, feature, files) {
    const line = (text, name) => new RegExp(`^\\s*(?:\\*\\*)?${name}:?(?:\\*\\*)?\\s*:?\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? '';
    const parsed = files.map(f => {
        const status = line(f.text, 'Status').toLowerCase();
        const heading = /^#\s+(.+)$/m.exec(f.text)?.[1]?.trim();
        return {
            id: localId(f.name),
            title: (heading ?? f.name.replace(/\.md$/, '').replace(/-/g, ' ')).replace(/^\d+\s*[:.-]?\s*/, ''),
            status,
            closed: /closed|resolved|done|complete|wontfix/.test(status),
            blockers: (line(f.text, 'Blocked by').match(/\b\d{1,3}\b/g) ?? []).map(localId),
            file: f,
        };
    });
    const open = parsed.filter(p => !p.closed);
    const isOpen = new Set(open.map(p => p.id));
    const tickets = open.map(p => ({
        id: p.id,
        title: p.title,
        kind: kindOf(p.status),
        label: p.status,
        assignee: /claimed|in.progress/.test(p.status) ? 'claimed' : '',
        // A blocker number that names no open ticket does not block.
        blockedBy: p.blockers.filter(b => isOpen.has(b) && b !== p.id),
        unblocks: open.filter(o => o.id !== p.id && o.blockers.includes(p.id)).map(o => o.id),
        path: p.file.path,
        ref: p.file.relPath,
    }));
    return { key, tracker: 'local', title: feature.replace(/-/g, ' '), total: parsed.length, done: parsed.length - open.length, tickets };
}
export function statusOf(t) {
    if (t.assignee)
        return 'claimed';
    if (t.blockedBy.length)
        return 'blocked';
    return t.kind === 'agent' ? 'ready' : t.kind;
}
export const GROUPS = ['ready', 'human', 'claimed', 'blocked', 'triage'];
/** Ticket ids in the order the pane lists them. */
export const visibleOrder = (set) => GROUPS.flatMap(s => set.tickets.filter(t => statusOf(t) === s).map(t => t.id));
// ---------- text helpers ----------
export const fit = (s, n) => n <= 0 ? '' : s.length <= n ? s.padEnd(n) : s.slice(0, Math.max(0, n - 1)) + '…';
// ---------- starting a session in a new tab ----------
export const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
export const appleQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** The line the new tab runs: Claude Code started in `dir` on the implement command for the ticket. */
export const shellCommand = (dir, prompt) => `cd ${shellQuote(dir)} && claude ${shellQuote(prompt)}`;
/**
 * herdr runs wherever its window does, and a session inside one of its panes (`inHerdr`) takes it
 * in place of the default, iterm. iTerm and Terminal.app exist only on macOS (`uname -s` says
 * Darwin); elsewhere the command is copied.
 */
export const effectiveLauncher = (launcher, platform, inHerdr = false) => {
    if (launcher === 'herdr' || (launcher === 'iterm' && inHerdr))
        return 'herdr';
    return launcher === 'copy' || platform === 'Darwin' ? launcher : 'copy';
};
/**
 * argv that starts Claude Code in `dir` on `prompt`. herdr splits the focused pane and takes the
 * folder and the program as they are, no shell between. The others are osascript for a new tab:
 * the line is written to the tab just made, by reference, never to whichever tab is in front.
 */
export function launchArgv(launcher, dir, prompt) {
    if (launcher === 'herdr') {
        return ['herdr-app', 'do', 'terminal.open', '--place', 'right', '--folder', dir, '--argv', JSON.stringify(['claude', prompt])];
    }
    const cmd = shellCommand(dir, prompt);
    if (launcher === 'iterm') {
        return [
            'osascript',
            '-e', 'tell application "iTerm"',
            '-e', 'activate',
            '-e', 'if (count of windows) = 0 then',
            '-e', 'set made to current session of (create window with default profile)',
            '-e', 'else',
            '-e', 'tell current window',
            '-e', 'set t to (create tab with default profile)',
            '-e', 'end tell',
            '-e', 'set made to current session of t',
            '-e', 'end if',
            '-e', `tell made to write text ${appleQuote(cmd)}`,
            '-e', 'end tell',
        ];
    }
    if (launcher === 'terminal') {
        return ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${appleQuote(cmd)}`, '-e', 'end tell'];
    }
    return undefined;
}
/** Why `herdr-app do` failed: `{ "error": … }` on stdout for a refused command, stderr when no window is open. */
export function herdrError(stdout, stderr) {
    try {
        const error = JSON.parse(stdout).error;
        if (typeof error === 'string' && error)
            return error;
    }
    catch { /* not JSON */ }
    return stderr.trim() || stdout.trim();
}
