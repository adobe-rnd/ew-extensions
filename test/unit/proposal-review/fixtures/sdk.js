export default Promise.resolve({
  project: { org: 'org', repo: 'site' },
  actions: { daFetch: (...args) => window.proposalReviewFetch(...args) },
});
