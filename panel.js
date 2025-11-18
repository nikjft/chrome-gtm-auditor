let fullGtmData = null;
let currentContainerId = '';
let sandboxFrame;
// Store detected containers: { "GTM-XXXX": "https://..." }
let detectedContainers = {}; 

// --- Parsing Helpers (Same as before) ---
function findMacroIndices(obj, indices = new Set()) {
  if (Array.isArray(obj)) {
    if (obj[0] === 'macro' && typeof obj[1] === 'number') indices.add(obj[1]);
    else obj.forEach(item => findMacroIndices(item, indices));
  } else if (typeof obj === 'object' && obj !== null) {
    Object.values(obj).forEach(value => findMacroIndices(value, indices));
  }
  return indices;
}

function getTagName(tag) {
  switch (tag.function) {
    case "__html": return "Custom HTML";
    case "__gaawe": return "GA4 Event Tag";
    case "__ua": return "Universal Analytics Tag";
    case "__googtag": return "GA4 Configuration Tag";
    case "__awct": return "AdWords Conversion";
    case "__asp": return "AdRoll Smart Pixel";
    case "__fsl": return "Form Submit Listener";
    case "__cl": return "Click Listener";
    case "__lcl": return "Link Click Listener";
    case "__evl": return "Element Visibility Listener";
    case "__ytl": return "YouTube Video Listener";
    case "__tg": return "Trigger Group";
    default:
      if (tag.function.startsWith("__cvt_")) return "Custom Template Tag";
      return `Custom Tag: ${tag.function}`;
  }
}

function parseGtmObject(gtmData) {
  const resource = gtmData.resource;
  if (!resource) throw new Error("Parsed data does not contain a 'resource' object.");

  const macros = resource.macros || [];
  const predicates = resource.predicates || [];
  const rules = resource.rules || [];
  const tags = resource.tags || [];

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
          if (macro.function.startsWith("__cvt_")) name = "Custom Template Variable";
          else name = `Custom Variable: ${macro.function}`;
      }
    } catch (e) { name = `Error parsing variable ${i}`; }
    return { name: name, raw: macro };
  });

  const parseArg = (arg) => {
    if (Array.isArray(arg) && arg[0] === "macro") {
      const macro = parsedMacros[arg[1]];
      return `[${(macro && macro.name) || `Macro ${arg[1]}`}]`;
    }
    return `"${arg}"`;
  };

  const parsedPredicates = predicates.map((pred, i) => {
    try {
      const op = pred.function.replace(/^_/, '');
      const arg0 = parseArg(pred.arg0);
      const arg1 = parseArg(pred.arg1);
      return `${arg0} ${op} ${arg1}`;
    } catch (e) { return `Error parsing predicate ${i}`; }
  });

  const parsedRules = rules.map((rule, i) => {
    try {
      const conditionIndices = rule[0].filter(item => item !== "if");
      const conditions = conditionIndices.map(index => parsedPredicates[index] || `Predicate ${index}`);
      const tagsToAdd = rule[1].filter(item => item !== "add");
      const rawPredicates = conditionIndices.map(index => predicates[index] || { error: `Predicate ${index} not found` });
      return {
        name: `Trigger ${i}`,
        conditions: conditions,
        tagsToFire: tagsToAdd,
        raw: { "trigger-conditions": rawPredicates, "tags-to-fire": tagsToAdd }
      };
    } catch (e) {
      return { name: `Error parsing rule ${i}`, conditions: [], tagsToFire: [], raw: rule };
    }
  });

  const parsedTags = tags.map((tag, i) => {
    let name;
    let details = [];

    if (tag.function === "__paused") {
      const originalType = tag.vtp_originalTagType || "unknown";
      const originalName = getTagName({ function: `__${originalType}` });
      name = `${originalName} (Paused)`;
      details.push("This tag is paused and will not fire.");
    } else {
      name = getTagName(tag);
      try {
        switch (tag.function) {
          case "__gaawe":
            details.push(`Event Name: ${tag.vtp_eventName}`);
            details.push(`Measurement ID: ${tag.vtp_measurementIdOverride}`);
            break;
          case "__ua":
            details.push(`Track Type: ${tag.vtp_trackType}`);
            if (tag.vtp_gaSettings && parsedMacros[tag.vtp_gaSettings[1]]) {
                details.push(`GA Settings: [${parsedMacros[tag.vtp_gaSettings[1]].name}]`);
            }
            break;
          case "__googtag":
            details.push(`Measurement ID: ${tag.vtp_tagId}`);
            break;
          case "__awct":
            details.push(`Conversion ID: ${tag.vtp_conversionId}`);
            details.push(`Conversion Label: ${tag.vtp_conversionLabel}`);
            break;
          case "__asp":
            details.push(`Pixel ID: ${tag.vtp_pixelId}`);
            break;
          default:
            if (tag.function.startsWith("__cvt_") && tag.vtp_eventName) {
              details.push(`Event Name: ${tag.vtp_eventName}`);
            }
        }
      } catch (e) { }
    }

    const firingTriggers = parsedRules.filter(rule => rule.tagsToFire.includes(i));
    const usedVariableIndices = findMacroIndices(tag);
    const usedVariables = [...usedVariableIndices].map(index => parsedMacros[index]).filter(Boolean);

    return { 
      name, details, triggers: firingTriggers, variables: usedVariables, raw: tag
    };
  });

  return {
    tags: parsedTags,
    triggers: parsedRules.map(rule => ({
      name: rule.name, conditions: rule.conditions, raw: rule.raw
    })),
    variables: parsedMacros.map(item => ({ name: item.name, raw: item.raw }))
  };
}

