import { describe, expect, it } from 'vitest'
import { ORCHESTRATION_DELIVERY_BATCH_LIMIT } from './db'
import { OrchestrationDb } from './db/orchestration-db'
import {
  selectOrchestrationPointerBatch,
  type OrchestrationMessageWaiter
} from './mailbox-pointer-eligibility'

/**
 * Exclusion is applied ONLY in SQL. It used to be applied a second time in JS, which meant a broken
 * SQL predicate still produced a correct batch — so these cases run against a real database rather
 * than a stub, and fail if the SQL exclusion stops carrying the whole contract.
 */
const MAILBOX = 'dispatch:d1'

function seeded(): OrchestrationDb {
  const db = new OrchestrationDb(':memory:')
  db.insertMessages([
    { runId: 'run_legacy_local', from: 'coordinator', to: MAILBOX, subject: 'a', type: 'status' },
    { runId: 'run_legacy_local', from: 'coordinator', to: MAILBOX, subject: 'b', type: 'question' },
    { runId: 'run_legacy_local', from: 'coordinator', to: MAILBOX, subject: 'c', type: 'status' }
  ])
  return db
}

function waiters(...filters: (string[] | undefined)[]): ReadonlySet<OrchestrationMessageWaiter> {
  return new Set(filters.map((typeFilter) => ({ typeFilter })))
}

describe('selectOrchestrationPointerBatch', () => {
  it('excludes a waiter-claimed type', () => {
    const db = seeded()
    try {
      const batch = selectOrchestrationPointerBatch({
        db,
        mailboxHandle: MAILBOX,
        waiters: waiters(['question']),
        reservedTypes: undefined
      })
      expect(batch.map((m) => m.type)).toEqual(['status', 'status'])
    } finally {
      db.close()
    }
  })

  it('excludes a reserved type', () => {
    const db = seeded()
    try {
      const batch = selectOrchestrationPointerBatch({
        db,
        mailboxHandle: MAILBOX,
        waiters: undefined,
        reservedTypes: new Set(['status'])
      })
      expect(batch.map((m) => m.type)).toEqual(['question'])
    } finally {
      db.close()
    }
  })

  it('unions reserved types with every waiter filter', () => {
    const db = seeded()
    try {
      expect(
        selectOrchestrationPointerBatch({
          db,
          mailboxHandle: MAILBOX,
          waiters: waiters(['question']),
          reservedTypes: new Set(['status'])
        })
      ).toEqual([])
    } finally {
      db.close()
    }
  })

  // An unfiltered waiter owns the mailbox: a caller blocked in `check --wait` preempts delivery.
  it('yields nothing when any waiter is unfiltered', () => {
    const db = seeded()
    try {
      expect(
        selectOrchestrationPointerBatch({
          db,
          mailboxHandle: MAILBOX,
          waiters: waiters(['question'], undefined),
          reservedTypes: undefined
        })
      ).toEqual([])
    } finally {
      db.close()
    }
  })

  it('never points at a mailbox holding only heartbeats', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      db.insertMessages([
        { runId: 'run_legacy_local', from: 'worker', to: MAILBOX, subject: 'a', type: 'heartbeat' },
        { runId: 'run_legacy_local', from: 'worker', to: MAILBOX, subject: 'b', type: 'heartbeat' }
      ])
      expect(
        selectOrchestrationPointerBatch({
          db,
          mailboxHandle: MAILBOX,
          waiters: undefined,
          reservedTypes: undefined
        })
      ).toEqual([])
    } finally {
      db.close()
    }
  })

  it('points past a backlog of heartbeats larger than one batch', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      db.insertMessages(
        Array.from({ length: ORCHESTRATION_DELIVERY_BATCH_LIMIT + 5 }, (_, index) => ({
          runId: 'run_legacy_local',
          from: 'worker',
          to: MAILBOX,
          subject: `beat ${index}`,
          type: 'heartbeat' as const
        }))
      )
      db.insertMessage({
        runId: 'run_legacy_local',
        from: 'worker',
        to: MAILBOX,
        subject: 'done',
        type: 'worker_done'
      })
      const batch = selectOrchestrationPointerBatch({
        db,
        mailboxHandle: MAILBOX,
        waiters: waiters(['question']),
        reservedTypes: new Set(['status'])
      })
      expect(batch.map((m) => m.type)).toEqual(['worker_done'])
    } finally {
      db.close()
    }
  })
})
