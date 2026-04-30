// packages/extension/src/devtools/devtools.ts
chrome.devtools.panels.create(
  'XState',
  '',
  '../panel/index.html',
  (panel) => {
    void panel
  }
)