// --- UI Helper ---
function createItem(item) {
  const div = document.createElement('div');
  div.className = 'item';
  
  const name = document.createElement('div');
  name.className = 'item-name';
  name.innerText = item.name;
  name.dataset.json = JSON.stringify(item.raw);
  div.appendChild(name);

  if (item.details && item.details.length > 0) {
    const details = document.createElement('div');
    details.className = 'item-details';
    const ul = document.createElement('ul');
    item.details.forEach(d => { const li = document.createElement('li'); li.innerText = d; ul.appendChild(li); });
    details.appendChild(ul);
    div.appendChild(details);
  }

  if (item.conditions && item.conditions.length > 0) {
    const details = document.createElement('div');
    details.className = 'item-details';
    const ul = document.createElement('ul');
    item.conditions.forEach(c => { const li = document.createElement('li'); li.innerText = c; ul.appendChild(li); });
    details.appendChild(ul);
    div.appendChild(details);
  }
  
  if ((item.triggers && item.triggers.length > 0) || (item.variables && item.variables.length > 0)) {
    const nestedDetails = document.createElement('details');
    nestedDetails.className = 'nested-details';
    const summary = document.createElement('summary');
    summary.innerText = `Associations (${item.triggers.length} Triggers, ${item.variables.length} Variables)`;
    nestedDetails.appendChild(summary);
    const listDiv = document.createElement('div');
    listDiv.className = 'nested-details-list';

    if (item.triggers.length > 0) {
      listDiv.innerHTML += '<h4>Firing Triggers</h4>';
      item.triggers.forEach(t => listDiv.appendChild(createItem(t)));
    }
    if (item.variables.length > 0) {
      listDiv.innerHTML += '<h4>Used Variables</h4>';
      item.variables.sort((a, b) => a.name.localeCompare(b.name));
      item.variables.forEach(v => listDiv.appendChild(createItem(v)));
    }
    nestedDetails.appendChild(listDiv);
    div.appendChild(nestedDetails);
  }
  return div;
}

// --- Main Display Function ---
function displayData(data, containerId) {
  fullGtmData = data;
  setStatus('');
  document.getElementById('results').style.display = 'block';
  document.getElementById('container-id-display').innerText = containerId;
  
  const tagsList = document.getElementById('tags-list');
  tagsList.innerHTML = '';
  document.getElementById('tags-count').innerText = data.tags.length;
  data.tags.sort((a, b) => a.name.localeCompare(b.name));
  data.tags.forEach(tag => tagsList.appendChild(createItem(tag)));

  const triggersList = document.getElementById('triggers-list');
  triggersList.innerHTML = '';
  document.getElementById('triggers-count').innerText = data.triggers.length;
  data.triggers.forEach(trigger => triggersList.appendChild(createItem(trigger)));

  const variablesList = document.getElementById('variables-list');
  variablesList.innerHTML = '';
  document.getElementById('variables-count').innerText = data.variables.length;
  data.variables.sort((a, b) => a.name.localeCompare(b.name));
  data.variables.forEach(variable => variablesList.appendChild(createItem(variable)));
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status-message');
  el.innerText = msg;
  el.className = isError ? 'error-text' : '';
}

