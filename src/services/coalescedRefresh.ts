/** Serialize snapshot reads and retain one follow-up when invalidations arrive in flight. */
export function createCoalescedRefresh(task: () => Promise<void>) {
  let active = true;
  let running = false;
  let pending = false;
  return {
    async request() {
      if (!active) return;
      if (running) { pending = true; return; }
      running = true;
      try {
        do {
          pending = false;
          await task();
        } while (active && pending);
      } finally {
        running = false;
      }
    },
    cancel() { active = false; pending = false; },
  };
}
