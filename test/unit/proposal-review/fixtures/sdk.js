// Import-map rewriting can load this fixture under more than one URL.
const fixture = window.proposalReviewSdkFixture ||= {
  chatTurnSubscribers: new Set(),
  comparisonRequests: [],
  promptRequests: [],
};
export const { chatTurnSubscribers, comparisonRequests, promptRequests } = fixture;

export const sdk = fixture.sdk ||= {
  project: { org: 'org', repo: 'site' },
  capabilities: { chatTurnCompleted: 1 },
  actions: {
    daFetch: (...args) => window.proposalReviewFetch(...args),
    openComparison: (options) => { comparisonRequests.push(options); },
    setPrompt: (text, options) => { promptRequests.push({ text, options }); },
    subscribeChatTurnCompleted: (callback) => {
      chatTurnSubscribers.add(callback);
      return () => chatTurnSubscribers.delete(callback);
    },
  },
};

export default Promise.resolve(sdk);
