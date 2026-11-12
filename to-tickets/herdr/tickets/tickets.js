// Generated from to-tickets/hooks/tickets.ts by scripts/build-herdr.sh. Do not edit.
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
/** `working`: an agent runs on the ticket right now, whoever it is assigned to. */
export function statusOf(t, working = false) {
    if (t.assignee || working)
        return 'claimed';
    if (t.blockedBy.length)
        return 'blocked';
    return t.kind === 'agent' ? 'ready' : t.kind;
}
export const GROUPS = ['ready', 'human', 'claimed', 'blocked', 'triage'];
/** Ticket ids in the order the pane lists them; `working` holds the refs of the tickets an agent runs on. */
export const visibleOrder = (set, working = new Set()) => GROUPS.flatMap(s => set.tickets.filter(t => statusOf(t, working.has(t.ref)) === s).map(t => t.id));
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
// ---------- handoff notes (the herdr pane) ----------
/** The handoff skill's rules without its frontmatter and its line about where to save (the pane picks the path); three rules of its own when the skill is not installed. */
export function handoffRules(skillText) {
    if (!skillText) {
        return [
            'Include a "Suggested skills" section naming which skills the next agent should call.',
            'Do not duplicate what is already in the ticket, specs, commits or diffs: reference them by path or URL.',
            'Redact sensitive information such as API keys, passwords or personal data.',
        ].join('\n');
    }
    const body = skillText.startsWith('---') ? skillText.slice(skillText.indexOf('\n---', 3) + 4) : skillText;
    return body
        .split('\n')
        .filter(l => !/save to|temporary directory/i.test(l))
        .join('\n')
        .trim();
}
/** What an agent at work in the project is asked before a session starts on a ticket: a note at `path` for that session. */
export function handoffPrompt(setTitle, t, path, skillText) {
    return [
        `The ticket board is about to start a new session on a ticket of "${setTitle}":`,
        `- ${t.id} ${t.title}${t.ref === t.id ? '' : ` (${t.ref})`}`,
        '',
        'Before it starts, write a handoff note for it from what you learned in this session.',
        `Save it to exactly this path, creating folders as needed: ${path}`,
        'Head it "## <id> <title>".',
        'In it: what you found here that matters for that ticket, decisions or constraints it must respect, open threads, and what to read first.',
        'Keep it short. Do not start work on the ticket yourself, and do not claim it.',
        '',
        'Rules for the note (from the handoff skill):',
        handoffRules(skillText),
        '',
        'When the file is saved, reply with one line saying so.',
    ].join('\n');
}
/** What a session on a ticket starts with: the implement command, told to read the handoff note first when there is one. */
export function sessionPrompt(command, ref, handoffPath) {
    const base = `/${command} ${ref}`;
    return handoffPath ? `${base}  Context from the session that launched this one: read ${handoffPath} before anything else.` : base;
}
/** The ticket reference of a session started by sessionPrompt, or by hand as `/<command> <ref>`; undefined for any other prompt. */
export function sessionRef(command, prompt) {
    const prefix = `/${command} `;
    return prompt.startsWith(prefix) ? prompt.slice(prefix.length).split('  Context from the session')[0].trim() || undefined : undefined;
}
const two = (n) => String(n).padStart(2, '0');
/** Where a ticket's handoff note goes: outside the repository, named after the ticket and the time. */
export function handoffFile(tmp, id, now) {
    const d = new Date(now);
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    return `${tmp.replace(/\/$/, '')}/ticket-board-handoffs/${id.replace(/[^A-Za-z0-9]+/g, '') || 'ticket'}-${stamp}.md`;
}
