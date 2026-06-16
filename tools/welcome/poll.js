const WORKER_URL = 'https://vibemig-migration-backend-worker.franklin-prod.workers.dev/jobs/snowflake/';
const CANVAS_URL = 'https://da.live/'; // TODO: replace with real canvas URL
const JOB_ID = '5723fb1b0227'; // TODO: replace with dynamic job ID from service

const POLL_INTERVAL_MS = 30_000;

export function startPolling(onReady) {
  const siteUrl = `${CANVAS_URL}${JOB_ID}/index`;

  async function poll() {
    try {
      const res = await fetch(`${WORKER_URL}${encodeURIComponent(JOB_ID)}`, { cache: 'no-store' });
      if (res.status === 201) {
        onReady(siteUrl);
        return;
      }
    } catch {
      // network blip — keep polling
    }
    window.setTimeout(poll, POLL_INTERVAL_MS);
  }

  poll();
}
