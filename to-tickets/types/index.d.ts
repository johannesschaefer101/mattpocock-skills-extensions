export type TicketKind = 'agent' | 'human' | 'triage'

export type Ticket = {
  /** "#57" for a GitHub issue, "07" for a local ticket file. */
  id: string
  title: string
  /** ready-for-agent, ready-for-human, or anything else (still in triage). */
  kind: TicketKind
  /** The triage label or status text the kind was read from; empty when none. */
  label: string
  /** Empty when unclaimed. */
  assignee: string
  /** Ids of the open tickets that gate this one. */
  blockedBy: string[]
  /** Ids of the open tickets this one gates. */
  unblocks: string[]
  /** URL of a GitHub issue. */
  url?: string
  /** Absolute path of a local ticket file. */
  path?: string
  /** What the implement command is given: "#57", or the file's path relative to the session root. */
  ref: string
}

/** The open tickets under one parent issue, or in one `.scratch/<feature>/issues` folder. */
export type TicketSet = {
  /** "github:<owner>/<repo>#<parent>", "github:<owner>/<repo>" for tickets without a parent, or the local folder's path. */
  key: string
  tracker: 'github' | 'local'
  title: string
  /** All tickets of the set, closed ones included; 0 when unknown. */
  total: number
  done: number
  tickets: Ticket[]
  /** GitHub: the parent issue's URL. */
  url?: string
}

declare module 'claude-code' {
  interface PluginState {
    'ticket-board': {
      sets: Shaped<TicketSet[]>
      active: string
      sel: string
      error: string
    }
  }
}
