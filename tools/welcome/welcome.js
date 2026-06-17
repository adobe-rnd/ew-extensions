import { LitElement, html } from 'da-lit';
import {
  loadProgress,
  saveProgress,
  clearProgress,
  getNextActiveStep,
  isComplete,
  parseWelcomeBlock,
} from './utils.js';
import { startPolling } from './poll.js';

const CONTENT_URL = 'https://adobe--sendto--aemcoder.aem.page/adobe/onboarding/';

class WelcomeApp extends LitElement {
  static properties = {
    _loading: { state: true },
    _welcome: { state: true },
    _steps: { state: true },
    _showWelcome: { state: true },
    _activeStep: { state: true },
    _completedSteps: { state: true },
    _done: { state: true },
    _pageReady: { state: true },
    _siteUrl: { state: true },
    _hasJob: { state: true },
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
    this._pageReady = false;
    this._siteUrl = '';
    this._hasJob = false;
    // Set by the host to provide chat integration: { setPrompt(prompt, opts) {} }
    this._actions = null;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._loadContent();
    startPolling((siteUrl) => {
      this._siteUrl = siteUrl;
      this._pageReady = true;
    }).then((started) => { this._hasJob = started; });
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

  _executeStepAction(step) {
    const action = step?.action || '';
    if (!action || action === 'scroll-to') return;

    const match = action.match(/^open-chat\("(.*)"\)$/s);
    if (match) {
      const prompt = match[1];
      window.parent.postMessage({ type: 'nx-open-chat' }, '*');
      if (this._actions?.setPrompt) {
        this._actions.setPrompt(prompt, { autoSend: true });
      }
    }
  }

  _onStartTour() {
    this._showWelcome = false;
    this._executeStepAction(this._steps[this._activeStep]);
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
    this._executeStepAction(this._steps[nextStep]);
  }

  _onNavigateToStep(index) {
    this._activeStep = index;
    this._showWelcome = false;
    this._executeStepAction(this._steps[index]);
  }

  _onStartOver() {
    clearProgress(window.location.href);
    this._completedSteps = new Set();
    this._activeStep = 0;
    this._done = false;
    this._showWelcome = true;
  }

  _renderLoading() {
    return html`
      <div class="ob-panel">
        <div class="ob-hero">
          <div class="ob-loading"><div class="ob-spinner"></div></div>
        </div>
      </div>`;
  }

  _renderWelcome() {
    const { title, description, ctaText } = this._welcome || {};
    return html`
      <h1 class="ob-hero-title">${title}</h1>
      <p class="ob-hero-desc">${description}</p>
      <button class="ob-cta-btn" @click=${() => this._onStartTour()}>
        ${ctaText || 'Get Started'}
      </button>`;
  }

  _renderStepDots() {
    return html`
      <div class="ob-step-dots">
        ${this._steps.map((_, i) => html`
          <span class="ob-step-dot${i === this._activeStep ? ' active' : ''}"></span>
        `)}
      </div>`;
  }

  _renderStepCard() {
    const step = this._steps[this._activeStep];
    if (!step) return html``;
    const isAlreadyDone = this._completedSteps.has(this._activeStep);
    return html`
      <h2 class="ob-step-title">${step.title}</h2>
      <p class="ob-step-desc">${step.description}</p>
      <button
        class="ob-cta-btn"
        ?disabled=${isAlreadyDone}
        @click=${() => this._onMarkComplete()}
      >
        ${isAlreadyDone ? 'Completed ✓' : 'Next →'}
      </button>`;
  }

  _renderLessonsList() {
    return html`
      ${!this._done ? html`
      <div class="ob-lessons-card">
        <p class="ob-lessons-label">All lessons</p>
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
        </ul>
      </div>` : ''}
      ${this._hasJob ? html`<div class="ob-page-status">
        ${this._pageReady ? html`
          <div class="ob-page-status-row">
            <p class="ob-page-status-title">Your page is ready.</p>
            <a class="ob-page-ready-btn" href=${this._siteUrl} target="_blank">Open your page</a>
          </div>
          <p class="ob-page-status-desc">Your page is live in Experience Workspace.</p>
          <div class="ob-page-progress-track">
            <div class="ob-page-progress-fill ob-page-progress-complete"></div>
          </div>
        ` : html`
          <p class="ob-page-status-title">Your page is on its way.</p>
          <p class="ob-page-status-desc">Follow the lessons while your page loads.</p>
          <div class="ob-page-progress-track">
            <div class="ob-page-progress-fill"></div>
          </div>
        `}
      </div>` : ''}`;
  }

  _renderPageReady() {
    return html`
      <div class="ob-ready-check">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="32" r="30" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
          <path d="M20 32l9 9 15-18" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 class="ob-hero-title">You're ready to edit.</h1>
      <p class="ob-hero-desc">Your page has been imported. Everything you learned is live. Open your page and start editing.</p>
      <a class="ob-cta-btn" href=${this._siteUrl} target="_blank">Open your page</a>`;
  }

  _renderCompletion() {
    return html`
      <div class="ob-ready-check">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="32" r="30" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
          <path d="M20 32l9 9 15-18" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 class="ob-hero-title">You're all done!</h1>
      <p class="ob-hero-desc">
        You've completed all ${this._steps.length} lessons. You're ready to make this site your own.
      </p>
      <button class="ob-cta-btn" @click=${() => this._onStartOver()}>
        Start over
      </button>`;
  }

  render() {
    if (this._loading) return this._renderLoading();

    const showDots = !this._showWelcome && !this._done;
    let heroContent;
    if (this._done && this._pageReady) heroContent = this._renderPageReady();
    else if (this._done) heroContent = this._renderCompletion();
    else if (this._showWelcome) heroContent = this._renderWelcome();
    else heroContent = this._renderStepCard();

    return html`
      <div class="ob-panel">
        <div class="ob-hero">
          ${showDots ? this._renderStepDots() : ''}
          ${heroContent}
        </div>
        <div class="ob-bottom-card">${this._renderLessonsList()}</div>
      </div>`;
  }
}

customElements.define('welcome-app', WelcomeApp);
