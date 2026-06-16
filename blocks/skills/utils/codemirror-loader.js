const CM_PATH = '/nx/deps/codemirror/dist/index.js';
const SAFE_NX_PARAM = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function resolveNxOrigin(search = window.location.search) {
  const nxParam = new URLSearchParams(search).get('nx');
  if (!nxParam) return 'https://da.live';
  if (nxParam === 'local') return 'http://localhost:6456';
  if (!SAFE_NX_PARAM.test(nxParam)) return 'https://da.live';
  return `https://${nxParam}--da-nx--adobe.aem.live`;
}

let cmPromise = null;

function loadCM() {
  if (cmPromise) return cmPromise;
  cmPromise = import(`${resolveNxOrigin()}${CM_PATH}`).catch((err) => {
    cmPromise = null;
    throw err;
  });
  return cmPromise;
}

function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/**
 * Creates a read-only CodeMirror markdown viewer inside `container`.
 * Picks github-light or github-dark based on the system color scheme.
 * Returns the EditorView instance so the caller can destroy it later.
 */
export async function createReadOnlyViewer(container, content) {
  const { EditorView, basicSetup, markdown, githubLight, githubDark } = await loadCM();
  const theme = prefersDark() ? githubDark : githubLight;
  return new EditorView({
    doc: content,
    extensions: [
      basicSetup,
      markdown(),
      theme,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
    parent: container,
  });
}

/**
 * Creates an editable CodeMirror markdown editor inside `container`.
 * Calls `onChange(text)` on every document change so the host can sync state.
 * Returns the EditorView instance.
 */
export async function createEditor(container, content, onChange) {
  const { EditorView, basicSetup, markdown, githubLight, githubDark } = await loadCM();
  const theme = prefersDark() ? githubDark : githubLight;
  const extensions = [
    basicSetup,
    markdown(),
    theme,
    EditorView.lineWrapping,
  ];
  if (onChange) {
    extensions.push(EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }));
  }
  return new EditorView({ doc: content, extensions, parent: container });
}

export function replaceDoc(view, text) {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === text) return;
  view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
}

export function destroyEditor(view) {
  view?.destroy();
}
