let fullGtmData = null;
let currentContainerId = '';
let sandboxFrame;
let detectedContainers = {}; 

// --- Dictionaries for Human-Readable Output ---

const operatorMap = {
  '_eq': '=',
  '_cn': 'contains',
  '_re': 'matches Regex',
  '_sw': 'starts with',
  '_ew': 'ends with',
  '_lt': '<',
  '_le': '<=',
  '_gt': '>',
  '_ge': '>='
};

// Map internal GTM variable names to UI names
const variableNameMap = {
  'gtm.elementClasses': 'Click Classes',
  'gtm.elementId': 'Click ID',
  'gtm.elementTarget': 'Click Target',
  'gtm.elementUrl': 'Click URL',
  'gtm.element': 'Click Element',
  'gtm.triggers': 'Triggers',
  'gtm.scrollThreshold': 'Scroll Depth Threshold',
  'gtm.scrollUnits': 'Scroll Depth Units',
  'gtm.scrollDirection': 'Scroll Direction',
  'gtm.videoProvider': 'Video Provider',
  'gtm.videoStatus': 'Video Status',
  'gtm.videoUrl': 'Video URL',
  'gtm.videoTitle': 'Video Title',
  'gtm.videoDuration': 'Video Duration',
  'gtm.videoCurrentTime': 'Video Current Time',
  'gtm.videoPercent': 'Video Percent',
  'gtm.videoVisible': 'Video Visible',
  'gtm.formId': 'Form ID',
  'gtm.formClasses': 'Form Classes',
  'gtm.formUrl': 'Form URL',
  'gtm.formName': 'Form Name',
  'gtm.errorMessage': 'Error Message',
  'gtm.errorUrl': 'Error URL',
  'gtm.errorLine': 'Error Line'
};

// Map Event values to Trigger Types
const eventMap = {
  'gtm.js': 'Page View',
  'gtm.dom': 'DOM Ready',
  'gtm.load': 'Window Loaded',
  'gtm.click': 'Click (All Elements)',
  'gtm.linkClick': 'Link Click',
  'gtm.formSubmit': 'Form Submission',
  'gtm.timer': 'Timer',
  'gtm.historyChange': 'History Change',
  'gtm.scrollDepth': 'Scroll Depth',
  'gtm.video': 'YouTube Video',
  'gtm.init': 'Initialization',
  'gtm.init_consent': 'Consent Initialization'
};

// List of all standard built-in GTM Listener/Grouping functions
const listenerFunctions = ['__cl', '__fsl', '__lcl', '__evl', '__ytl', '__tl', '__sdl', '__hl', '__jel', '__tg'];

// --- Helper Functions ---

function findMacroIndices(obj, indices = new Set()) {
  if (Array.isArray(obj)) {
    if (obj[0] === 'macro' && typeof obj[1] === 'number') indices.add(obj[1]);
    else obj.forEach(item => findMacroIndices(item, indices));
  } else if (typeof obj === 'object' && obj !== null) {
    Object.values(obj).forEach(value => findMacroIndices(value, indices));
  }
  return indices;
}

