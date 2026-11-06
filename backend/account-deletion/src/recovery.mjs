import { Timestamp } from 'firebase-admin/firestore';

export function recoveryWorker({ db, deletion, now = Date.now, pageSize = 20, maxPages = 3, intervalMs = 30_000 }) {
  let cursor = null, running = null, timer = null, stopping = false;
  async function scan() {
    for (let page = 0; page < maxPages && !stopping; page++) {
      let query = db.collection('accountDeletionLocks').where('leaseExpiresAt', '<=', Timestamp.fromMillis(now()))
        .orderBy('leaseExpiresAt').limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const candidates = await query.get();
      if (candidates.empty) { cursor = null; return; }
      cursor = candidates.docs.at(-1);
      const eligible = candidates.docs.filter(item => ['pending', 'data-deleted'].includes(item.data().phase));
      // Bound concurrent recoveries to two. Every operation reacquires/fences the current lease.
      for (let offset = 0; offset < eligible.length && !stopping; offset += 2) {
        await Promise.allSettled(eligible.slice(offset, offset + 2).map(item => deletion.resume(item)));
      }
      if (candidates.size < pageSize) { cursor = null; return; }
    }
  }
  function tick() {
    if (stopping || running) return running ?? Promise.resolve();
    running = scan().catch(() => {}).finally(() => { running = null; });
    return running;
  }
  return {
    tick,
    start() { void tick(); timer = setInterval(() => { void tick(); }, intervalMs); timer.unref(); },
    async stop() { stopping = true; if (timer) clearInterval(timer); await running; },
  };
}
