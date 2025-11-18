(async () => {
  const GTM_SCRIPT_SELECTOR = 'script[src*="gtm.js?id=GTM-"]';
  let hasFound = false;
  let observer;
  
  // 1. Timeout if GTM is not found after 5 seconds
  const timeout = setTimeout(() => {
    if (observer) observer.disconnect();
    if (!hasFound) {
      chrome.runtime.sendMessage({ error: "GTM script tag not found (timeout). It might be blocked or loaded very late." });
    }
  }, 5000); // 5-second timeout

  // 2. The main logic to run once the script tag is found
  const processGtmScript = async (gtmScript) => {
    if (hasFound) return; // Already processed
    hasFound = true;
    if (observer) observer.disconnect();
    clearTimeout(timeout);

    try {
      const gtmUrl = gtmScript.src;
      // Add cache-busting just in case
      const response = await fetch(gtmUrl, { cache: 'no-cache' }); 
      if (!response.ok) throw new Error(`Failed to fetch GTM file: ${response.statusText}`);
      
      const scriptText = await response.text();
      const containerId = gtmUrl.split('id=')[1].split('&')[0];

      // Brace-matching parser
      const dataStartMarker = 'var data = ';
      let startIndex = scriptText.indexOf(dataStartMarker);
      if (startIndex === -1) {
        chrome.runtime.sendMessage({ error: "Could not find 'var data = ' in gtm.js." });
        return;
      }
      startIndex += dataStartMarker.length;
      
      let braceCount = 0;
      let inString = false;
      let stringChar = '';
      let isEscaped = false;
      let endIndex = -1;

      for (let i = startIndex; i < scriptText.length; i++) {
        const char = scriptText[i];
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (inString) {
          if (char === '\\') { isEscaped = true; } 
          else if (char === stringChar) { inString = false; }
        } else {
          if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
          } else if (char === '{') { braceCount++; } 
          else if (char === '}') { braceCount--; }
        }
        if (braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }

      if (endIndex === -1 || braceCount !== 0) {
        chrome.runtime.sendMessage({ error: "Could not find the matching closing brace for 'var data = {...}'." });
        return;
      }

      const dataString = scriptText.substring(startIndex, endIndex);

      // Send the raw string to the popup
      chrome.runtime.sendMessage({ success: true, dataString: dataString, containerId: containerId });
    } catch (e) {
      chrome.runtime.sendMessage({ error: e.message });
    }
  };

  // 3. Check if the script tag *already* exists
  const existingScript = document.querySelector(GTM_SCRIPT_SELECTOR);
  if (existingScript) {
    await processGtmScript(existingScript);
    return;
  }

  // 4. If not, set up the MutationObserver to wait for it
  observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          // Check if the added node is a SCRIPT tag and matches our selector
          if (node.tagName === 'SCRIPT' && node.src && node.src.includes('gtm.js?id=GTM-')) {
            processGtmScript(node);
            return; // We found it, no need to observe anymore
          }
        }
      }
    }
  });

  // Start observing the head and body for new child elements
  observer.observe(document.head, { childList: true, subtree: true });
  observer.observe(document.body, { childList: true, subtree: true });

})();