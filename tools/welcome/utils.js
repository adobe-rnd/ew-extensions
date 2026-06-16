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
  // Use === not >= — a set larger than totalSteps would indicate a bug upstream
  return completedSteps.size === totalSteps;
}

export function parseWelcomeBlock(block) {
  const rows = [...block.children];
  let welcome = null;
  const steps = [];

  rows.forEach((row) => {
    const cols = [...row.children];
    const stepLabelEl = cols[0]?.querySelector('h5');
    const contentEl = cols[1];
    const action = cols[2]?.textContent.trim() || '';

    if (!stepLabelEl) {
      const titleEl = contentEl?.querySelector('h2');
      const paras = [...(contentEl?.querySelectorAll('p') || [])];
      const ctaEl = contentEl?.querySelector('a');
      const descClone = paras[0]?.cloneNode(true);
      descClone?.querySelectorAll('a').forEach((a) => a.remove());
      welcome = {
        title: titleEl?.textContent.trim() || '',
        description: descClone?.textContent.replace(/\s+/g, ' ').trim() || '',
        ctaText: ctaEl?.textContent.trim() || 'Start the tour',
      };
    } else {
      const titleEl = contentEl?.querySelector('h3');
      const paras = [...(contentEl?.querySelectorAll('p') || [])];
      const descPara = paras.find((p) => !p.querySelector('strong > a'));
      steps.push({
        label: stepLabelEl.textContent.trim(),
        title: titleEl?.textContent.trim() || '',
        description: descPara?.textContent.trim() || '',
        action,
      });
    }
  });

  return { welcome, steps };
}
