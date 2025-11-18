// This script creates the panel in DevTools
chrome.devtools.panels.create(
  "GTM Auditor",  // Title of the panel
  "icon.png",     // Icon (must be in your extension)
  "panel.html",   // The HTML page to load into the panel
  (panel) => {
    // You can add logic here when the panel is created, if needed
  }
);