import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { ProposalReview } from './api.js';
import { comparisonDocument } from './comparison.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export class ProposalReviewApp extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
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
      const org = sdk.context?.org || sdk.project?.org;
      const site = sdk.context?.site || sdk.context?.repo || sdk.project?.site || sdk.project?.repo;
      this._review = new ProposalReview({ org, site, daFetch: sdk.actions?.daFetch });
      this._base = `https://main--${site}--${org}.aem.live`;
      this._site = `${org}/${site}`;
      this._busy = false;
      await this._refresh();
    } catch (error) {
      this._busy = false;
      this._error = error.message;
      this._message = '';
      this._render();
    }
  }

  disconnectedCallback() {
    this._dialog?.close();
  }

  _button(label, action, { disabled = this._busy, accent = false } = {}) {
    const button = element('button', label, accent ? 'accent' : '');
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }

  async _refresh() {
    if (this._busy) return;
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
      this._busy = false;
      this._render();
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
    }
  }

  async _compare(path) {
    this._busy = true;
    this._error = '';
    this._render();
    const dialog = element('dialog', null, 'proposal-comparison');
    this._dialog = dialog;
    const heading = element('h2', 'View diff');
    heading.id = 'proposal-diff-heading';
    dialog.setAttribute('aria-labelledby', heading.id);
    const close = this._button('Close diff', () => dialog.close(), { disabled: false });
    const status = element('p', 'Loading latest saved content...');
    status.setAttribute('role', 'status');
    const header = element('div', null, 'comparison-header');
    header.append(heading, close);
    dialog.append(header, element('p', path.slice(this._review.root.length)), status);
    const closeDialog = () => {
      dialog.remove();
      this._dialog = null;
      this._busy = false;
      this._render();
      this.querySelector(`article[data-path="${CSS.escape(path)}"] button`)?.focus();
    };
    dialog.addEventListener('close', closeDialog, { once: true });
    this.append(dialog);
    dialog.showModal();
    close.focus();
    try {
      const { current, proposed, original } = await this._review.compare(path);
      const doc = await comparisonDocument({ current, proposed, base: `${this._base}${original.slice(this._review.siteRoot.length)}` });
      if (!dialog.open) return;
      status.textContent = current === proposed ? 'No changes in saved source.' : 'Current content (red) / Proposed changes (green)';
      const frame = element('iframe');
      frame.title = 'Current content and proposed changes';
      frame.setAttribute('sandbox', '');
      frame.srcdoc = doc;
      dialog.append(frame);
      const details = element('details');
      details.append(element('summary', 'Compare full HTML source'));
      const sources = element('div', null, 'source-comparison');
      ['Current content', 'Proposed changes'].forEach((label, index) => {
        const section = element('section');
        section.append(element('h3', label), element('pre', [current, proposed][index]));
        sources.append(section);
      });
      details.append(sources);
      dialog.append(details);
    } catch (error) {
      if (dialog.open) {
        status.setAttribute('role', 'alert');
        status.textContent = error.message;
      }
    }
  }

  _render() {
    this.replaceChildren();
    const header = element('header');
    const title = element('div', null, 'title');
    const count = this._paths.length;
    title.append(element('h1', 'Proposed changes'), element('span', `${count} ${count === 1 ? 'page' : 'pages'} staged`, 'badge'));
    header.append(title, this._button('Refresh', () => this._refresh(), { disabled: this._busy || !this._review || !!this._confirmation }));
    this.append(header);
    if (this._site) this.append(element('p', this._site, 'site'));
    this.append(element('p', 'Staged HTML pages you can access under /.da/ in this site. Other .da content is not included.', 'help'));
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
        this._button('View diff', () => this._compare(path), { disabled: disabled || cleanup }),
        this._button('Discard', () => this._confirm([path], false), { disabled: disabled || cleanup }),
        this._button(cleanup ? 'Retry cleanup' : 'Apply', () => this._confirm([path], true), { disabled }),
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
        this._button('Cancel', () => { this._confirmation = null; this._render(); }),
      );
      this.append(confirmation);
    }
    const footer = element('footer');
    footer.append(element('p', 'Diffs use the latest saved originals, not unsaved editor changes. Apply replaces saved content and removes the draft. It does not preview or publish. Apply all runs one page at a time and stops on an error.', 'help'));
    footer.append(this._button('Apply all changes', () => this._confirm(this._paths, true), {
      disabled: this._busy || !this._paths.length || !!this._confirmation, accent: true,
    }));
    this.append(footer);
  }
}

customElements.define('proposal-review-app', ProposalReviewApp);
