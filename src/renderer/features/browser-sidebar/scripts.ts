/**
 * Browser Webview Scripts
 * JavaScript to inject into webview for element ref management
 */

/**
 * Generate the script to inject into webview for element tracking
 * This script maintains a ref map and provides operations
 */
export function getWebviewScript(): string {
  return `
(function() {
  // Element ref map: @e1 -> Element
  const refMap = new Map();
  let refCounter = 0;

  // Expose to window for debugging
  window.__browserRefMap = refMap;

  // Check if element is visible
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Check if element is interactive
  function isInteractive(el) {
    const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];
    const interactiveRoles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'slider'];

    if (interactiveTags.includes(el.tagName)) return true;

    const role = el.getAttribute('role');
    if (role && interactiveRoles.includes(role)) return true;

    // Check for click handlers or tabindex
    if (el.onclick || el.hasAttribute('onclick')) return true;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;

    // Contenteditable
    if (el.isContentEditable) return true;

    return false;
  }

  // Get accessible role for element
  function getRole(el) {
    // Explicit role
    const role = el.getAttribute('role');
    if (role) return role;

    // Implicit roles from tag
    const tagRoles = {
      'A': 'link',
      'BUTTON': 'button',
      'INPUT': getInputRole(el),
      'SELECT': 'combobox',
      'TEXTAREA': 'textbox',
      'IMG': 'image',
      'H1': 'heading',
      'H2': 'heading',
      'H3': 'heading',
      'H4': 'heading',
      'H5': 'heading',
      'H6': 'heading',
      'UL': 'list',
      'OL': 'list',
      'LI': 'listitem',
      'NAV': 'navigation',
      'MAIN': 'main',
      'HEADER': 'banner',
      'FOOTER': 'contentinfo',
      'ASIDE': 'complementary',
      'FORM': 'form',
      'TABLE': 'table',
      'TR': 'row',
      'TH': 'columnheader',
      'TD': 'cell',
    };

    return tagRoles[el.tagName] || 'generic';
  }

  // Get role for input elements
  function getInputRole(input) {
    const type = input.getAttribute('type') || 'text';
    const inputRoles = {
      'text': 'textbox',
      'email': 'textbox',
      'password': 'textbox',
      'search': 'searchbox',
      'tel': 'textbox',
      'url': 'textbox',
      'number': 'spinbutton',
      'range': 'slider',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'button': 'button',
      'submit': 'button',
      'reset': 'button',
      'file': 'button',
    };
    return inputRoles[type] || 'textbox';
  }

  // Get accessible name for element
  function getAccessibleName(el) {
    // aria-label
    let name = el.getAttribute('aria-label');
    if (name) return name;

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy.split(' ')
        .map(id => document.getElementById(id)?.textContent)
        .filter(Boolean);
      if (labels.length > 0) return labels.join(' ');
    }

    // Associated label for form controls
    if (el.id) {
      const label = document.querySelector(\`label[for="\${el.id}"]\`);
      if (label) return label.textContent?.trim();
    }

    // Placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;

    // Title
    const title = el.getAttribute('title');
    if (title) return title;

    // alt for images
    const alt = el.getAttribute('alt');
    if (alt) return alt;

    // Button/link text content
    if (['BUTTON', 'A', 'LABEL'].includes(el.tagName)) {
      const text = el.textContent?.trim();
      if (text && text.length < 100) return text;
    }

    // value for inputs
    if (el.tagName === 'INPUT') {
      const value = el.value;
      if (value && ['button', 'submit', 'reset'].includes(el.type)) {
        return value;
      }
    }

    return null;
  }

  // Get relevant attributes for snapshot
  function getRelevantAttrs(el) {
    const attrs = [];

    // Input type
    if (el.tagName === 'INPUT') {
      const type = el.getAttribute('type') || 'text';
      if (type !== 'text') attrs.push(\`type=\${type}\`);
    }

    // Placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) attrs.push(\`placeholder="\${placeholder}"\`);

    // href for links
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) {
        // Truncate long URLs
        const truncated = href.length > 50 ? href.slice(0, 50) + '...' : href;
        attrs.push(\`href="\${truncated}"\`);
      }
    }

    // src for media elements (img, iframe, video, audio, source)
    if (['IMG', 'IFRAME', 'VIDEO', 'AUDIO', 'SOURCE'].includes(el.tagName)) {
      const src = el.getAttribute('src');
      if (src) {
        const truncated = src.length > 200 ? src.slice(0, 200) + '...' : src;
        attrs.push(\`src="\${truncated}"\`);
      }
    }

    // alt for images
    if (el.tagName === 'IMG') {
      const alt = el.getAttribute('alt');
      if (alt) attrs.push(\`alt="\${alt}"\`);
    }

    // Disabled state
    if (el.disabled) attrs.push('disabled');

    // Checked state
    if (el.checked) attrs.push('checked');

    // Required
    if (el.required) attrs.push('required');

    // Readonly
    if (el.readOnly) attrs.push('readonly');

    return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  }

  // Generate accessibility snapshot
  window.__browserGenerateSnapshot = function(interactiveOnly = true, maxElements = 0, includeImages = false, includeLinks = false) {
    refMap.clear();
    refCounter = 0;
    var hitLimit = false;

    const lines = [];

    function processNode(el, indent) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      if (hitLimit) return;
      if (!isVisible(el)) return;

      // Skip script, style, etc.
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) return;

      const interactive = isInteractive(el);
      let isRelevant = interactive;

      // Explicit inclusions
      if (includeImages && el.tagName === 'IMG') isRelevant = true;
      if (includeLinks && el.tagName === 'A') isRelevant = true;

      // If filtering by interactive/relevant elements
      if (interactiveOnly && !isRelevant) {
        for (const child of el.children) {
          processNode(child, indent);
        }
        return;
      }

      // Check element limit
      if (maxElements > 0 && refCounter >= maxElements) {
        hitLimit = true;
        return;
      }

      // Generate ref
      const ref = \`e\${++refCounter}\`;
      refMap.set(\`@\${ref}\`, el);

      // Build line
      const role = getRole(el);
      const name = getAccessibleName(el);
      const attrs = getRelevantAttrs(el);

      const namePart = name ? \` "\${name}"\` : '';
      lines.push(\`\${indent}[\${ref}] \${role}\${namePart}\${attrs}\`);

      // Process children
      for (const child of el.children) {
        processNode(child, indent + '  ');
      }
    }

    processNode(document.body, '');

    return {
      snapshot: lines.join('\\n'),
      elementCount: refCounter,
      truncated: hitLimit
    };
  };

  // Get element by ref
  window.__browserGetElement = function(ref) {
    return refMap.get(ref) || null;
  };

  // Get element bounding rect
  window.__browserGetElementRect = function(ref, selector) {
    let el = null;
    if (ref) el = refMap.get(ref);
    else if (selector) el = document.querySelector(selector);

    if (!el) return null;
    // Scroll into view first to ensure coordinates are relative to viewport correctly and element is visible
    // Use 'auto' for instant scrolling so we get the final position immediately
    try {
      el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    } catch (e) {
      // Fallback for browsers that don't support options
      el.scrollIntoView(true);
    }
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  };

  // Click element
  window.__browserClickElement = function(ref, dblClick = false) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (dblClick) {
      const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    } else {
      el.click();
    }

    return { success: true };
  };

  // Fill input
  window.__browserFillElement = function(ref, value) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    // Focus
    el.focus();

    // Clear existing value
    el.value = '';

    // Set new value (React-compatible)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch events
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true };
  };

  // Type text (append)
  window.__browserTypeText = function(text) {
    const el = document.activeElement;
    if (!el || !('value' in el)) {
      return { success: false, error: 'No focused input element' };
    }

    const newValue = el.value + text;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, newValue);
    } else {
      el.value = newValue;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));

    return { success: true };
  };

  // Scroll
  window.__browserScroll = function(options) {
    const { direction, amount = 200, ref } = options;

    if (ref) {
      const el = refMap.get(ref);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      }
    }

    const scrollOptions = { behavior: 'smooth' };

    switch (direction) {
      case 'up':
        window.scrollBy({ top: -amount, ...scrollOptions });
        break;
      case 'down':
        window.scrollBy({ top: amount, ...scrollOptions });
        break;
      case 'left':
        window.scrollBy({ left: -amount, ...scrollOptions });
        break;
      case 'right':
        window.scrollBy({ left: amount, ...scrollOptions });
        break;
    }

    return { success: true };
  };

  // Select option
  window.__browserSelectOption = function(ref, value) {
    const el = refMap.get(ref);
    if (!el || el.tagName !== 'SELECT') {
      return { success: false, error: 'Element is not a select' };
    }

    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true };
  };

  // Check/uncheck
  window.__browserCheck = function(ref, checked) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }

    return { success: false, error: 'Element is not a checkbox or radio' };
  };

  // Hover — dispatch mouse events with coordinates for JS handlers
  // Note: CSS :hover pseudo-class requires sendInputEvent from Electron side
  window.__browserHover = function(ref) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    // Dispatch mouse events with coordinates (triggers JS listeners)
    el.dispatchEvent(new MouseEvent('mouseenter', { clientX: cx, clientY: cy, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { clientX: cx, clientY: cy, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));

    // Mark element for hover styling (CSS :hover can't be triggered from JS)
    el.setAttribute('data-browser-hover', 'true');
    // Clean up previous hover marks
    document.querySelectorAll('[data-browser-hover]').forEach(e => {
      if (e !== el) e.removeAttribute('data-browser-hover');
    });

    return { success: true, position: { x: cx, y: cy } };
  };

  // Drag element to another element
  window.__browserDrag = function(options) {
    const { fromRef, fromSelector, toRef, toSelector } = options;

    const fromEl = fromRef ? refMap.get(fromRef) : (fromSelector ? document.querySelector(fromSelector) : null);
    const toEl = toRef ? refMap.get(toRef) : (toSelector ? document.querySelector(toSelector) : null);

    if (!fromEl) return { success: false, error: 'Source element not found' };
    if (!toEl) return { success: false, error: 'Target element not found' };

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const fromX = fromRect.x + fromRect.width / 2;
    const fromY = fromRect.y + fromRect.height / 2;
    const toX = toRect.x + toRect.width / 2;
    const toY = toRect.y + toRect.height / 2;

    // Simulate drag and drop sequence
    fromEl.dispatchEvent(new MouseEvent('mousedown', { clientX: fromX, clientY: fromY, bubbles: true }));
    fromEl.dispatchEvent(new DragEvent('dragstart', { clientX: fromX, clientY: fromY, bubbles: true }));
    toEl.dispatchEvent(new DragEvent('dragenter', { clientX: toX, clientY: toY, bubbles: true }));
    toEl.dispatchEvent(new DragEvent('dragover', { clientX: toX, clientY: toY, bubbles: true }));
    toEl.dispatchEvent(new DragEvent('drop', { clientX: toX, clientY: toY, bubbles: true }));
    fromEl.dispatchEvent(new DragEvent('dragend', { clientX: toX, clientY: toY, bubbles: true }));

    return { success: true };
  };

  // Download image from element
  window.__browserDownloadImage = function(ref, selector) {
    const el = ref ? refMap.get(ref) : (selector ? document.querySelector(selector) : null);
    if (!el) return { success: false, error: 'Element not found' };

    // Get image source
    let src = '';
    if (el.tagName === 'IMG') {
      src = el.src || el.getAttribute('src') || '';
    } else {
      // Try background-image
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        src = bg.replace(/^url\\(['"]?/, '').replace(/['"]?\\)$/, '');
      }
    }

    if (!src) return { success: false, error: 'No image source found' };

    return { success: true, data: { src } };
  };

  // Get text content (supports both ref and selector)
  window.__browserGetText = function(ref, selector) {
    let el = null;
    if (ref) {
      el = refMap.get(ref);
    } else if (selector) {
      el = document.querySelector(selector);
    }
    if (!el) return { success: false, error: ref ? \`Element not found: \${ref}\` : \`No element matches: \${selector}\` };

    return { success: true, text: el.textContent || '' };
  };

  // Query elements by CSS selector, assign refs, return matches
  window.__browserQuerySelector = function(selector) {
    const elements = document.querySelectorAll(selector);
    const results = [];
    for (const el of elements) {
      // Note: We deliberately include hidden elements here to allow finding
      // elements that might be opacity:0 (like file inputs) or lazy-loaded images.
      // if (!isVisible(el)) continue;

      // Check if element already has a ref
      let existingRef = null;
      for (const [r, mappedEl] of refMap.entries()) {
        if (mappedEl === el) { existingRef = r; break; }
      }
      // Assign new ref if needed
      const ref = existingRef || \`@e\${++refCounter}\`;
      if (!existingRef) refMap.set(ref, el);
      results.push({
        ref,
        role: getRole(el),
        name: getAccessibleName(el),
        tag: el.tagName.toLowerCase(),
        attrs: getRelevantAttrs(el).trim() || undefined,
      });
    }
    return { success: true, data: results, count: results.length };
  };

  // Get element clip rect for element-level screenshot
  window.__browserGetElementClipRect = function(ref) {
    const el = refMap.get(ref);
    if (!el) return null;
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };

  // Wait for element/text/url
  window.__browserWait = function(options) {
    return new Promise((resolve) => {
      const { selector, text, url, timeout = 30000 } = options;
      const startTime = Date.now();

      function check() {
        if (Date.now() - startTime > timeout) {
          resolve({ success: false, error: 'Wait timed out' });
          return;
        }

        if (selector) {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) {
            resolve({ success: true });
            return;
          }
        }

        if (text) {
          if (document.body.textContent?.includes(text)) {
            resolve({ success: true });
            return;
          }
        }

        if (url) {
          if (window.location.href.includes(url)) {
            resolve({ success: true });
            return;
          }
        }

        requestAnimationFrame(check);
      }

      check();
    });
  };

  // ========================================================================
  // P0-1: Fetch resource in browser context (carries cookies/session)
  // ========================================================================
  window.__browserFetchResource = async function(url, maxSizeMB) {
    maxSizeMB = maxSizeMB || 50;
    try {
      const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
      if (!response.ok) {
        return { success: false, error: 'HTTP ' + response.status + ': ' + response.statusText };
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > maxSizeMB * 1024 * 1024) {
        return { success: false, error: 'File too large: ' + (contentLength / 1024 / 1024).toFixed(1) + 'MB (max ' + maxSizeMB + 'MB)' };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxSizeMB * 1024 * 1024) {
        return { success: false, error: 'File too large: ' + (buffer.byteLength / 1024 / 1024).toFixed(1) + 'MB (max ' + maxSizeMB + 'MB)' };
      }
      var bytes = new Uint8Array(buffer);
      var binary = '';
      var chunkSize = 8192;
      for (var i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      var base64 = btoa(binary);
      var filename = '';
      var disposition = response.headers.get('content-disposition');
      if (disposition) {
        var match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";\\n]+)/i);
        if (match) filename = decodeURIComponent(match[1]);
      }
      if (!filename) {
        try { filename = new URL(url).pathname.split('/').pop() || ''; } catch(e) {}
      }
      return { success: true, data: { base64: base64, contentType: contentType, filename: filename, size: buffer.byteLength } };
    } catch (err) {
      var msg = err.message || String(err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('TypeError')) {
        msg += ' (possible causes: CORS policy, network issue, or invalid URL)';
        try {
          await fetch(url, { method: 'HEAD', mode: 'no-cors' });
          msg += '. HEAD request with no-cors succeeded — likely a CORS restriction on this resource.';
        } catch(e2) {
          msg += '. HEAD request also failed — likely a network/DNS issue or invalid URL.';
        }
      }
      return { success: false, error: 'Fetch failed: ' + msg };
    }
  };

  // ========================================================================
  // P0-1b: Smart download URL detection for batch download
  // ========================================================================
  window.__browserGetDownloadUrl = function(ref, selector, attribute) {
    var el = null;
    if (ref) el = refMap.get(ref);
    else if (selector) el = document.querySelector(selector);
    if (!el) return { success: false, error: ref ? 'Element not found: ' + ref : 'No match: ' + selector };

    // If attribute explicitly specified, use it
    if (attribute) {
      var val = el.getAttribute(attribute);
      if (!val && attribute in el) val = String(el[attribute]);
      if (!val) return { success: false, error: 'Attribute "' + attribute + '" not found on element' };
      return { success: true, data: { url: val, attribute: attribute, tag: el.tagName.toLowerCase() } };
    }

    // Smart detection based on tag
    var tag = el.tagName.toLowerCase();
    var url = null;
    var detectedAttr = null;

    switch (tag) {
      case 'img':
        url = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original');
        detectedAttr = el.getAttribute('src') ? 'src' : (el.getAttribute('data-src') ? 'data-src' : 'data-original');
        break;
      case 'a':
        url = el.getAttribute('href');
        detectedAttr = 'href';
        break;
      case 'video':
      case 'audio':
        url = el.getAttribute('src') || el.getAttribute('poster');
        detectedAttr = el.getAttribute('src') ? 'src' : 'poster';
        break;
      case 'source':
        url = el.getAttribute('src') || el.getAttribute('srcset');
        detectedAttr = el.getAttribute('src') ? 'src' : 'srcset';
        // srcset may have multiple URLs, take the first
        if (detectedAttr === 'srcset' && url) {
          url = url.split(',')[0].trim().split(/\s+/)[0];
        }
        break;
      case 'link':
        url = el.getAttribute('href');
        detectedAttr = 'href';
        break;
      default:
        // Generic: check src, href, data-url, then background-image
        if (el.getAttribute('src')) { url = el.getAttribute('src'); detectedAttr = 'src'; }
        else if (el.getAttribute('href')) { url = el.getAttribute('href'); detectedAttr = 'href'; }
        else if (el.getAttribute('data-url')) { url = el.getAttribute('data-url'); detectedAttr = 'data-url'; }
        else {
          var bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none') {
            url = bg.replace(/^url\\(['"]?/, '').replace(/['"]?\\)$/, '');
            detectedAttr = 'background-image';
          }
        }
        break;
    }

    if (!url) return { success: false, error: 'Element <' + tag + '> has no downloadable attribute (tried: src, href, data-src, data-url, background-image)' };
    return { success: true, data: { url: url, attribute: detectedAttr, tag: tag } };
  };

  // ========================================================================
  // P0-2: Get element attribute / HTML
  // ========================================================================
  window.__browserGetAttribute = function(ref, selector, attribute) {
    var el = null;
    if (ref) el = refMap.get(ref);
    else if (selector) el = document.querySelector(selector);
    if (!el) return { success: false, error: ref ? 'Element not found: ' + ref : 'No match: ' + selector };

    if (attribute === '__outerHTML') {
      var outer = el.outerHTML;
      if (outer.length > 102400) outer = outer.slice(0, 102400) + '\\n... (truncated, total ' + Math.round(outer.length / 1024) + 'KB)';
      return { success: true, data: { value: outer } };
    }
    if (attribute === '__innerHTML') {
      var inner = el.innerHTML;
      if (inner.length > 102400) inner = inner.slice(0, 102400) + '\\n... (truncated, total ' + Math.round(inner.length / 1024) + 'KB)';
      return { success: true, data: { value: inner } };
    }
    if (attribute === '__textContent') {
      return { success: true, data: { value: el.textContent || '' } };
    }
    if (!attribute || attribute === '__all') {
      var attrs = {};
      for (var i = 0; i < el.attributes.length; i++) {
        attrs[el.attributes[i].name] = el.attributes[i].value;
      }
      attrs['__tag'] = el.tagName.toLowerCase();
      return { success: true, data: { attributes: attrs } };
    }
    var value = el.getAttribute(attribute);
    if (value === null) {
      if (attribute in el) {
        return { success: true, data: { value: String(el[attribute]) } };
      }
      return { success: true, data: { value: null, exists: false } };
    }
    return { success: true, data: { value: value } };
  };

  // ========================================================================
  // P0-4: Get unique selector for element (for CDP usage)
  // ========================================================================
  window.__browserGetSelector = function(ref) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: 'Element not found: ' + ref };

    if (el.id) return { success: true, data: { selector: '#' + CSS.escape(el.id) } };

    // Generate path
    var path = [];
    var current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      var selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }
      var sibling = current;
      var nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.tagName.toLowerCase() === selector) nth++;
      }
      if (nth !== 1) selector += ':nth-of-type(' + nth + ')';
      path.unshift(selector);
      current = current.parentElement;
    }
    return { success: true, data: { selector: path.join(' > ') } };
  };

  // ========================================================================
  // P0-3: Page dimensions and scroll for full-page screenshot
  // ========================================================================
  window.__browserGetPageDimensions = function() {
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 0),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  };

  window.__browserScrollTo = function(x, y) {
    window.scrollTo(x, y);
    return { success: true };
  };

  window.__browserHideFixedElements = function() {
    var hidden = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var style = window.getComputedStyle(all[i]);
      if (style.position === 'fixed' || style.position === 'sticky') {
        var orig = all[i].style.cssText;
        all[i].style.setProperty('visibility', 'hidden', 'important');
        hidden.push({ el: all[i], orig: orig });
      }
    }
    window.__browserHiddenFixedElements = hidden;
    return { success: true, count: hidden.length };
  };

  window.__browserRestoreFixedElements = function() {
    var hidden = window.__browserHiddenFixedElements || [];
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].el.style.cssText = hidden[i].orig;
    }
    window.__browserHiddenFixedElements = [];
    return { success: true };
  };

  // ========================================================================
  // P1-3: Extract HTML for content extraction (Turndown runs in main process)
  // ========================================================================
  window.__browserExtractHTML = function(ref, selector, mode) {
    mode = mode || 'article';
    var root = null;
    if (ref) root = refMap.get(ref);
    else if (selector) root = document.querySelector(selector);

    if (mode === 'plain') {
      var target = root || document.body;
      return { success: true, data: { text: target.textContent || '', title: document.title, mode: mode } };
    }

    if (mode === 'article' && !root) {
      root = detectArticle();
    }
    if (!root) root = document.body;

    var html = root.outerHTML;
    if (html.length > 512000) {
      html = html.slice(0, 512000) + '<!-- truncated -->';
    }
    return { success: true, data: { html: html, title: document.title, mode: mode } };

    function detectArticle() {
      var article = document.querySelector('article');
      if (article && (article.textContent || '').trim().length > 200) return article;
      var main = document.querySelector('[role="main"], main');
      if (main && (main.textContent || '').trim().length > 200) return main;
      var best = null, bestScore = 0;
      var candidates = document.querySelectorAll('div, section, article');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var text = el.textContent || '';
        var textLen = text.trim().length;
        var childCount = el.children.length;
        var pCount = el.querySelectorAll(':scope > p').length;
        var score = textLen / (childCount + 1) + pCount * 50;
        if (textLen > 200 && score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      return best || document.body;
    }
  };

  // ========================================================================
  // P1-5: Storage Management
  // ========================================================================
  window.__browserStorage = function(type, action, key, value) {
    try {
      const storage = type === 'session' ? window.sessionStorage : window.localStorage;

      if (action === 'get') {
        if (key) {
          return { success: true, data: { data: storage.getItem(key) } };
        }
        // Get all
        const data = {};
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k) data[k] = storage.getItem(k);
        }
        return { success: true, data: { data: data } };
      }

      if (action === 'set') {
        if (!key) return { success: false, error: 'Key required for set' };
        storage.setItem(key, value || '');
        return { success: true };
      }

      if (action === 'delete') {
        if (!key) return { success: false, error: 'Key required for delete' };
        storage.removeItem(key);
        return { success: true };
      }

      if (action === 'clear') {
        storage.clear();
        return { success: true };
      }

      return { success: false, error: 'Unknown action' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  // ========================================================================
  // P1-4: Network request monitoring (fetch/XHR monkey-patch)
  // ========================================================================
  window.__browserNetworkCapture = {
    active: false,
    requests: [],
    maxRequests: 200,
    maxBodySize: 32768,
    counter: 0,
    originalFetch: null,
    originalXHROpen: null,
    originalXHRSend: null,
  };

  window.__browserStartNetworkCapture = function(options) {
    options = options || {};
    var capture = window.__browserNetworkCapture;
    if (capture.active) return { success: true, message: 'Already capturing' };

    capture.active = true;
    capture.requests = [];
    capture.counter = 0;
    if (options.maxRequests) capture.maxRequests = options.maxRequests;
    if (options.maxBodySize) capture.maxBodySize = options.maxBodySize;

    // Patch fetch
    capture.originalFetch = window.fetch;
    window.fetch = async function() {
      var args = arguments;
      var id = ++capture.counter;
      var startTime = Date.now();
      var resource = args[0];
      var init = args[1] || {};
      var entry = {
        id: id,
        method: (init.method || 'GET').toUpperCase(),
        url: typeof resource === 'string' ? resource : (resource.url || ''),
        status: 0, statusText: '', requestBody: null, responseBody: null,
        contentType: null, startTime: startTime, duration: 0, size: 0, type: 'fetch',
      };
      if (init.body && typeof init.body === 'string') {
        entry.requestBody = init.body.slice(0, capture.maxBodySize);
      }
      try {
        var response = await capture.originalFetch.apply(window, args);
        entry.status = response.status;
        entry.statusText = response.statusText;
        entry.contentType = response.headers.get('content-type') || '';
        entry.duration = Date.now() - startTime;
        if (entry.contentType.indexOf('json') !== -1 || entry.contentType.indexOf('text') !== -1) {
          try {
            var cloned = response.clone();
            var txt = await cloned.text();
            entry.responseBody = txt.slice(0, capture.maxBodySize);
            entry.size = txt.length;
          } catch(e) {}
        }
        if (capture.requests.length >= capture.maxRequests) capture.requests.shift();
        capture.requests.push(entry);
        return response;
      } catch (error) {
        entry.error = error.message;
        entry.duration = Date.now() - startTime;
        if (capture.requests.length >= capture.maxRequests) capture.requests.shift();
        capture.requests.push(entry);
        throw error;
      }
    };

    // Patch XHR
    capture.originalXHROpen = XMLHttpRequest.prototype.open;
    capture.originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__captureData = { method: method, url: url, id: ++capture.counter };
      return capture.originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      var xhr = this;
      if (xhr.__captureData) {
        var entry = {
          id: xhr.__captureData.id,
          method: xhr.__captureData.method.toUpperCase(),
          url: xhr.__captureData.url,
          status: 0, statusText: '', requestBody: null, responseBody: null,
          contentType: null, startTime: Date.now(), duration: 0, size: 0, type: 'xhr',
        };
        if (typeof body === 'string') entry.requestBody = body.slice(0, capture.maxBodySize);
        xhr.addEventListener('load', function() {
          entry.status = xhr.status;
          entry.statusText = xhr.statusText;
          entry.contentType = xhr.getResponseHeader('content-type') || '';
          entry.duration = Date.now() - entry.startTime;
          if (entry.contentType.indexOf('json') !== -1 || entry.contentType.indexOf('text') !== -1 || xhr.responseType === '' || xhr.responseType === 'text') {
            try {
              var t = typeof xhr.response === 'string' ? xhr.response : JSON.stringify(xhr.response);
              entry.responseBody = t.slice(0, capture.maxBodySize);
              entry.size = t.length;
            } catch(e) {}
          }
          if (capture.requests.length >= capture.maxRequests) capture.requests.shift();
          capture.requests.push(entry);
        });
        xhr.addEventListener('error', function() {
          entry.error = 'Network error';
          entry.duration = Date.now() - entry.startTime;
          if (capture.requests.length >= capture.maxRequests) capture.requests.shift();
          capture.requests.push(entry);
        });
      }
      return capture.originalXHRSend.apply(this, arguments);
    };

    return { success: true };
  };

  window.__browserStopNetworkCapture = function() {
    var capture = window.__browserNetworkCapture;
    if (!capture.active) return { success: true, message: 'Not capturing' };
    if (capture.originalFetch) window.fetch = capture.originalFetch;
    if (capture.originalXHROpen) XMLHttpRequest.prototype.open = capture.originalXHROpen;
    if (capture.originalXHRSend) XMLHttpRequest.prototype.send = capture.originalXHRSend;
    capture.active = false;
    capture.originalFetch = null;
    capture.originalXHROpen = null;
    capture.originalXHRSend = null;
    return { success: true, count: capture.requests.length };
  };

  window.__browserClearNetworkCapture = function() {
    var capture = window.__browserNetworkCapture;
    capture.requests = [];
    return { success: true };
  };

  window.__browserGetNetworkRequests = function(filter) {
    filter = filter || {};
    var capture = window.__browserNetworkCapture;
    var results = capture.requests.slice();
    if (filter.urlPattern) {
      var re = new RegExp(filter.urlPattern, 'i');
      results = results.filter(function(r) { return re.test(r.url); });
    }
    if (filter.method) {
      var m = filter.method.toUpperCase();
      results = results.filter(function(r) { return r.method === m; });
    }
    if (filter.hasError) {
      results = results.filter(function(r) { return r.error || r.status >= 400; });
    }
    var limit = filter.limit || 50;
    var offset = filter.offset || 0;
    var total = results.length;
    results = results.slice(offset, offset + limit);
    return { success: true, data: { requests: results, total: total, capturing: capture.active, returned: results.length } };
  };

  browserLog.info('Webview script initialized');
})();
`;
}
