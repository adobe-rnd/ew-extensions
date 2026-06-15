const EXPIRY_MS = 24 * 60 * 60 * 1000;

export function storageKey(url) {
  return `da-onboarding-${url}`;
}

export function loadProgress(url) {
  try {
    const raw = localStorage.getItem(storageKey(url));
    if (!raw) return null;
    const { completedSteps, activeStep, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > EXPIRY_MS) {
      localStorage.removeItem(storageKey(url));
      return null;
    }
    return { completedSteps: new Set(completedSteps), activeStep };
  } catch {
    return null;
  }
}

export function saveProgress(url, completedSteps, activeStep) {
  localStorage.setItem(storageKey(url), JSON.stringify({
    completedSteps: [...completedSteps],
    activeStep,
    savedAt: Date.now(),
  }));
}

export function clearProgress(url) {
  localStorage.removeItem(storageKey(url));
}

export function getNextActiveStep(completedSteps, currentActiveStep, totalSteps) {
  for (let i = currentActiveStep + 1; i < totalSteps; i += 1) {
    if (!completedSteps.has(i)) return i;
  }
  for (let i = 0; i < currentActiveStep; i += 1) {
    if (!completedSteps.has(i)) return i;
  }
  return currentActiveStep;
}

export function isComplete(completedSteps, totalSteps) {
  return completedSteps.size === totalSteps;
}
