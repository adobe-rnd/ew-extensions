const WORKER_URL = 'https://vibemig-migration-backend-worker.franklin-prod.workers.dev/jobs/snowflake/';
const CANVAS_URL = 'https://da.live/canvas#';
const POLL_INTERVAL_MS = 30_000;

function getJobId() {
  const [org, site, ...parts] = window.location.hash.slice(2).split('/');
  const jobId = parts[0];
  return { org, site, jobId };
}

export function startPolling(onReady) {
  const { org, site, jobId } = getJobId();
  if (!jobId) return;

  const siteUrl = `${CANVAS_URL}/${org}/${site}/${jobId}/index`;

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
}
