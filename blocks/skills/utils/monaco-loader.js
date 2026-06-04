const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';

let monacoPromise = null;

function loadMonaco() {
  if (monacoPromise) return monacoPromise;

  monacoPromise = new Promise((resolve, reject) => {
    if (window.monaco) { resolve(window.monaco); return; }

    const script = document.createElement('script');
    script.src = `${MONACO_CDN}/vs/loader.js`;
    script.onload = () => {
      window.require.config({ paths: { vs: `${MONACO_CDN}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return monacoPromise;
}

/**
 * Creates a read-only Monaco editor inside the given container element.
 * Returns the editor instance so the caller can dispose it later.
 */
function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export async function createReadOnlyEditor(container, content, language = 'markdown') {
  const monaco = await loadMonaco();

  const theme = prefersDark() ? 'vs-dark' : 'vs';
  const editor = monaco.editor.create(container, {
    value: content,
    language,
    readOnly: true,
    theme,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: { vertical: 'auto', horizontal: 'auto' },
    wordWrap: 'on',
    fontSize: 13,
    fontFamily: "'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: { top: 16, bottom: 16 },
    automaticLayout: true,
    domReadOnly: true,
    contextmenu: false,
  });

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSchemeChange = (e) => monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
  mq?.addEventListener('change', onSchemeChange);

  const origDispose = editor.dispose.bind(editor);
  editor.dispose = () => {
    mq?.removeEventListener('change', onSchemeChange);
    origDispose();
  };

  return editor;
}
