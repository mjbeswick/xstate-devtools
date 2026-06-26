/**
 * Vite plugin that injects `__xstateDevtoolsSource` into createMachine config
 * objects and state definition objects at build time, enabling the devtools
 * panel to link directly to machine and state definitions in your editor.
 *
 * Usage (vite.config.ts):
 *   import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin'
 *   export default defineConfig({ plugins: [xstateDevtoolsPlugin()] })
 */

import { createServer } from 'node:net'
import path from 'node:path'
import type { Plugin } from 'vite'

function getAvailablePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getAvailablePort(start + 1))
      } else {
        reject(err)
      }
    })
    server.listen(start, '127.0.0.1', () => {
      const port = (server.address() as any).port
      server.close(() => {
        resolve(port)
      })
    })
  })
}

/**
 * Replace the content of string literals and comments with spaces while
 * preserving all structural characters and newlines. This lets us safely
 * search for code patterns without false matches inside strings.
 */
function maskCode(code: string): string {
  const out: string[] = []
  let i = 0

  while (i < code.length) {
    // Line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      out.push('  ')
      i += 2
      while (i < code.length && code[i] !== '\n') {
        out.push(' ')
        i++
      }
    }
    // Block comment
    else if (code[i] === '/' && code[i + 1] === '*') {
      out.push('  ')
      i += 2
      while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) {
        out.push(code[i] === '\n' ? '\n' : ' ')
        i++
      }
      out.push('  ')
      i += 2
    }
    // Single or double quoted string
    else if (code[i] === '"' || code[i] === "'") {
      const q = code[i]
      out.push(q)
      i++
      while (i < code.length && code[i] !== q) {
        if (code[i] === '\\') {
          out.push('  ')
          i += 2
        } else {
          out.push(code[i] === '\n' ? '\n' : ' ')
          i++
        }
      }
      out.push(i < code.length ? q : '')
      if (i < code.length) i++
    }
    // Template literal
    else if (code[i] === '`') {
      out.push('`')
      i++
      let depth = 0
      while (i < code.length) {
        if (code[i] === '`' && depth === 0) break
        if (code[i] === '\\') {
          out.push('  ')
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          out.push('  ')
          i += 2
          depth++
          continue
        }
        if (code[i] === '{' && depth > 0) {
          out.push(' ')
          i++
          depth++
          continue
        }
        if (code[i] === '}' && depth > 0) {
          out.push(' ')
          i++
          depth--
          continue
        }
        out.push(code[i] === '\n' ? '\n' : ' ')
        i++
      }
      out.push(i < code.length ? '`' : '')
      if (i < code.length) i++
    } else {
      out.push(code[i])
      i++
    }
  }

  return out.join('')
}

function srcAt(raw: string, pos: number, filePath: string): string {
  const before = raw.slice(0, pos)
  const line = (before.match(/\n/g) ?? []).length + 1
  const col = before.length - before.lastIndexOf('\n') - 1
  return `${filePath}:${line}:${col}`
}

type Injection = { pos: number; text: string }

/**
 * Find all `createMachine({` call sites and record an injection point just
 * after the opening `{` so we can insert `__xstateDevtoolsSource`.
 */
function findMachineInjections(masked: string, raw: string, filePath: string): Injection[] {
  const injections: Injection[] = []
  let from = 0

  while (from < masked.length) {
    const idx = masked.indexOf('createMachine', from)
    if (idx === -1) break
    from = idx + 'createMachine'.length

    // Word boundary: must not be preceded by an identifier character
    if (idx > 0 && /[a-zA-Z0-9_$]/.test(masked[idx - 1])) continue

    let i = idx + 'createMachine'.length
    // Skip optional TypeScript generics <...>
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] === '<') {
      let depth = 1
      i++
      while (i < masked.length && depth > 0) {
        if (masked[i] === '<') depth++
        else if (masked[i] === '>') depth--
        i++
      }
    }
    // Expect opening paren
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] !== '(') continue
    i++
    while (i < masked.length && /\s/.test(masked[i])) i++
    // First argument must be an object literal
    if (masked[i] !== '{') continue

    injections.push({
      pos: i + 1,
      text: ` __xstateDevtoolsSource: ${JSON.stringify(srcAt(raw, idx, filePath))},`,
    })
  }

  return injections
}

/**
 * Find all `states: { KEY: { ... } }` patterns and record an injection point
 * after each state definition's opening `{`.
 *
 * Because the search is linear (finds every `states:` keyword), nested state
 * trees are handled naturally — each `states:` block at any nesting level is
 * found and its direct children are injected.
 */