// --- Sandbox Listener ---
window.addEventListener('message', (event) => {
  if (event.source !== sandboxFrame.contentWindow) return;
  if (event.data.error) {
    setStatus(`Error parsing: ${event.data.error}`, true);
  } else if (event.data.success) {
    try {
        const readableData = parseGtmObject(event.data.parsedData);
        displayData(readableData, currentContainerId);
    } catch (e) {
        setStatus(`Failed to build UI: ${e.message}`, true);
    }
  }
});

function processGtmScriptContent(scriptText, containerId) {
  currentContainerId = containerId;
  setStatus(`Parsing ${containerId}...`);

  const dataStartMarker = 'var data = ';
  let startIndex = scriptText.indexOf(dataStartMarker);
  if (startIndex === -1) {
    setStatus(`'var data' not found in ${containerId}. Is this a GTM file?`, true);
    return;
  }
  startIndex += dataStartMarker.length;

  let braceCount = 0, inString = false, stringChar = '', isEscaped = false, endIndex = -1;
  for (let i = startIndex; i < scriptText.length; i++) {
    const char = scriptText[i];
    if (isEscaped) { isEscaped = false; continue; }
    if (inString) {
      if (char === '\\') { isEscaped = true; } 
      else if (char === stringChar) { inString = false; }
    } else {
      if (char === '"' || char === "'") { inString = true; stringChar = char; } 
      else if (char === '{') { braceCount++; } 
      else if (char === '}') { braceCount--; }
    }
    if (braceCount === 0) {
      endIndex = i + 1;
      break;
    }
  }

  if (endIndex === -1 || braceCount !== 0) {
    setStatus(`Could not parse structure of ${containerId}.`, true);
    return;
  }

  const dataString = scriptText.substring(startIndex, endIndex);
  sandboxFrame.contentWindow.postMessage({ dataString: dataString }, '*');
}

// --- Discovery Logic ---

function resetUI() {
  fullGtmData = null;
  detectedContainers = {};
  
  const select = document.getElementById('container-select');
  select.innerHTML = '<option value="" disabled selected>Scanning page...</option><option value="other">Other (Manual URL)...</option>';
  select.disabled = true;

  document.getElementById('manual-input-row').style.display = 'none';
  document.getElementById('custom-url-input').value = '';
  document.getElementById('results').style.display = 'none';
  setStatus('Waiting for containers...');
}

// 1. Scan DOM and JS objects for Containers
function scanForContainers() {
  // We use 'eval' to access the inspected window's 'google_tag_manager' object
  chrome.devtools.inspectedWindow.eval(
    `
    (function() {
      var results = [];
      // 1. Check google_tag_manager object
      if (window.google_tag_manager) {
        Object.keys(window.google_tag_manager).forEach(key => {
          if (key.match(/^(GTM|G|AW|DC)-[A-Z0-9]+$/)) {
             results.push({ id: key, source: 'js_object' });
          }
        });
      }
      // 2. Check Script Tags (to find proxied URLs)
      var scripts = document.querySelectorAll('script[src*="id=GTM-"], script[src*="id=G-"], script[src*="id=AW-"], script[src*="id=DC-"]');
      scripts.forEach(s => {
         var match = s.src.match(/id=([A-Z0-9-]+)/);
         if (match && match[1]) {
           results.push({ id: match[1], source: 'dom', url: s.src });
         }
      });
      return results;
    })()
    `,
    (results, isException) => {
      if (isException || !results) return;
      
      let foundNew = false;
      results.forEach(res => {
        if (!detectedContainers[res.id]) {
          detectedContainers[res.id] = { url: res.url || null };
          foundNew = true;
        } else if (res.url && !detectedContainers[res.id].url) {
          // Upgrade info if we found a URL for an existing ID
          detectedContainers[res.id].url = res.url;
        }
      });

      if (foundNew) updateDropdown();
    }
  );
}