function inferTemplateName(tagFunction, permissions) {
  const perms = permissions[tagFunction];
  if (!perms) return "Custom Template Tag";

  if (perms.access_globals && perms.access_globals.keys) {
    const keys = perms.access_globals.keys.map(k => k.key);
    if (keys.includes('fbq') || keys.includes('_fbq')) return "Facebook Pixel (Template)";
    if (keys.includes('_hsq')) return "HubSpot (Template)";
    if (keys.includes('ttq')) return "TikTok Pixel (Template)";
    if (keys.includes('snaptr')) return "Snapchat Pixel (Template)";
    if (keys.includes('analytics')) return "Segment (Template)";
    if (keys.includes('amplitude')) return "Amplitude (Template)";
    if (keys.includes('mixpanel')) return "Mixpanel (Template)";
    if (keys.includes('pintrk')) return "Pinterest Tag (Template)";
    if (keys.includes('lintrk')) return "LinkedIn Insight Tag (Template)";
    if (keys.includes('twq')) return "Twitter/X Pixel (Template)";
    if (keys.includes('braze')) return "Braze (Template)";
    if (keys.includes('hj')) return "Hotjar (Template)";
    if (keys.includes('rdt')) return "Reddit Pixel (Template)";
    if (keys.includes('clarity')) return "Microsoft Clarity (Template)";
  }
  if (perms.inject_script && perms.inject_script.urls) {
    const urls = perms.inject_script.urls.join(' ');
    if (urls.includes('facebook.net')) return "Facebook Pixel (Template)";
    if (urls.includes('hs-scripts.com')) return "HubSpot (Template)";
    if (urls.includes('tiktok.com')) return "TikTok Pixel (Template)";
    if (urls.includes('sc-static.net')) return "Snapchat Pixel (Template)";
    if (urls.includes('clarity.ms')) return "Microsoft Clarity (Template)";
  }
  return "Custom Template Tag";
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
    // *** NEW LISTENER TAGS ***
    case "__hl": return "History Change Listener"; 
    case "__jel": return "JavaScript Error Listener";
    case "__tl": return "Timer Listener";
    case "__sdl": return "Scroll Depth Listener";
    default: return `Custom Tag: ${tag.function}`;
  }
}

/**
 * Parses the object from the sandbox into a human-readable format.
 */
