import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkBoundMailbox,
  createBoundRun,
  createDatabase,
  createRuntime,
  driveToLiveIdle,
  pointerCount,
  temporaryDirectories
} from './orchestration-mailbox-notification-test-harness'

describe('orchestration mailbox heartbeat pointers', () => {
  afterEach(() => {
    vi.useRealTimers()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not point an idle coordinator at heartbeats, alone or behind real mail', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-heartbeat-')
    const harness = createRuntime(db)
    const run = createBoundRun(db, 'Heartbeat Run')
    const mailbox = `run:${run.id}`
    await driveToLiveIdle(harness.runtime)
    const sendToRun = (type: 'heartbeat' | 'worker_done', subject: string) => {
      const message = db.insertMessage({
        from: 'term_worker',
        to: mailbox,
        subject,
        type,
        runId: run.id
      })
      harness.runtime.notifyMessageArrived(mailbox, type)
      return message
    }

    const firstBeat = sendToRun('heartbeat', 'alive')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)
    expect(pointerCount(harness.write)).toBe(0)
    expect(db.getMessageById(firstBeat.id)).toMatchObject({ read: 0, delivered_at: null })

    const secondBeat = sendToRun('heartbeat', 'alive')
    const done = sendToRun('worker_done', 'finished')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)
    expect(pointerCount(harness.write)).toBe(1)
    expect(harness.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('You have 1 orchestration message')
    )
    expect(db.getMessageById(done.id)?.delivered_at).toEqual(expect.any(String))
    expect(db.getMessageById(secondBeat.id)?.delivered_at).toBeNull()

    // An explicit check still returns and acknowledges the heartbeats.
    const checked = await checkBoundMailbox(harness.runtime)
    expect(checked.messages).toEqual([
      expect.objectContaining({ id: firstBeat.id }),
      expect.objectContaining({ id: secondBeat.id }),
      expect.objectContaining({ id: done.id })
    ])
    await checkBoundMailbox(harness.runtime, { ack: checked.deliveryId! })
    expect(db.getMessageById(firstBeat.id)?.read).toBe(1)
    expect(db.getMessageById(secondBeat.id)?.read).toBe(1)

    // Heartbeats left undelivered must not resurface as a pointer on a later idle edge.
    harness.runtime.deliverPendingMessagesForHandle(mailbox)
    sendToRun('heartbeat', 'alive')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)
    expect(pointerCount(harness.write)).toBe(1)
    db.close()
  })
})
