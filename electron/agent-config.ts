import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { AgentProvider } from '@shared/types'

export interface AgentConfig {
  command?: string
  /** Full replacement for Kadr's provider-specific default arguments. */
  args?: string[]
  env?: Record<string, string>
}

let activeProvider: AgentProvider | null = null

export function setActiveAgentProvider(provider: AgentProvider | null) {
  activeProvider = provider
}

export async function readAgentConfig(provider: AgentProvider): Promise<AgentConfig> {
  try {
    const path = join(app.getPath('userData'), `${provider}-env.json`)
    const raw = JSON.parse(await fs.readFile(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const command = typeof raw.command === 'string' ? raw.command : undefined
    const args = Array.isArray(raw.args) && raw.args.every((arg: unknown) => typeof arg === 'string')
      ? raw.args
      : undefined
    const env = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env).filter((entry): entry is [string, string] =>
            typeof entry[1] === 'string')
        )
      : undefined
    return { command, args, env }
  } catch {
    return {}
  }
}

/** Network settings for fragment npm/remotion processes. */
export async function activeAgentEnv(): Promise<Record<string, string>> {
  // Claude is the historical fallback for fragment operations outside a live
  // agent session, preserving the old claude-env.json behavior.
  return (await readAgentConfig(activeProvider ?? 'claude')).env ?? {}
}
