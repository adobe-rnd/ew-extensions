import { resolveNxOrigin } from '../../blocks/skills/utils/codemirror-loader.js';
import { ProposalReview } from './api.js';
import { hasPageProposalSkill } from './skills.js';
import pageProposalsSkill from './page-proposals.js';

const DA_SDK = import(`${resolveNxOrigin()}/nx/utils/sdk.js`).then((module) => module.default);

// Same glyphs as da-nx's A2UI ActionButton renderer.
const ICONS = {
  Layers: 'm2 7 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M2 15l8 4 8-4',
  Delete: 'M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8 8v6m4-6v6',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export class ProposalReviewApp extends HTMLElement {
  connectedCallback() {
    if (this._started) {
      this._subscribeChatTurns();
      this._refresh();
      return;
    }
    this._started = true;
    this._paths = [];
    this._busy = true;
    this._message = 'Connecting to Experience Workspace...';
    this._render();
    this._connect();
  }

  async _connect() {
    try {
      const sdk = await DA_SDK;
      this._sdk = sdk;
      const org = sdk.context?.org || sdk.project?.org;
      const site = sdk.context?.site || sdk.context?.repo || sdk.project?.site || sdk.project?.repo;
      this._review = new ProposalReview({ org, site, daFetch: sdk.actions?.daFetch });
      this._skillsContext = { org, site, daFetch: sdk.actions.daFetch };
      this._site = `${org}/${site}`;
      this._busy = false;
      this._subscribeChatTurns();
      await this._refresh();
    } catch (error) {
      this._busy = false;
      this._error = error.message;
      this._message = '';
      this._render();
    }
  }

  disconnectedCallback() {
    this._unsubscribeChatTurn?.();
    this._unsubscribeChatTurn = null;
    this._refreshPending = false;
    this._skillCheckPending = false;
  }

  _subscribeChatTurns() {
    if (!this.isConnected || this._unsubscribeChatTurn
      || this._sdk?.capabilities?.chatTurnCompleted !== 1
      || typeof this._sdk.actions?.subscribeChatTurnCompleted !== 'function') return;
    this._unsubscribeChatTurn = this._sdk.actions.subscribeChatTurnCompleted(() => this._refresh());
  }

  _button(label, action, { disabled = this._busy, accent = false, icon } = {}) {
    const button = element('button', label, accent ? 'accent' : '');
    button.type = 'button';
    button.disabled = disabled;
    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.entries({
        viewBox: '0 0 20 20',
        width: '18',
        height: '18',
        'aria-hidden': 'true',
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }).forEach(([name, value]) => svg.setAttribute(name, value));
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', ICONS[icon]);
      svg.append(path);
      button.prepend(svg);
    }
    button.addEventListener('click', action);
    return button;
  }

  async _refresh({ preserveStatus = false } = {}) {
    if (!this.isConnected || !this._review) return;
    if (this._busy || this._confirmation) {
      this._refreshPending = true;
      return;
    }
    this._refreshPending = false;
    this._checkSkills();
    const previousError = preserveStatus ? this._error : '';
    const previousMessage = preserveStatus ? this._message : '';
    this._busy = true;
    this._error = '';
    this._message = 'Loading staged pages...';
    this._render();
    try {
      this._paths = await this._review.list();
      this._message = '';
    } catch (error) {
      this._error = error.message;
      this._message = '';
      this._paths = [];
    } finally {
      if (preserveStatus) {
        this._error = [previousError, this._error].filter(Boolean).join(' ');
        this._message = previousMessage;
      }
      this._busy = false;
      this._render();
      if (this._refreshPending) this._refresh({ preserveStatus });
    }
  }

  _confirm(paths, apply) {
    this._confirmation = { paths: [...paths], apply };
    this._render();
    this.querySelector('.confirmation button')?.focus();
  }

  async _mutate() {
    const { paths, apply } = this._confirmation;
    this._confirmation = null;
    this._busy = true;
    this._error = '';
    let completed = 0;
    this._message = apply ? 'Applying changes...' : 'Discarding draft...';
    this._render();
    try {
      for (const path of paths) {
        // eslint-disable-next-line no-await-in-loop
        await this._review.mutate(path, apply);
        this._paths = this._paths.filter((value) => value !== path);
        completed += 1;
      }
      this._message = `${completed} ${completed === 1 ? 'page' : 'pages'} ${apply ? 'applied' : 'discarded'}.`;
    } catch (error) {
      this._error = error.message;
      this._message = `${completed} of ${paths.length} pages completed. Remaining drafts retained.`;
    } finally {
      this._busy = false;
      this._render();
      if (this._refreshPending) this._refresh({ preserveStatus: true });
    }
  }

  _compare(path) {
    this._error = '';
    try {
      const baseline = this._review.original(path);
      if (typeof this._sdk.actions?.openComparison !== 'function') {
        throw new Error('Host comparison is unavailable. Use an Experience Workspace host and SDK that support source-path comparisons.');
      }
      this._sdk.actions.openComparison({ candidate: path, baseline });
    } catch (error) {
      this._error = error.message === 'invalid-comparison'
        ? 'This SDK does not support source-path comparisons. Use ?nx=<branch> to load a matching SDK and open the extension in an updated Experience Workspace host.'
        : error.message;
    }
    this._render();
  }

  async _checkSkills() {
    if (!this.isConnected || !this._skillsContext) return;
    if (this._checkingSkills) {
      this._skillCheckPending = true;
      return;
    }
    this._checkingSkills = true;
    this._skillError = '';
    this._render();
    try {
      this._skillState = await hasPageProposalSkill(this._skillsContext) ? 'installed' : 'missing';
    } catch (error) {
      this._skillState = 'error';
      this._skillError = error.message;
    } finally {
      this._checkingSkills = false;
      if (this.isConnected) this._render();
      if (this._skillCheckPending) {
        this._skillCheckPending = false;
        this._checkSkills();
      }
    }
  }

  _addSkill() {
    if (this._skillState !== 'missing' || this._checkingSkills) return;
    try {
      if (typeof this._sdk.actions?.setPrompt !== 'function') {
        throw new Error('This host cannot send a message to chat. Update the Experience Workspace SDK.');
      }
      this._sdk.actions.setPrompt(`add this personal skill\n\n${pageProposalsSkill}`, { autoSend: true });
      this._skillState = 'requested';
      this._skillError = '';
    } catch (error) {
      this._skillError = error.message;
    }
    this._render();
  }

  _renderSkills() {
    if (!this._skillsContext || this._skillState === 'installed') return;
    const notice = element('section', null, 'skill-notice');
    notice.setAttribute('aria-label', 'Page proposals skill');
    let message = 'Checking Coworker skills...';
    if (this._skillState === 'missing') {
      message = 'Add the page-proposals personal skill so Coworker stages page edits for review.';
    } else if (this._skillState === 'requested') {
      message = 'Request sent to chat. We will check the skill again when the turn ends.';
    } else if (this._skillState === 'error') {
      message = 'Could not check configured Coworker skills. You can still review staged pages.';
    }
    notice.append(element('p', message));
    if (this._skillError) notice.append(element('p', this._skillError, 'error'));
    if (this._skillState === 'missing') {
      notice.append(this._button('Add personal skill', () => this._addSkill(), {
        disabled: this._busy || !!this._confirmation || this._checkingSkills, accent: true,
      }));
    } else if (['error', 'requested'].includes(this._skillState)) {
      notice.append(this._button('Check skills', () => this._checkSkills(), {
        disabled: this._checkingSkills,
      }));
    }
    this.append(notice);
  }

  _render() {
    this.replaceChildren();
    const header = element('header');
    const title = element('div', null, 'title');
    const count = this._paths.length;
    title.append(element('h1', 'Proposed changes'), element('span', `${count} ${count === 1 ? 'page' : 'pages'} staged`, 'badge'));
    header.append(title, this._button('Refresh', () => this._refresh(), { disabled: this._busy || !this._review || !!this._confirmation }));
    this.append(header);
    this._renderSkills();
    const status = element('p', this._message);
    status.setAttribute('role', 'status');
    this.append(status);
    if (this._error) {
      const error = element('p', this._error, 'error');
      error.setAttribute('role', 'alert');
      this.append(error);
    }
    if (!this._busy && !this._error && !this._paths.length) this.append(element('p', 'No staged pages to review.', 'empty'));
    this._paths.forEach((path) => {
      const cleanup = this._review.saved.has(path);
      const article = element('article');
      article.dataset.path = path;
      article.append(element('h2', path.split('/').pop().slice(0, -5)));
      article.append(element('p', path.slice(this._review.root.length), 'path'));
      if (cleanup) article.append(element('p', 'Original saved. Draft cleanup pending.', 'help'));
      const actions = element('div', null, 'actions');
      const disabled = this._busy || !!this._confirmation;
      actions.append(
        this._button('View diff', () => this._compare(path), { disabled: disabled || cleanup, icon: 'Layers' }),
        this._button('Discard', () => this._confirm([path], false), { disabled: disabled || cleanup, icon: 'Delete' }),
        this._button(cleanup ? 'Retry cleanup' : 'Apply this change', () => this._confirm([path], true), {
          disabled, accent: true,
        }),
      );
      article.append(actions);
      this.append(article);
    });
    if (this._confirmation) {
      const { paths, apply } = this._confirmation;
      const confirmation = element('section', null, 'confirmation');
      confirmation.setAttribute('aria-label', 'Confirm changes');
      confirmation.append(element('p', apply
        ? `Apply ${paths.length} ${paths.length === 1 ? 'page' : 'pages'}? This replaces saved originals and deletes their drafts. Nothing is published.`
        : 'Discard this draft? Only the staged file will be deleted; the saved original is unchanged.'));
      if (paths.length === 1) confirmation.append(element('p', paths[0].slice(this._review.root.length), 'path'));
      confirmation.append(
        this._button(apply ? 'Confirm apply' : 'Confirm discard', () => this._mutate(), { accent: true }),
        this._button('Cancel', () => {
          this._confirmation = null;
          this._render();
          if (this._refreshPending) this._refresh();
        }),
      );
      this.append(confirmation);
    }
    const footer = element('footer');
    footer.append(element('p', 'Proposals are staged under /.da/proposals/. Discard deletes a draft. Apply replaces saved originals and removes drafts, without previewing or publishing. Diffs exclude unsaved editor changes. Apply all runs sequentially and stops on an error.', 'help'));
    footer.append(this._button('Apply all changes', () => this._confirm(this._paths, true), {
      disabled: this._busy || !this._paths.length || !!this._confirmation, accent: true,
    }));
    if (this._site) footer.append(element('p', this._site, 'site'));
    this.append(footer);
  }
}

customElements.define('proposal-review-app', ProposalReviewApp);
