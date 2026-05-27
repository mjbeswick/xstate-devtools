import type { ActorRecord, SerializedStateNode, StateNodeType } from '../shared/types.js'

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

const stateTypeLabels: Record<StateNodeType, string> = {
  atomic: 'Atomic state',
  compound: 'Compound state',
  parallel: 'Parallel state',
  final: 'Final state',
  history: 'History state',
}

export function getActorNodePresentation(actor: ActorRecord, childCount: number) {
  const label = actor.machine?.id ?? actor.displayName ?? actor.sessionId.slice(0, 12)

  const kind = actor.machine
    ? 'machine actor'
    : actor.displayName
      ? 'service actor'
      : 'session actor'

  const labelColor = actor.machine ? '#237804' : actor.displayName ? '#0958d9' : '#8c8c8c'

  const summary = actor.machine
    ? `Machine actor "${label}" with an inspectable state tree.`
    : actor.displayName
      ? `Service actor "${label}" without a machine definition.`
      : 'Actor session without a display name or machine definition.'

  const ancestry = actor.parentSessionId
    ? `Child of actor ${actor.parentSessionId}.`
    : 'Root actor.'

  const children = childCount > 0
    ? `Contains ${childCount} child ${pluralize(childCount, 'actor')}.`
    : 'No child actors.'

  const status =
    actor.status === 'active'
      ? 'Active.'
      : actor.status === 'done'
        ? 'Done.'
        : actor.status === 'error'
          ? 'Errored.'
          : 'Stopped.'

  return {
    kind,
    label,
    labelColor,
    title: `${summary} ${ancestry} ${children} ${status}`,
  }
}

export function getStateNodeTitle(node: SerializedStateNode, isActive: boolean) {
  const typeLabel = stateTypeLabels[node.type]
  const childCount = Object.keys(node.states).length
  const transitionCount = node.on.length + node.always.length
  const invokeCount = node.invoke.length

  const activity = isActive ? 'Currently active.' : 'Currently inactive.'
  const children = childCount > 0
    ? `Contains ${childCount} child ${pluralize(childCount, 'state')}.`
    : 'No child states.'
  const transitions = transitionCount > 0
    ? `Has ${transitionCount} outgoing ${pluralize(transitionCount, 'transition')}.`
    : 'No outgoing transitions.'
  const invokes = invokeCount > 0
    ? `Invokes ${invokeCount} ${pluralize(invokeCount, 'service')}.`
    : 'Does not invoke services.'

  return `${typeLabel} "${node.key}". ${activity} ${children} ${transitions} ${invokes}`
}