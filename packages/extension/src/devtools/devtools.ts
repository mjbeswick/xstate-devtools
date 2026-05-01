// packages/extension/src/devtools/devtools.ts
chrome.devtools.panels.create(
  'XState',
  '',
  'src/panel/index.html',
  (panel) => {
    void panel
  }
)
