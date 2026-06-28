// Embedded agent session: a PTY running Codex CLI or Claude Code inside the
// editor, wired to the live project through a local HTTP + MCP bridge.
import { app, BrowserWindow, ipcMain } from 'electron'
import { createServer, type Server } from 'http'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { IPty } from 'node-pty'
import type { AgentProvider } from '@shared/types'
import { readAgentConfig, setActiveAgentProvider } from './agent-config'

const SYSTEM_HINT =
  'You are embedded inside Kadr, a video editor, and were opened from its UI. ' +
  'The MCP server "kadr" is connected to the LIVE project the user is editing right now: ' +
  'kadr_state reads it, kadr_eval changes it, kadr_export renders it, kadr_transcribe does ' +
  'speech-to-text, kadr_fragment_create makes Remotion compositions (animations, dynamic ' +
  'captions, motion graphics) that live as clips on the timeline — after creating one, edit ' +
  'its TSX entry file directly: the user sees your changes live in the preview, no rendering. ' +
  'Treat user requests as being about this project unless told otherwise. ' +
  'Imported media file paths are in kadr_state assets — you may read those files directly; the system ffmpeg/ffprobe are available for media work.'

const IS_WIN = process.platform === 'win32'

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = IS_WIN ? 'where' : '/bin/sh'
    const args = IS_WIN ? [cmd] : ['-c', `command -v ${cmd}`]
    execFile(finder, args, (err, stdout) => {
      const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      resolve(err ? null : first || null)
    })
  })
}

interface Session {
  provider: AgentProvider
  generation: number
  pty: IPty
  server: Server
  port: number
}

let session: Session | null = null
let requestedProvider: AgentProvider | null = null
let generation = 0

/** JS evaluated in the page (async function body) -> JSON result. */
async function evalInPage(win: BrowserWindow, code: string): Promise<string> {
  const wrapped = `(async () => {
    try {
      const r = await (async () => { ${code}\n })()
      return JSON.stringify({ ok: r === undefined ? null : r })
    } catch (e) {
      return JSON.stringify({ error: String((e && (e.stack || e.message)) || e) })
    }
  })()`
  return win.webContents.executeJavaScript(wrapped, true)
}

/** Local bridge: POST /eval {code} from mcp-bridge.cjs into the renderer. */
function startBridge(win: BrowserWindow): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/eval') {
        res.writeHead(404).end()
        return
      }
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const { code } = JSON.parse(body)
          const out = await evalInPage(win, String(code))
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(out)
        } catch (err) {
          res
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: String(err) }))
        }
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve({ server, port: addr.port })
      else reject(new Error('bridge listen failed'))
    })
  })
}

function bridgeCommand(port: number) {
  return {
    command: 'node',
    args: [join(app.getAppPath(), 'electron', 'mcp-bridge.cjs'), String(port)]
  }
}

async function defaultArgs(provider: AgentProvider, port: number): Promise<string[]> {
  const bridge = bridgeCommand(port)
  if (provider === 'claude') {
    const mcpCfgPath = join(app.getPath('userData'), 'kadr-mcp.json')
    await fs.writeFile(
      mcpCfgPath,
      JSON.stringify({ mcpServers: { kadr: bridge } }, null, 1)
    )
    return ['--mcp-config', mcpCfgPath, '--append-system-prompt', SYSTEM_HINT]
  }

  return [
    '-c', `mcp_servers.kadr.command=${JSON.stringify(bridge.command)}`,
    '-c', `mcp_servers.kadr.args=${JSON.stringify(bridge.args)}`
  ]
}

function closeCurrent(provider?: AgentProvider) {
  if (!session || (provider && session.provider !== provider)) return
  const current = session
  session = null
  requestedProvider = null
  setActiveAgentProvider(null)
  try { current.pty.kill() } catch { /* already dead */ }
  current.server.close()
}

function closeSession(provider?: AgentProvider) {
  if (provider && requestedProvider !== provider && session?.provider !== provider) return
  generation++
  requestedProvider = null
  closeCurrent(provider)
}