function parseGtmObject(gtmData) {
  const resource = gtmData.resource;
  if (!resource) throw new Error("Parsed data does not contain a 'resource' object.");

  const permissions = gtmData.permissions || {};
  const macros = resource.macros || [];
  const predicates = resource.predicates || [];
  const rules = resource.rules || [];
  const tags = resource.tags || [];

  // 1. Parse Macros (Variables)
  const parsedMacros = macros.map((macro, i) => {
    let name = `Unknown Variable (Index ${i})`;
    try {
      switch (macro.function) {
        case "__v": 
            const rawName = macro.vtp_name;
            name = variableNameMap[rawName] ? `${variableNameMap[rawName]}` : `Data Layer: ${rawName}`; 
            break;
        case "__u": name = `URL: ${macro.vtp_component || 'Full URL'}`; break;
        case "__e": name = "Event Name"; break;
        case "__gas": name = `GA Settings: ${macro.vtp_trackingId}`; break;
        case "__f": name = `Referrer`; break;
        case "__aev": name = `Auto-Event: ${macro.vtp_varType}`; break;
        case "__jsm": name = "Custom JavaScript"; break;
        case "__j": name = `JS Variable: ${macro.vtp_name}`; break;
        case "__d": name = `DOM Element: ${macro.vtp_elementSelector}`; break;
        case "__k": name = `1st Party Cookie: ${macro.vtp_name}`; break;
        case "__c": name = `Constant: "${macro.vtp_value}"`; break;
        case "__r": name = "Random Number"; break;
        case "__smm": name = "Lookup Table"; break;
        case "__hid": name = "HTML ID"; break;
        default:
          if (macro.function.startsWith("__cvt_")) {
            name = inferTemplateName(macro.function, permissions).replace(' (Template)', '');
          } else {
            name = `Custom Variable: ${macro.function}`;
          }
      }
    } catch (e) { name = `Error parsing variable ${i}`; }
    return { name: name, raw: macro };
  });

  const parseArg = (arg) => {
    if (Array.isArray(arg) && arg[0] === "macro") {
      const macro = parsedMacros[arg[1]];
      return (macro && macro.name) || `Macro ${arg[1]}`;
    }
    // Return quoted string literal
    return `"${arg}"`; 
  };

  // 2. Parse Predicates (Conditions)
  const parsedPredicates = predicates.map((pred, i) => {
    try {
      const opCode = pred.function;
      const op = operatorMap[opCode] || opCode.replace(/^_/, '');
      const arg0 = parseArg(pred.arg0);
      const arg1 = parseArg(pred.arg1);
      
      let readable = `${arg0} ${op} ${arg1}`;
      let type = 'other';
      
      // Clean up common variable names in conditions
      const cleanedVarName = arg0.replace(/\[Data Layer: gtm\.(.*)\]/, '$1');

      if (arg0 === 'Event Name' && opCode === '_eq') {
         type = 'event';
         const rawEvent = String(pred.arg1).replace(/"/g, '');
         if (eventMap[rawEvent]) {
            readable = `Event equals ${eventMap[rawEvent]}`;
         } else {
            readable = `Event equals ${rawEvent}`; // Custom Event
         }
      } else if (variableNameMap[cleanedVarName]) {
          // Simplify known variable conditions: [Click Classes] contains "MuiButton"
          readable = `${variableNameMap[cleanedVarName]} ${op} ${arg1}`;
      } else if (arg0.startsWith('Auto-Event')) {
          // Simplify Auto-Event: Auto-Event: TEXT = "Join Now"
          readable = `${arg0.split(':')[1].trim()} ${op} ${arg1}`;
      } else if (arg0.startsWith('URL:')) {
          // Simplify URL condition: URL: Path = "/membership"
          readable = `${arg0.split(':')[0].trim()} ${op} ${arg1}`;
      }

      return { text: readable, raw: pred, type: type, arg1: pred.arg1 };
    } catch (e) { 
        return { text: `Error parsing predicate ${i}`, raw: pred, type: 'error' }; 
    }
  });

  // 3. Parse Rules (Triggers)
  const parsedRules = rules.map((rule, i) => {
    try {
      const conditionIndices = rule[0].filter(item => item !== "if");
      
      let name = `Trigger ${i}`;
      let conditions = [];

      // Scan conditions to find the Event Name to use as the header and filter it out
      conditionIndices.forEach(index => {
          const pred = parsedPredicates[index];
          if (pred && pred.type === 'event') {
             const rawEvent = String(pred.arg1).replace(/"/g, '');
             name = eventMap[rawEvent] || `Custom Event: ${rawEvent}`;
          } else {
             conditions.push(pred ? pred.text : `Predicate ${index}`);
          }
      });
      
      if (name === `Trigger ${i}`) name = "Custom Trigger"; // Fallback if no event condition found

      const tagsToAdd = rule[1].filter(item => item !== "add");
      const rawPredicates = conditionIndices.map(index => predicates[index] || { error: `Predicate ${index} not found` });

      return {
        name: name, // Human readable header name
        conditions: conditions, // Only contains non-event conditions
        tagsToFire: tagsToAdd,
        raw: { "trigger-conditions": rawPredicates, "tags-to-fire": tagsToAdd }
      };
    } catch (e) {
      return { name: `Error parsing rule ${i}`, conditions: [], tagsToFire: [], raw: rule };
    }
  });

  // 4. Parse Tags
  const parsedTags = tags.map((tag, i) => {
    let name;
    let details = [];
    let isListener = false;

    // Check if the tag is one of the auto-injected listeners/groupers
    if (listenerFunctions.includes(tag.function)) { 
        isListener = true;
    }

    if (tag.function === "__paused") {
      const originalType = tag.vtp_originalTagType || "unknown";
      let originalName;
      if (originalType.startsWith("cvt_")) {
         originalName = inferTemplateName(`__${originalType}`, permissions); 
      } else {
         originalName = getTagName({ function: `__${originalType}` });
      }
      name = `${originalName} (Paused)`;
      details.push("This tag is paused.");
    } else {
      if (tag.function.startsWith("__cvt_")) {
        name = inferTemplateName(tag.function, permissions);
        const perms = permissions[tag.function];
        if (perms) {
          if (perms.inject_script) details.push(`<strong>Injects:</strong> ${perms.inject_script.urls.join(', ')}`);
          if (perms.access_globals) {
            const keys = perms.access_globals.keys.map(k => k.key).join(', ');
            details.push(`<strong>Globals:</strong> ${keys}`);
          }
          if (perms.send_pixel) details.push(`<strong>Pixels:</strong> ${perms.send_pixel.urls.join(', ')}`);
        }
      } else {
        name = getTagName(tag);
      }
      
      try {
        switch (tag.function) {
          case "__gaawe":
            details.push(`Event: ${tag.vtp_eventName}`);
            details.push(`ID: ${tag.vtp_measurementIdOverride}`);
            break;
          case "__ua":
            details.push(`Type: ${tag.vtp_trackType}`);
            if (tag.vtp_gaSettings && parsedMacros[tag.vtp_gaSettings[1]]) {
                details.push(`Settings: [${parsedMacros[tag.vtp_gaSettings[1]].name}]`);
            }
            break;
          case "__googtag": details.push(`ID: ${tag.vtp_tagId}`); break;
          case "__awct": details.push(`ID: ${tag.vtp_conversionId}`); break;
          case "__asp": details.push(`Pixel ID: ${tag.vtp_pixelId}`); break;
        }
      } catch (e) { }
    }

    const firingTriggers = parsedRules.filter(rule => rule.tagsToFire.includes(i));
    const usedVariableIndices = findMacroIndices(tag);
    const usedVariables = [...usedVariableIndices].map(index => parsedMacros[index]).filter(Boolean);

    return { 
      name, details, triggers: firingTriggers, variables: usedVariables, raw: tag, isListener
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
    item.details.forEach(d => { 
        const li = document.createElement('li'); 
        li.innerHTML = d; 
        ul.appendChild(li); 
    });
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

function displayData(data, containerId) {
  fullGtmData = data;
  setStatus('');
  document.getElementById('results').style.display = 'block';
  document.getElementById('container-id-display').innerText = containerId;
  
  const tagsList = document.getElementById('tags-list');
  tagsList.innerHTML = '';
  
  const listenersList = document.getElementById('listeners-list');
  listenersList.innerHTML = '';

  const standardTags = data.tags.filter(t => !t.isListener);
  const listenerTags = data.tags.filter(t => t.isListener);

  document.getElementById('tags-count').innerText = standardTags.length;
  document.getElementById('listeners-count').innerText = listenerTags.length;

  standardTags.sort((a, b) => a.name.localeCompare(b.name));
  standardTags.forEach(tag => tagsList.appendChild(createItem(tag)));

  listenerTags.sort((a, b) => a.name.localeCompare(b.name));
  listenerTags.forEach(tag => listenersList.appendChild(createItem(tag)));

  const triggersList = document.getElementById('triggers-list');
  triggersList.innerHTML = '';
  document.getElementById('triggers-count').innerText = data.triggers.length;
  data.triggers.sort((a, b) => a.name.localeCompare(b.name)); // Sort triggers by their new derived name
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

function scanForContainers() {
  chrome.devtools.inspectedWindow.eval(
    `
    (function() {
      var results = [];
      if (window.google_tag_manager) {
        Object.keys(window.google_tag_manager).forEach(key => {
          if (key.match(/^(GTM|G|AW|DC)-[A-Z0-9]+$/)) {
             results.push({ id: key, source: 'js_object' });
          }
        });
      }
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
    select.value = "";
  }
  
  if (ids.length > 0) setStatus(`Found ${ids.length} container(s).`);
}

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
    const info = detectedContainers[id];
    if (info && info.url) {
      urlToFetch = info.url;
    } else {
      urlToFetch = `https://www.googletagmanager.com/gtm.js?id=${id}`;
      setStatus(`No script tag found for ${id}. Trying standard URL...`);
    }
  }

  setStatus(`Fetching ${urlToFetch}...`);

  try {
    const response = await fetch(urlToFetch, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    
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
  scanForContainers();
  setInterval(scanForContainers, 2000);

  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const url = request.request.url;
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

  document.getElementById('container-select').addEventListener('change', (e) => {
    const isOther = e.target.value === 'other';
    document.getElementById('manual-input-row').style.display = isOther ? 'flex' : 'none';
    if (!isOther && e.target.value) {
        loadSelectedContainer();
    }
  });

  document.getElementById('load-btn').addEventListener('click', loadSelectedContainer);

  document.getElementById('refresh-btn').addEventListener('click', () => {
    resetUI();
    chrome.devtools.inspectedWindow.reload();
  });

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