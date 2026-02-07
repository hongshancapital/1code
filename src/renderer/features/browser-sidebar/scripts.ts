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
  window.__browserGenerateSnapshot = function(interactiveOnly = true) {
    refMap.clear();
    refCounter = 0;

    const lines = [];

    function processNode(el, indent) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      if (!isVisible(el)) return;

      // Skip script, style, etc.
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) return;

      const interactive = isInteractive(el);

      // If only interactive elements, skip non-interactive but still process children
      if (interactiveOnly && !interactive) {
        for (const child of el.children) {
          processNode(child, indent);
        }
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
      elementCount: refCounter
    };
  };

  // Get element by ref
  window.__browserGetElement = function(ref) {
    return refMap.get(ref) || null;
  };

  // Get element bounding rect
  window.__browserGetElementRect = function(ref) {
    const el = refMap.get(ref);
    if (!el) return null;
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

  // Hover
  window.__browserHover = function(ref) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    return { success: true };
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

  // Get text content
  window.__browserGetText = function(ref) {
    const el = refMap.get(ref);
    if (!el) return { success: false, error: \`Element not found: \${ref}\` };

    return { success: true, text: el.textContent || '' };
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

  console.log('[Browser] Webview script initialized');
})();
`;
}