async function openSession(
  provider: AgentProvider,
  win: BrowserWindow,
  cols: number,
  rows: number,
  cwd: string | null
): Promise<{ ok: boolean; port?: number; error?: string }> {
  const ownGeneration = ++generation
  closeCurrent()
  requestedProvider = provider

  const cfg = await readAgentConfig(provider)
  if (ownGeneration !== generation) return { ok: false, error: 'session cancelled' }

  let bridge: { server: Server; port: number }
  try {
    bridge = await startBridge(win)
  } catch (err) {
    if (ownGeneration === generation) requestedProvider = null
    return { ok: false, error: `bridge: ${String(err)}` }
  }
  if (ownGeneration !== generation) {
    bridge.server.close()
    return { ok: false, error: 'session cancelled' }
  }

  let args: string[]
  try {
    args = cfg.args ?? await defaultArgs(provider, bridge.port)
  } catch (err) {
    bridge.server.close()
    if (ownGeneration === generation) requestedProvider = null
    return { ok: false, error: `configuration: ${String(err)}` }
  }
  if (ownGeneration !== generation) {
    bridge.server.close()
    return { ok: false, error: 'session cancelled' }
  }

  const envCommand = provider === 'codex' ? process.env.KADR_CODEX_CMD : process.env.KADR_CLAUDE_CMD
  const command = envCommand || cfg.command || provider
  const bin = (await which(command)) ?? command
  const useShim = IS_WIN && /\.(cmd|bat)$/i.test(bin)
  const file = useShim ? process.env.ComSpec || 'cmd.exe' : bin
  const spawnArgs = useShim ? ['/c', bin, ...args] : args

  let dir = cwd || app.getPath('home')
  try { await fs.access(dir) } catch { dir = app.getPath('home') }

  try {
    const pty = await import('node-pty')
    const terminal = pty.spawn(file, spawnArgs, {
      name: 'xterm-256color',
      cols: Math.max(20, cols),
      rows: Math.max(5, rows),
      cwd: dir,
      env: { ...process.env, ...cfg.env } as Record<string, string>
    })
    if (ownGeneration !== generation) {
      try { terminal.kill() } catch { /* already dead */ }
      bridge.server.close()
      return { ok: false, error: 'session cancelled' }
    }

    const current: Session = {
      provider, generation: ownGeneration, pty: terminal,
      server: bridge.server, port: bridge.port
    }
    session = current
    requestedProvider = provider
    setActiveAgentProvider(provider)

    terminal.onData((data) => {
      if (session !== current) return
      win.webContents.send('agent:data', data)
      if (provider === 'claude') win.webContents.send('claude:data', data)
    })
    terminal.onExit(({ exitCode }) => {
      if (session !== current) return
      win.webContents.send('agent:exit', exitCode)
      if (provider === 'claude') win.webContents.send('claude:exit', exitCode)
      current.server.close()
      session = null
      requestedProvider = null
      setActiveAgentProvider(null)
    })
    return { ok: true, port: bridge.port }
  } catch (err) {
    bridge.server.close()
    if (ownGeneration === generation) requestedProvider = null
    return { ok: false, error: String(err) }
  }
}

export function registerAgentIpc(getWin: () => BrowserWindow | null) {
  const open = (provider: AgentProvider, cols: number, rows: number, cwd: string | null) => {
    if (provider !== 'codex' && provider !== 'claude') {
      return { ok: false, error: `unsupported agent provider: ${String(provider)}` }
    }
    const win = getWin()
    if (!win) return { ok: false, error: 'no window' }
    return openSession(provider, win, cols, rows, cwd)
  }

  ipcMain.handle('agent:open', (_e, provider: AgentProvider, cols: number, rows: number, cwd: string | null) =>
    open(provider, cols, rows, cwd))
  ipcMain.on('agent:input', (_e, provider: AgentProvider, data: string) => {
    if (session?.provider === provider) session.pty.write(data)
  })
  ipcMain.on('agent:resize', (_e, provider: AgentProvider, cols: number, rows: number) => {
    if (session?.provider !== provider) return
    try { session?.pty.resize(Math.max(20, cols), Math.max(5, rows)) } catch { /* dying */ }
  })
  ipcMain.handle('agent:close', (_e, provider?: AgentProvider) => closeSession(provider))

  ipcMain.handle('claude:open', (_e, cols: number, rows: number, cwd: string | null) =>
    open('claude', cols, rows, cwd))
  ipcMain.on('claude:input', (_e, data: string) => {
    if (session?.provider === 'claude') session.pty.write(data)
  })
  ipcMain.on('claude:resize', (_e, cols: number, rows: number) => {
    if (session?.provider !== 'claude') return
    try { session.pty.resize(Math.max(20, cols), Math.max(5, rows)) } catch { /* dying */ }
  })
  ipcMain.handle('claude:close', () => closeSession('claude'))

  app.on('before-quit', () => closeSession())
}
