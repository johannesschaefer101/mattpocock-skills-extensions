export type TicketType = 'grilling' | 'prototype' | 'research' | 'task' | 'unknown'

export type Ticket = {
  /** "07" for a local ticket file, "#57" for a GitHub issue. */
  id: string
  title: string
  type: TicketType
  /** Needs a human in the loop. */
  hitl: boolean
  closed: boolean
  /** Empty when unclaimed. */
  assignee: string
  blockedBy: string[]
  /** Absolute path of a local ticket file. */
  path?: string
  /** URL of a GitHub issue. */
  url?: string
  /** Set when the file or issue could not be read fully. */
  warning?: string
}

export type WfMap = {
  /** Absolute map.md path, or "github:<owner>/<repo>#<n>". */
  key: string
  tracker: 'local' | 'github'
  title: string
  destination: string
  fog: string[]
  decisions: number
  tickets: Ticket[]
  /** Local: map.md path relative to the session root. */
  relPath?: string
  /** GitHub: the map issue's URL. */
  url?: string
  repo?: string
  number?: number
  error?: string
}

export type Flow = {
  mapKey: string
  ids: string[]
  stage: 'ask' | 'writing' | 'ready'
  handoffPath?: string
  startedAt: number
}

/** A ticket this session launched and that has not been claimed yet. */
export type Launch = { mapKey: string; id: string; at: number }

export type Flash = { ids: string[]; until: number }

declare module 'claude-code' {
  interface PluginState {
    'wayfinder-sidebar': {
      maps: Shaped<WfMap[]>
      active: string
      sel: string
      flow: Shaped<Flow | null>
      picked: string[]
      launches: Shaped<Launch[]>
      flash: Shaped<Flash | null>
      mine: string[]
      peers: Shaped<Record<string, string>>
      showDone: boolean
      spin: number
    }
  }
}
