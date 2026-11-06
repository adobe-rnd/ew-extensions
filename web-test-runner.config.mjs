import { importMapsPlugin } from '@web/dev-server-import-maps';
import { puppeteerLauncher } from '@web/test-runner-puppeteer';
import { defaultReporter, summaryReporter } from '@web/test-runner';

const GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

export default {
  coverageConfig: {
    include: ['**/apps/**'],
    exclude: ['**/node_modules/**', '**/test/**'],
  },
  testFramework: { config: { retries: GITHUB_ACTIONS ? 1 : 0 } },
  browsers: [
    puppeteerLauncher({
      launchOptions: {
        args: GITHUB_ACTIONS
          ? ['--no-sandbox', '--disable-setuid-sandbox']
          : [],
      },
    }),
  ],
  plugins: [importMapsPlugin({})],
  reporters: [
    defaultReporter({ reportTestResults: true, reportTestProgress: true }),
    summaryReporter(),
  ],
  testRunnerHtml: (testFramework) => `
    <html>
      <head>
        <script type="importmap">
          {
            "imports": {
              "da-lit": "/test/mocks/lit-stub.js"
            },
            "scopes": {
              "/tools/block-editor/": {
                "https://da.live/nx/utils/sdk.js": "/test/unit/block-editor/fixtures/utils/sdk.js",
                "https://da.live/nx2/scripts/nx.js": "/test/unit/block-editor/fixtures/scripts/nx.js",
                "https://da.live/nx2/blocks/shared/picker/picker.js": "/test/unit/block-editor/fixtures/blocks/shared/picker/picker.js"
              }
            }
          }
        </script>
        <script type='module'>
          const oldFetch = window.fetch;
          window.fetch = async (resource, options) => {
            if (!resource.startsWith('/') && !resource.startsWith('http://localhost')) {
              console.error('** external fetch disallowed in unit tests:', resource);
            }
            return oldFetch.call(window, resource, options);
          };
        </script>
      </head>
      <body>
        <script type='module' src='${testFramework}'></script>
      </body>
    </html>`,
};
