import { expect } from '@esm-bundle/chai';
import {
  storageKey,
  loadProgress,
  saveProgress,
  clearProgress,
  getNextActiveStep,
  isComplete,
} from '../../../tools/claude-design-onboarding/utils.js';

const TEST_URL = 'https://da.live/test-page';

afterEach(() => {
  localStorage.removeItem(storageKey(TEST_URL));
});

describe('storageKey', () => {
  it('returns a prefixed key', () => {
    expect(storageKey('https://da.live/foo')).to.equal('da-onboarding-https://da.live/foo');
  });
});

describe('loadProgress', () => {
  it('returns null when nothing is stored', () => {
    expect(loadProgress(TEST_URL)).to.be.null;
  });

  it('returns stored progress when valid and not expired', () => {
    saveProgress(TEST_URL, new Set([0, 1]), 2);
    const result = loadProgress(TEST_URL);
    expect(result).to.not.be.null;
    expect(result.completedSteps).to.deep.equal(new Set([0, 1]));
    expect(result.activeStep).to.equal(2);
  });

  it('returns null and removes entry when savedAt is older than 24h', () => {
    const expired = Date.now() - (25 * 60 * 60 * 1000);
    localStorage.setItem(storageKey(TEST_URL), JSON.stringify({
      completedSteps: [0],
      activeStep: 1,
      savedAt: expired,
    }));
    expect(loadProgress(TEST_URL)).to.be.null;
    expect(localStorage.getItem(storageKey(TEST_URL))).to.be.null;
  });

  it('returns null and does not throw on malformed JSON', () => {
    localStorage.setItem(storageKey(TEST_URL), 'not-json');
    expect(loadProgress(TEST_URL)).to.be.null;
  });
});

describe('saveProgress', () => {
  it('persists completedSteps as an array and activeStep', () => {
    saveProgress(TEST_URL, new Set([2, 4]), 5);
    const raw = JSON.parse(localStorage.getItem(storageKey(TEST_URL)));
    expect(raw.completedSteps).to.have.members([2, 4]);
    expect(raw.activeStep).to.equal(5);
  });

  it('stores a savedAt timestamp close to now', () => {
    const before = Date.now();
    saveProgress(TEST_URL, new Set(), 0);
    const raw = JSON.parse(localStorage.getItem(storageKey(TEST_URL)));
    expect(raw.savedAt).to.be.at.least(before);
    expect(raw.savedAt).to.be.at.most(Date.now());
  });
});

describe('clearProgress', () => {
  it('removes the stored entry', () => {
    saveProgress(TEST_URL, new Set([0]), 1);
    clearProgress(TEST_URL);
    expect(localStorage.getItem(storageKey(TEST_URL))).to.be.null;
  });

  it('does not throw when nothing is stored', () => {
    expect(() => clearProgress(TEST_URL)).to.not.throw();
  });
});

describe('getNextActiveStep', () => {
  it('returns the next uncompleted step after current', () => {
    expect(getNextActiveStep(new Set([0]), 0, 6)).to.equal(1);
  });

  it('skips already-completed steps', () => {
    expect(getNextActiveStep(new Set([0, 1, 2]), 0, 6)).to.equal(3);
  });

  it('wraps around to the beginning when remaining steps are all complete', () => {
    expect(getNextActiveStep(new Set([3, 4, 5]), 3, 6)).to.equal(0);
  });

  it('returns current step when all other steps are completed (only one left)', () => {
    // completedSteps has 5 of 6 done; current is the last uncompleted one
    expect(getNextActiveStep(new Set([0, 1, 2, 3, 4]), 5, 6)).to.equal(5);
  });
});

describe('isComplete', () => {
  it('returns true when completedSteps.size equals totalSteps', () => {
    expect(isComplete(new Set([0, 1, 2, 3, 4, 5]), 6)).to.be.true;
  });

  it('returns false when not all steps are completed', () => {
    expect(isComplete(new Set([0, 1, 2]), 6)).to.be.false;
  });

  it('returns false for an empty set', () => {
    expect(isComplete(new Set(), 6)).to.be.false;
  });

  it('returns false when completedSteps has more than totalSteps', () => {
    expect(isComplete(new Set([0, 1, 2, 3, 4, 5, 6]), 6)).to.be.false;
  });
});
