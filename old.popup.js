let fullGtmData = null;
let currentContainerId = '';
let sandboxFrame;

// --- Parsing logic is REMOVED from this file ---
// ... (parseGtmData function is deleted) ...

// --- UI Logic (mostly unchanged) ---
function createItem(item) {
  // ... (no changes from previous version) ...
  const div = document.createElement('div');
  div.className = 'item';
  const name = document.createElement('div');
  name.className = 'item-name';
  name.innerText = item.name;
  div.appendChild(name);
  if (item.details || item.conditions || item.triggers) {
    const details = document.createElement('div');
    details.className = 'item-details';
    const ul = document.createElement('ul');
    if (item.details) {
      item.details.forEach(d => {
        const li = document.createElement('li');
        li.innerText = d;
        ul.appendChild(li);
      });
    }
    if (item.triggers && item.triggers.length > 0) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>Fired By:</strong> ${item.triggers.join(', ')}`;
      ul.appendChild(li);
    }
    if (item.conditions && item.conditions.length > 0) {
      item.conditions.forEach(c => {
        const li = document.createElement('li');
        li.innerText = c;
        ul.appendChild(li);
      });
    }
    details.appendChild(ul);
    div.appendChild(details);
  }
  return div;
}

function displayData(data, containerId) {
  fullGtmData = data;
  document.getElementById('loading').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  document.getElementById('container-id').innerText = containerId;
  
  const tagsList = document.getElementById('tags-list');
  tagsList.innerHTML = ''; // Clear previous results
  document.getElementById('tags-count').innerText = data.tags.length;
  data.tags.forEach(tag => tagsList.appendChild(createItem(tag)));

  const triggersList = document.getElementById('triggers-list');
  triggersList.innerHTML = ''; // Clear previous results
  document.getElementById('triggers-count').innerText = data.triggers.length;
  data.triggers.forEach(trigger => triggersList.appendChild(createItem(trigger)));

  const variablesList = document.getElementById('variables-list');
  variablesList.innerHTML = ''; // Clear previous results
  document.getElementById('variables-count').innerText = data.variables.length;
  data.variables.forEach(variable => variablesList.appendChild(createItem(variable)));
}

function showError(errorMsg) {
  document.getElementById('loading').style.display = 'none';
  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'block';
  errorDiv.innerText = `Error: ${errorMsg}`;
}

// --- Message handling is NEW ---

// 1. Listen for message from content.js (sent via chrome.runtime.sendMessage)
chrome.runtime.onMessage.addListener((message) => {
  if (message.error) {
    showError(message.error);
  } else if (message.success) {
    // Save container ID
    currentContainerId = message.containerId;
    // Send the raw string to the sandbox iframe
    if (sandboxFrame) {
      sandboxFrame.contentWindow.postMessage({ dataString: message.dataString }, '*');
    } else {
      showError("Sandbox is not ready.");
    }
  }
});

// 2. Listen for message from sandbox.js (sent via window.postMessage)
window.addEventListener('message', (event) => {
  // Check it's from our sandbox
  if (event.source !== sandboxFrame.contentWindow) {
    return;
  }

  if (event.data.error) {
    showError(event.data.error);
  } else if (event.data.success) {
    // We got the parsed object! Now we can parse *that*
    // (This is the "human-readable" parsing, not the "unsafe" parsing)
    try {
        const readableData = parseGtmObject(event.data.parsedData);
        displayData(readableData, currentContainerId);
    } catch (e) {
        showError(`Failed to build UI: ${e.message}`);
    }
  }
});


// 3. Run when the popup is opened
document.addEventListener('DOMContentLoaded', () => {
  sandboxFrame = document.getElementById('sandbox-iframe');

  // Inject the content script into the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].id) {
      showError("Cannot access current tab.");
      return;
    }
    if (tabs[0].url.startsWith('chrome://') || tabs[0].url.startsWith('https://chrome.google.com')) {
       showError("Cannot run on this special page (e.g., Chrome Web Store or settings).");
       return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content.js']
    }).catch(err => {
      showError(`Failed to inject script: ${err.message}`);
    });
  });

  // 4. Set up the export button
  document.getElementById('exportButton').addEventListener('click', () => {
    // ... (no changes from previous version) ...
    if (!fullGtmData) return;
    const containerId = document.getElementById('container-id').innerText || 'gtm-export';
    const jsonString = JSON.stringify(fullGtmData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${containerId}-parsed.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
});


/**
 * This new function does the "safe" parsing.
 * It takes the *object* from the sandbox and makes it human-readable.
 */
function parseGtmObject(gtmData) {
  const resource = gtmData.resource;
  if (!resource) throw new Error("Parsed data does not contain a 'resource' object.");

  const macros = resource.macros || [];
  const predicates = resource.predicates || [];
  const rules = resource.rules || [];
  const tags = resource.tags || [];

  // 1. Parse Macros (Variables)
  const parsedMacros = macros.map((macro, i) => {
    let name = `Unknown Variable (Index ${i})`;
    try {
      switch (macro.function) {
        case "__v": name = `Data Layer Variable: ${macro.vtp_name}`; break;
        case "__u": name = `URL Variable: ${macro.vtp_component || 'Full URL'}`; break;
        case "__e": name = "Built-in: Event Name"; break;
        case "__gas": name = `Google Analytics Settings: ${macro.vtp_trackingId}`; break;
        case "__f": name = `Built-in: Referrer`; break;
        case "__aev": name = `Auto-Event Variable: ${macro.vtp_varType}`; break;
        case "__jsm": name = "Custom JavaScript Variable"; break;
        case "__j": name = `JavaScript Variable: ${macro.vtp_name}`; break;
        case "__d": name = `DOM Element: ${macro.vtp_elementSelector}`; break;
        case "__k": name = `1st Party Cookie: ${macro.vtp_name}`; break;
        case "__c": name = `Constant: "${macro.vtp_value}"`; break;
        case "__r": name = "Random Number"; break;
        case "__smm": name = "Value Map (Lookup Table)"; break;
        case "__hid": name = "HTML ID"; break;
        default:
          if (macro.function.startsWith("__cvt_")) {
            name = "Custom Template Variable";
          } else {
            name = `Custom Variable: ${macro.function}`;
          }
      }
    } catch (e) { name = `Error parsing variable ${i}`; }
    return name;
  });

  // Helper
  const parseArg = (arg) => {
    if (Array.isArray(arg) && arg[0] === "macro") {
      return `[${parsedMacros[arg[1]] || `Macro ${arg[1]}`}]`;
    }
    return `"${arg}"`;
  };

  // 2. Parse Predicates (Conditions)
  const parsedPredicates = predicates.map((pred, i) => {
    try {
      const op = pred.function.replace(/^_/, '');
      const arg0 = parseArg(pred.arg0);
      const arg1 = parseArg(pred.arg1);
      return `${arg0} ${op} ${arg1}`;
    } catch (e) { return `Error parsing predicate ${i}`; }
  });

  // 3. Parse Rules (Triggers)
  const parsedRules = rules.map((rule, i) => {
    try {
      const conditions = rule[0]
        .filter(item => item !== "if")
        .map(index => parsedPredicates[index] || `Predicate ${index}`);
      
      const tagsToAdd = rule[1]
        .filter(item => item !== "add")
        .map(index => index);
      
      return {
        name: `Trigger ${i}`,
        conditions: conditions,
        tagsToFire: tagsToAdd
      };
    } catch (e) {
      return { name: `Error parsing rule ${i}`, conditions: [], tagsToFire: [] };
    }
  });

  // 4. Parse Tags
  const parsedTags = tags.map((tag, i) => {
    let name = `Unknown Tag (Index ${i})`;
    let details = [];
    try {
      switch (tag.function) {
        case "__html": name = "Custom HTML"; break;
        case "__gaawe":
          name = "GA4 Event Tag";
          details.push(`Event Name: ${tag.vtp_eventName}`);
          details.push(`Measurement ID: ${tag.vtp_measurementIdOverride}`);
          break;
        case "__ua":
          name = "Universal Analytics Tag";
          details.push(`Track Type: ${tag.vtp_trackType}`);
          if (tag.vtp_gaSettings) {
              details.push(`GA Settings: [${parsedMacros[tag.vtp_gaSettings[1]]}]`);
          }
          break;
        case "__googtag":
          name = "GA4 Configuration Tag";
          details.push(`Measurement ID: ${tag.vtp_tagId}`);
          break;
        case "__awct":
          name = "AdWords Conversion";
          details.push(`Conversion ID: ${tag.vtp_conversionId}`);
          details.push(`Conversion Label: ${tag.vtp_conversionLabel}`);
          break;
        case "__asp":
          name = "AdRoll Smart Pixel";
          details.push(`Pixel ID: ${tag.vtp_pixelId}`);
          break;
        case "__paused":
          name = `Paused Tag (Original: ${tag.vtp_originalTagType})`;
          details.push("This tag is paused and will not fire.");
          break;
        case "__fsl": name = "Form Submit Listener"; break;
        case "__cl": name = "Click Listener"; break;
        case "__lcl": name = "Link Click Listener"; break;
        case "__evl": name = "Element Visibility Listener"; break;
        case "__ytl": name = "YouTube Video Listener"; break;
        case "__tg": name = "Trigger Group"; break;
        default:
          if (tag.function.startsWith("__cvt_")) {
            name = "Custom Template Tag";
            if (tag.vtp_eventName) details.push(`Event Name: ${tag.vtp_eventName}`);
          } else {
            name = `Custom Tag: ${tag.function}`;
          }
      }
    } catch (e) { name = `Error parsing tag ${i}`; }

    const firingTriggers = parsedRules
      .filter(rule => rule.tagsToFire.includes(i))
      .map(rule => rule.name);

    return { name, details, triggers: firingTriggers };
  });

  // 5. Final payload
  return {
    tags: parsedTags,
    triggers: parsedRules.map(rule => ({
      name: rule.name,
      conditions: rule.conditions
    })),
    variables: parsedMacros.map(name => ({ name: name }))
  };
}