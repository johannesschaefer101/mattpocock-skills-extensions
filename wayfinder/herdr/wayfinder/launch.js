// Generated from wayfinder/hooks/launch.ts by scripts/build-herdr.sh. Do not edit.
import { appleQuote, shellQuote } from './tracker.js';
export const mapRef = (m) => (m.tracker === 'local' ? m.relPath ?? m.key : m.url ?? m.key);
export const ticketRef = (t) => t.id;
/** The skill body without its frontmatter, minus the line about where to save (the mod picks the path). */
export function handoffRules(skillText) {
    if (!skillText) {
        return [
            'Include a "Suggested skills" section naming which skills the next agent should call.',
            'Do not duplicate what is already in the map, tickets, specs, commits or diffs: reference them by path or URL.',
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
export function handoffPrompt(m, tickets, path, skillText) {
    const list = tickets.map(t => `- ${t.id} ${t.title}`).join('\n');
    const many = tickets.length > 1;
    return [
        `The wayfinder sidebar is about to start ${many ? `${tickets.length} new sessions` : 'a new session'} on the map "${m.title}" (${mapRef(m)}):`,
        list,
        '',
        `Before they start, write a handoff note for ${many ? 'them' : 'it'} from what you learned in this session.`,
        `Save it to exactly this path, creating folders as needed: ${path}`,
        many
            ? 'Use one section per ticket, headed "## <id> <title>", so each new session reads only its own section.'
            : 'Head it "## <id> <title>".',
        'In each section: what you found here that matters for that ticket, decisions or constraints it must respect, open threads, and what to read first.',
        'Keep it short. Do not start work on the tickets yourself, and do not claim them.',
        '',
        'Rules for the note (from the handoff skill):',
        handoffRules(skillText),
        '',
        'When the file is saved, reply with one line saying so.',
    ].join('\n');
}
export function sessionPrompt(m, t, handoffPath) {
    const base = `/wayfinder ${mapRef(m)} ${ticketRef(t)}`;
    if (!handoffPath)
        return base;
    return `${base}  Context from the session that launched this one: read the "## ${t.id}" section of ${handoffPath} before anything else.`;
}
/**
 * The ticket a `/wayfinder <map> <ticket>` session works on, read from the command's arguments
 * (the inverse of sessionPrompt). Only an exact map reference followed by an open ticket's id counts.
 */
export function sessionTicket(args, maps) {
    const [ref, id] = args.trim().split(/\s+/);
    if (!ref || !id)
        return undefined;
    const m = maps.find(x => mapRef(x) === ref);
    const t = m?.tickets.find(x => ticketRef(x) === id);
    return m && t && !t.closed ? { mapKey: m.key, id: t.id } : undefined;
}
export function shellCommand(root, prompt) {
    return `cd ${shellQuote(root)} && claude ${shellQuote(prompt)}`;
}
/** osascript argv for a new tab running `cmd`. */
export function launchArgv(launcher, cmd) {
    if (launcher === 'iterm') {
        return [
            'osascript',
            '-e', 'tell application "iTerm"',
            '-e', 'activate',
            '-e', 'if (count of windows) = 0 then',
            '-e', 'create window with default profile',
            '-e', 'else',
            '-e', 'tell current window to create tab with default profile',
            '-e', 'end if',
            '-e', `tell current session of current window to write text ${appleQuote(cmd)}`,
            '-e', 'end tell',
        ];
    }
    if (launcher === 'terminal') {
        return ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${appleQuote(cmd)}`, '-e', 'end tell'];
    }
    return undefined;
}
const two = (n) => String(n).padStart(2, '0');
export function handoffFile(tmp, m, ids, now) {
    const d = new Date(now);
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'map';
    const idPart = ids.map(i => i.replace('#', '')).join('-').slice(0, 40);
    return `${tmp.replace(/\/$/, '')}/wayfinder-handoffs/${slug}-${idPart}-${stamp}.md`;
}
/** `uname -s` output: "Darwin" on macOS, "Linux" on Linux. */
export const isMac = (platform) => platform === 'Darwin';
/** iTerm and Terminal.app exist only on macOS; elsewhere launches fall back to copying the command. */
export function effectiveLauncher(launcher, platform) {
    return launcher === 'copy' || isMac(platform) ? launcher : 'copy';
}
/** argv that opens a ticket file or issue URL: the configured editor for files, else the system opener. */
export function openArgv(target, editor, platform) {
    if (editor && !/^https?:\/\//.test(target))
        return [...editor.split(/\s+/), target];
    return [isMac(platform) ? 'open' : 'xdg-open', target];
}
