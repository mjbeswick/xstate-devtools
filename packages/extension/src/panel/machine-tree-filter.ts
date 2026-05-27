import type { SerializedStateNode } from '../shared/types.js'

export type FilterScope = 'any' | 'machine' | 'state'

export interface FilterToken {
  negated: boolean
  scope: FilterScope
  value: string
}

function parseScopedToken(token: string): { scope: FilterScope; value: string } {
  const separatorIndex = token.indexOf(':')
  if (separatorIndex <= 0) {
    return { scope: 'any', value: token }
  }

  const prefix = token.slice(0, separatorIndex).toLowerCase()
  const value = token.slice(separatorIndex + 1)

  if ((prefix === 'machine' || prefix === 'state') && value) {
    return { scope: prefix, value }
  }

  return { scope: 'any', value: token }
}

export function parseMachineTreeFilter(filter: string): FilterToken[] {
  return filter
    .split(/\s+/)
    .map((rawToken) => rawToken.trim())
    .filter(Boolean)
    .map((rawToken) => {
      const negated = rawToken.startsWith('-') && rawToken.length > 1
      const token = negated ? rawToken.slice(1) : rawToken
      const { scope, value } = parseScopedToken(token)

      return {
        negated,
        scope,
        value: value.toLowerCase(),
      }
    })
    .filter((token) => token.value.length > 0)
}

function getMachineSearchText(machineId: string): string {
  return machineId.toLowerCase()
}

function getStateSearchText(node: SerializedStateNode): string {
  return `${node.key} ${node.id}`.toLowerCase()
}

function tokenMatches(token: FilterToken, machineId: string, node: SerializedStateNode): boolean {
  const machineText = getMachineSearchText(machineId)
  const stateText = getStateSearchText(node)

  switch (token.scope) {
    case 'machine':
      return machineText.includes(token.value)
    case 'state':
      return stateText.includes(token.value)
    case 'any':
      return machineText.includes(token.value) || stateText.includes(token.value)
  }
}

function nodePassesTokens(
  tokens: FilterToken[],
  machineId: string,
  node: SerializedStateNode,
): boolean {
  const positiveTokens = tokens.filter((token) => !token.negated)
  const negativeTokens = tokens.filter((token) => token.negated)

  if (negativeTokens.some((token) => tokenMatches(token, machineId, node))) {
    return false
  }

  return positiveTokens.every((token) => tokenMatches(token, machineId, node))
}

export function buildMachineTreeMatchSet(
  root: SerializedStateNode,
  machineId: string,
  filter: string,
): Set<string> {
  const tokens = parseMachineTreeFilter(filter)
  const matched = new Set<string>()

  if (tokens.length === 0) {
    return matched
  }

  function visit(node: SerializedStateNode): boolean {
    if (
      !nodePassesTokens(
        tokens.filter((token) => token.negated),
        machineId,
        node,
      )
    ) {
      return false
    }

    let anyChildMatches = false
    for (const child of Object.values(node.states)) {
      if (visit(child)) {
        anyChildMatches = true
      }
    }

    const selfMatches = nodePassesTokens(tokens, machineId, node)
    if (selfMatches || anyChildMatches) {
      matched.add(node.id)
      return true
    }

    return false
  }

  visit(root)
  return matched
}

export function getMachineTreeHighlightTerm(filter: string): string {
  const tokens = parseMachineTreeFilter(filter)

  return tokens.find((token) => !token.negated && token.scope !== 'machine')?.value ?? ''
}
