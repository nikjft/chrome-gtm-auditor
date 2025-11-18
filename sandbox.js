// This script runs inside sandbox.html

window.addEventListener('message', (event) => {
  // We don't need to check origin, as this is an internal extension page
  const dataString = event.data.dataString;
  
  if (dataString) {
    try {
      // This is allowed ONLY inside the sandbox
      const parsedData = new Function('return ' + dataString)();
      
      // Send the clean, parsed object back to the popup
      window.parent.postMessage({ success: true, parsedData: parsedData }, '*');
      
    } catch (e) {
      window.parent.postMessage({ error: `Failed to evaluate the extracted data object. \nError: ${e.message}` }, '*');
    }
  }
});