import { LitElement, html } from 'da-lit';
import {
  loadProgress,
  saveProgress,
  clearProgress,
  getNextActiveStep,
  isComplete,
  parseWelcomeBlock,
} from './utils.js';

const CONTENT_URL = 'https://adobe--sendto--aemcoder.aem.page/adobe/onboarding/';

class OnboardingApp extends LitElement {
  static properties = {
    _loading: { state: true },
    _welcome: { state: true },
    _steps: { state: true },
    _showWelcome: { state: true },
    _activeStep: { state: true },
    _completedSteps: { state: true },
    _done: { state: true },
  };

  constructor() {
    super();
    this._loading = true;
    this._welcome = null;
    this._steps = [];
    this._showWelcome = true;
    this._activeStep = 0;
    this._completedSteps = new Set();
    this._done = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._loadContent();
  }

  async _loadContent() {
    try {
      const resp = await fetch(CONTENT_URL);
      const text = await resp.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const block = doc.querySelector('.welcome');
      if (block) {
        const { welcome, steps } = parseWelcomeBlock(block);
        this._welcome = welcome;
        this._steps = steps;
      }
    } catch {
      // Fetch failed — steps remain empty
    }

    const saved = loadProgress(window.location.href);
    if (saved) {
      this._completedSteps = saved.completedSteps;
      this._activeStep = saved.activeStep;
      this._done = isComplete(this._completedSteps, this._steps.length);
      if (saved.completedSteps.size > 0) this._showWelcome = false;
    }

    this._loading = false;
  }

  _onStartTour() {
    this._showWelcome = false;
  }

  _onMarkComplete() {
    const next = new Set(this._completedSteps);
    next.add(this._activeStep);
    if (isComplete(next, this._steps.length)) {
      this._completedSteps = next;
      this._done = true;
      saveProgress(window.location.href, next, this._activeStep);
      return;
    }
    const nextStep = getNextActiveStep(next, this._activeStep, this._steps.length);
    this._completedSteps = next;
    this._activeStep = nextStep;
    saveProgress(window.location.href, next, nextStep);
  }

  _onNavigateToStep(index) {
    this._activeStep = index;
    this._showWelcome = false;
  }

  _onStartOver() {
    clearProgress(window.location.href);
    this._completedSteps = new Set();
    this._activeStep = 0;
    this._done = false;
    this._showWelcome = true;
  }

  _renderLoading() {
    return html`<div class="ob-loading"><div class="ob-spinner"></div></div>`;
  }

  _renderWelcome() {
    const { title, description, ctaText } = this._welcome || {};
    return html`
      <div class="ob-step-card">
        <p class="ob-step-title">${title}</p>
        <p class="ob-step-desc">${description}</p>
        <sl-button class="ob-fill-accent" @click=${() => this._onStartTour()}>
          ${ctaText || 'Start the tour'}
        </sl-button>
      </div>`;
  }

  _renderStepCard() {
    const step = this._steps[this._activeStep];
    if (!step) return html``;
    const isAlreadyDone = this._completedSteps.has(this._activeStep);
    return html`
      <div class="ob-step-card">
        <p class="ob-step-label">${step.label}</p>
        <p class="ob-step-title">${step.title}</p>
        <p class="ob-step-desc">${step.description}</p>
        <sl-button
          class="ob-fill-accent"
          ?disabled=${isAlreadyDone}
          @click=${() => this._onMarkComplete()}
        >
          ${isAlreadyDone ? 'Completed ✓' : 'Mark complete →'}
        </sl-button>
      </div>`;
  }

  _renderLessonsList() {
    return html`
      <p class="ob-lessons-label">All Lessons</p>
      <ul class="ob-lessons-list">
        ${this._steps.map((step, i) => {
          const completed = this._completedSteps.has(i);
          const active = !this._showWelcome && this._activeStep === i;
          const cls = `ob-lesson-row${active ? ' active' : ''}${completed ? ' completed' : ''}`;
          const badge = completed ? '✓' : String(i + 1);
          return html`
            <li class=${cls} @click=${() => this._onNavigateToStep(i)}>
              <span class="ob-lesson-badge">${badge}</span>
              <span class="ob-lesson-title">${step.title}</span>
            </li>`;
        })}
      </ul>`;
  }

  _renderCompletion() {
    return html`
      <div class="ob-completion">
        <span class="ob-completion-icon">🎉</span>
        <p class="ob-completion-title">You're all done!</p>
        <p class="ob-completion-msg">
          You've completed all ${this._steps.length} lessons. You're ready to make this site your own.
        </p>
        <sl-button class="ob-quiet-link" @click=${() => this._onStartOver()}>
          Start over
        </sl-button>
      </div>`;
  }

  render() {
    if (this._loading) return this._renderLoading();

    const fillPct = this._steps.length
      ? (this._completedSteps.size / this._steps.length) * 100
      : 0;

    const mainContent = this._done
      ? this._renderCompletion()
      : html`
          ${this._showWelcome ? this._renderWelcome() : this._renderStepCard()}
          ${this._renderLessonsList()}
        `;

    return html`
      <span class="ob-eyebrow">Guided Onboarding</span>
      <h1 class="ob-title">Make this site yours</h1>
      <p class="ob-subtitle">Follow these lessons to get started — everything here is a safe sandbox.</p>

      <div class="ob-progress">
        <div class="ob-progress-label">
          <span>Your Progress</span>
          <span>${this._completedSteps.size} of ${this._steps.length}</span>
        </div>
        <div class="ob-progress-track">
          <div class="ob-progress-fill" style="width: ${fillPct}%"></div>
        </div>
      </div>

      ${mainContent}
    `;
  }
}

customElements.define('onboarding-app', OnboardingApp);