function updateDropdown() {
  const select = document.getElementById('container-select');
  const ids = Object.keys(detectedContainers);
  
  if (ids.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No containers found</option><option value="other">Other (Manual URL)...</option>';
    select.disabled = false;
    return;
  }

  // Keep the current selection if possible
  const currentVal = select.value;
  
  let html = '<option value="" disabled>Select a container...</option>';
  ids.forEach(id => {
    const label = detectedContainers[id].url ? `${id} (Found)` : `${id} (Detected in JS)`;
    html += `<option value="${id}">${label}</option>`;
  });
  html += '<option value="other">Other (Manual URL)...</option>';
  
  select.innerHTML = html;
  select.disabled = false;
  if (currentVal && (ids.includes(currentVal) || currentVal === 'other')) {
    select.value = currentVal;
  } else {
    select.value = ""; // Reset if previous selection is gone
  }
  
  if (ids.length > 0) setStatus(`Found ${ids.length} container(s).`);
}

// 2. Load Logic
async function loadSelectedContainer() {
  const select = document.getElementById('container-select');
  const id = select.value;

  if (!id) return;

  let urlToFetch = '';

  if (id === 'other') {
    urlToFetch = document.getElementById('custom-url-input').value.trim();
    if (!urlToFetch) {
      setStatus('Please enter a URL.', true);
      return;
    }
  } else {
    // It's a discovered ID
    const info = detectedContainers[id];
    if (info && info.url) {
      urlToFetch = info.url;
    } else {
      // Fallback: If we saw the ID in JS but never found a script tag, try standard Google URL
      // This handles cases where it might be hidden or injected dynamically without a src
      urlToFetch = `https://www.googletagmanager.com/gtm.js?id=${id}`;
      setStatus(`No script tag found for ${id}. Trying standard URL...`);
    }
  }

  setStatus(`Fetching ${urlToFetch}...`);

  try {
    const response = await fetch(urlToFetch, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    
    // Determine ID for display if Manual
    let displayId = id;
    if (id === 'other') {
       const match = urlToFetch.match(/id=([A-Z0-9-]+)/);
       displayId = match ? match[1] : "Custom URL";
    }

    processGtmScriptContent(text, displayId);

  } catch (e) {
    setStatus(`Fetch failed: ${e.message}`, true);
  }
}

// --- Event Wiring ---

document.addEventListener('DOMContentLoaded', () => {
  sandboxFrame = document.getElementById('sandbox-iframe');
  
  resetUI();
  
  // Attempt initial scan
  scanForContainers();
  // Poll for containers (GTM might load late)
  setInterval(scanForContainers, 2000);

  // Listen for Network requests (to catch them early)
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const url = request.request.url;
    // Loose match for GTM-like URLs
    if (url.includes('gtm.js') || url.match(/[?&]id=(GTM|G|AW|DC)-/)) {
      const match = url.match(/[?&]id=([A-Z0-9-]+)/);
      if (match) {
        const id = match[1];
        detectedContainers[id] = { url: url };
        updateDropdown();
      }
    }
  });

  chrome.devtools.network.onNavigated.addListener(() => {
    resetUI();
    scanForContainers();
  });

  // UI Events
  document.getElementById('container-select').addEventListener('change', (e) => {
    const isOther = e.target.value === 'other';
    document.getElementById('manual-input-row').style.display = isOther ? 'flex' : 'none';
  });

  document.getElementById('load-btn').addEventListener('click', loadSelectedContainer);

  document.getElementById('refresh-btn').addEventListener('click', () => {
    resetUI();
    chrome.devtools.inspectedWindow.reload();
  });

  // Modal delegation
  document.body.addEventListener('click', (event) => {
    if (event.target.classList.contains('item-name')) {
      const jsonString = event.target.dataset.json;
      if (jsonString) {
        document.getElementById('json-content').innerText = JSON.stringify(JSON.parse(jsonString), null, 2);
        document.getElementById('jsonModal').style.display = 'block';
      }
    }
  });
  
  const modal = document.getElementById('jsonModal');
  document.querySelector('.modal-close').onclick = () => modal.style.display = "none";
  window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

  // Export
  document.getElementById('exportButton').addEventListener('click', () => {
    if (!fullGtmData) return;
    const blob = new Blob([JSON.stringify(fullGtmData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentContainerId || 'gtm'}-parsed.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
});