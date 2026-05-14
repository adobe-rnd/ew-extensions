export class LitElement extends HTMLElement {
  static properties = {};

  connectedCallback() {}

  disconnectedCallback() {}

  requestUpdate() {}

  addController() {}
}

export function html(strings, ...values) {
  return { strings, values };
}

export function css(strings, ...values) {
  return { strings, values };
}

export function nothing() {
  return '';
}
