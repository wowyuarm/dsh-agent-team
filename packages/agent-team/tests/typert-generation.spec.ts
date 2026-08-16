import { describe, expect, it } from 'vitest'
import { TYPERT } from '../lib/typert.host.js'
import remote from '../lib/typert.remote-client.js'

interface GeneratedInvocation {
  readonly method: string
}

interface GeneratedHost {
  readonly invocations: readonly GeneratedInvocation[]
}

interface GeneratedRemote {
  readonly descriptors: readonly GeneratedInvocation[]
}

describe('Agent Team generated Typert boundary', () => {
  it('publishes the members and addMember Remote methods', () => {
    const host = TYPERT as GeneratedHost
    const client = remote as unknown as GeneratedRemote
    expect(host.invocations.map(invocation => invocation.method).sort()).toEqual([
      'addMember',
      'members',
    ])
    expect(client.descriptors.map(invocation => invocation.method).sort()).toEqual([
      'addMember',
      'members',
    ])
  })
})
