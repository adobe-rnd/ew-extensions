import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const WORKER_URL = 'https://vibemig-migration-backend-worker.franklin-prod.workers.dev/jobs/snowflake/';
const CANVAS_URL = 'https://da.live/canvas#';
const POLL_INTERVAL_MS = 30_000;

export async function startPolling(onReady) {
  const { context } = await DA_SDK;
  const { org, repo, path } = context;
  const jobId = path?.split('/').filter(Boolean)[0];
  if (!org || !repo || !jobId) return false;

  const siteUrl = `${CANVAS_URL}/${org}/${repo}/${jobId}/index`;

  async function poll() {
    try {
      const res = await fetch(`${WORKER_URL}${encodeURIComponent(jobId)}`, { cache: 'no-store' });
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
  return true;
}
