import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { loadProgress, saveProgress, clearProgress, getNextActiveStep, isComplete } from './utils.js';

const STEPS = [
  {
    title: 'Welcome to your demo site',
    description: 'This is a live demo site. Every section is real and editable, and nothing here touches production. Take a look around, then make it yours.',
  },
  {
    title: 'Edit on the canvas',
    description: 'Click any text or image to start editing directly on the page. Changes are saved automatically — no publish needed while you explore.',
  },
  {
    title: 'Add a section',
    description: 'Use the + button between sections to insert a new block. Choose from layouts, media, and more to build out your page.',
  },
  {
    title: 'Ask the AI Assistant',
    description: 'Open the AI panel and ask it to write, rewrite, or summarize any section. Try: "Make this headline more compelling."',
  },
  {
    title: 'Run a skill',
    description: 'Skills are reusable AI actions — things like translating a page, generating metadata, or checking for broken links. Open the Skills panel to browse what\'s available.',
  },
  {
    title: 'Preview & publish',
    description: 'When you\'re happy with your changes, hit Preview to see them live, then Publish to make them public. Your audience sees only published content.',
  },
];

class OnboardingApp extends LitElement {
  static properties = {
    _activeStep: { state: true },
    _completedSteps: { state: true },
    _done: { state: true },
  };

  constructor() {
    super();
    this._activeStep = 0;
    this._completedSteps = new Set();
    this._done = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    try {
      await DA_SDK;
    } catch {
      // SDK unavailable in standalone/dev
    }
    const saved = loadProgress(window.location.href);
    if (saved) {
      this._completedSteps = saved.completedSteps;
      this._activeStep = saved.activeStep;
      this._done = isComplete(this._completedSteps, STEPS.length);
    }
  }

  _onMarkComplete() {
    const next = new Set(this._completedSteps);
    next.add(this._activeStep);
    if (isComplete(next, STEPS.length)) {
      this._completedSteps = next;
      this._done = true;
      saveProgress(window.location.href, next, this._activeStep);
      return;
    }
    const nextStep = getNextActiveStep(next, this._activeStep, STEPS.length);
    this._completedSteps = next;
    this._activeStep = nextStep;
    saveProgress(window.location.href, next, nextStep);
  }

  _onNavigateToStep(index) {
    this._activeStep = index;
  }

  _onStartOver() {
    clearProgress(window.location.href);
    this._completedSteps = new Set();
    this._activeStep = 0;
    this._done = false;
  }

  _renderStepCard() {
    const step = STEPS[this._activeStep];
    const isAlreadyDone = this._completedSteps.has(this._activeStep);
    return html`
      <div class="ob-step-card">
        <p class="ob-step-label">Step ${this._activeStep + 1} / ${STEPS.length}</p>
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
        ${STEPS.map((step, i) => {
          const completed = this._completedSteps.has(i);
          const active = this._activeStep === i;
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
          You've completed all ${STEPS.length} lessons. You're ready to make this site your own.
        </p>
        <sl-button class="ob-quiet-link" @click=${() => this._onStartOver()}>
          Start over
        </sl-button>
      </div>`;
  }

  render() {
    const fillPct = (this._completedSteps.size / STEPS.length) * 100;
    return html`
      <span class="ob-eyebrow">Guided Onboarding</span>
      <h1 class="ob-title">Make this site yours</h1>
      <p class="ob-subtitle">Follow these lessons to get started — everything here is a safe sandbox.</p>

      <div class="ob-progress">
        <div class="ob-progress-label">
          <span>Your Progress</span>
          <span>${this._completedSteps.size} of ${STEPS.length}</span>
        </div>
        <div class="ob-progress-track">
          <div class="ob-progress-fill" style="width: ${fillPct}%"></div>
        </div>
      </div>

      ${this._done ? this._renderCompletion() : html`
        ${this._renderStepCard()}
        ${this._renderLessonsList()}
      `}
    `;
  }
}

customElements.define('onboarding-app', OnboardingApp);