function findStateInjections(masked: string, raw: string, filePath: string): Injection[] {
  const injections: Injection[] = []
  let from = 0

  while (from < masked.length) {
    // Find next word-boundary `states`
    let idx = -1
    let search = from
    while (search < masked.length) {
      const pos = masked.indexOf('states', search)
      if (pos === -1) break
      const prevOk = pos === 0 || !/[a-zA-Z0-9_$]/.test(masked[pos - 1])
      const nextOk = pos + 6 >= masked.length || !/[a-zA-Z0-9_$]/.test(masked[pos + 6])
      if (prevOk && nextOk) {
        idx = pos
        break
      }
      search = pos + 1
    }
    if (idx === -1) break
    from = idx + 6

    // Expect `states :` or `states:`
    let i = idx + 6
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] !== ':') continue
    i++
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] !== '{') continue

    // Walk the direct entries of this states block
    i++ // past '{'
    let depth = 1

    while (i < masked.length && depth > 0) {
      // Skip whitespace
      while (i < masked.length && /\s/.test(masked[i])) i++
      if (i >= masked.length || depth === 0) break

      const c = masked[i]

      if (c === '}') {
        depth--
        i++
        continue
      }

      if (depth > 1) {
        // Inside a nested structure: track braces, advance one char at a time
        if (c === '{') depth++
        i++
        continue
      }

      // depth === 1: parse the next key:value entry

      // Skip the key (identifier, quoted string key, or [computed])
      if (c === '"' || c === "'") {
        i++ // past opening quote
        while (i < masked.length && masked[i] !== c) i++
        if (i < masked.length) i++ // past closing quote
      } else if (c === '[') {
        let d = 1
        i++
        while (i < masked.length && d > 0) {
          if (masked[i] === '[') d++
          else if (masked[i] === ']') d--
          i++
        }
      } else if (/[a-zA-Z0-9_$]/.test(c)) {
        while (i < masked.length && /[a-zA-Z0-9_$]/.test(masked[i])) i++
      } else if (c === '.') {
        // Spread operator or unusual syntax — skip to comma or '}'
        i++
        continue
      } else {
        i++
        continue
      }

      while (i < masked.length && /\s/.test(masked[i])) i++

      if (masked[i] !== ':') {
        // No colon after key (e.g. spread) — skip to next entry delimiter
        while (i < masked.length && masked[i] !== ',' && masked[i] !== '}') i++
        if (i < masked.length && masked[i] === ',') i++
        continue
      }
      i++ // past ':'
      while (i < masked.length && /\s/.test(masked[i])) i++

      if (masked[i] === '{') {
        // State definition object — inject source location
        injections.push({
          pos: i + 1,
          text: ` __xstateDevtoolsSource: ${JSON.stringify(srcAt(raw, i, filePath))},`,
        })
        depth++ // entering the state config object
        i++
      } else {
        // Value is not an object literal — skip to next entry delimiter,
        // respecting any nested brackets so we don't miscount depth
        let localDepth = 0
        while (i < masked.length) {
          const vc = masked[i]
          if (vc === ',' && localDepth === 0) {
            i++
            break
          }
          if (vc === '}' && localDepth === 0) break // let outer loop handle '}'
          if (vc === '{' || vc === '[' || vc === '(') localDepth++
          else if (vc === '}' || vc === ']' || vc === ')') {
            if (localDepth > 0) localDepth--
          }
          i++
        }
      }
    }
  }

  return injections
}

export function xstateDevtoolsPlugin(): Plugin {
  return {
    name: '@xstate-devtools/source-transform',
    enforce: 'pre',
    async config() {
      if (!process.env.XSTATE_DEVTOOLS_PORT) {
        process.env.XSTATE_DEVTOOLS_PORT = String(await getAvailablePort(9301))
      }
    },
    configureServer(server) {
      server.middlewares.use('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            workspace: {
              root: process.cwd(),
              uuid: path.basename(process.cwd()),
            },
          }),
        )
      })
    },
    transformIndexHtml() {
      const port = process.env.XSTATE_DEVTOOLS_PORT || '9301'
      return [
        {
          tag: 'meta',
          injectTo: 'head',
          attrs: {
            name: 'xstate-devtools-url',
            content: `ws://localhost:${port}`,
          },
        },
      ]
    },
    transform(code, id) {
      const filePath = id.split('?')[0]
      if (filePath.includes('/node_modules/')) return null
      if (!/\.[cm]?[jt]sx?$/.test(filePath)) return null
      if (!code.includes('createMachine') && !code.includes('states')) return null

      const masked = maskCode(code)
      const injections = [
        ...findMachineInjections(masked, code, filePath),
        ...findStateInjections(masked, code, filePath),
      ]

      if (injections.length === 0) return null

      // Deduplicate (same position can't have two injections)
      const seen = new Set<number>()
      const unique = injections.filter((inj) => {
        if (seen.has(inj.pos)) return false
        seen.add(inj.pos)
        return true
      })

      // Apply in reverse order so earlier positions remain valid
      unique.sort((a, b) => b.pos - a.pos)
      let result = code
      for (const inj of unique) {
        result = result.slice(0, inj.pos) + inj.text + result.slice(inj.pos)
      }

      return { code: result, map: null }
    },
  }
}
