/**
 * React Grab Scripts
 * Scripts for injecting and controlling React Grab element selector in webview
 * Uses the official react-grab API: https://github.com/aidenybai/react-grab
 */

// Import react-grab library source code as raw string
// This will be bundled at build time
import reactGrabSource from "react-grab/dist/index.global.js?raw"
import { createLogger } from "../../lib/logger"

const reactGrabLog = createLogger("ReactGrab")


/**
 * React Grab initialization script (after library is loaded)
 */
const REACT_GRAB_INIT_SCRIPT = `
(function() {
  // Initialize React Grab with our callbacks
  function initReactGrab() {
    try {
      // Get the init function from the global object
      // react-grab exports to globalThis.__REACT_GRAB_MODULE__ with init directly on it
      const reactGrab = window.__REACT_GRAB_MODULE__ || window.ReactGrab;
      if (!reactGrab || !reactGrab.init) {
        reactGrabLog.error('Library not found, available:', Object.keys(window.__REACT_GRAB_MODULE__ || {}));
        reactGrabLog.info('__REACT_GRAB_UNAVAILABLE__');
        return;
      }

      // Initialize with custom options and callbacks
      const api = reactGrab.init({
        enabled: true,
        theme: {
          enabled: true,
          hue: 160, // Green-ish to match cowork theme
          crosshair: {
            enabled: true,
          },
          elementLabel: {
            enabled: true,
          },
          selectionBox: {
            enabled: true,
          },
        },
        // Called when element is selected (clicked)
        onElementSelect: function(element) {
          reactGrabLog.info('Element selected:', element?.tagName);
        },
        // Called when copy is successful (Cmd+C)
        onCopySuccess: function(elements, content) {
          if (!elements || elements.length === 0) return;

          const element = elements[0];
          const data = {
            html: (element.outerHTML || content || '').slice(0, 10000),
            componentName: null,
            filePath: null,
          };

          // Try to get React component info from element
          try {
            const fiberKey = Object.keys(element).find(key =>
              key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
            );
            if (fiberKey && element[fiberKey]) {
              const fiber = element[fiberKey];
              let current = fiber;
              while (current) {
                if (current.type && typeof current.type === 'function') {
                  data.componentName = current.type.displayName || current.type.name || null;
                  break;
                }
                if (current.type && typeof current.type === 'object' && current.type.$$typeof) {
                  data.componentName = current.type.displayName || current.type.render?.name || null;
                  break;
                }
                current = current.return;
              }
            }
          } catch (e) {
            // Ignore errors when trying to get component info
          }

          reactGrabLog.info('__ELEMENT_SELECTED__:' + JSON.stringify(data));
        },
        // Called when state changes
        onStateChange: function(state) {
          reactGrabLog.info('State change - active:', state.isActive);
        },
      });

      // Store API globally for reuse
      window.__COWORK_REACT_GRAB_API__ = api;

      // Activate element selection
      api.activate();
      reactGrabLog.info('__REACT_GRAB_READY__');
    } catch (err) {
      reactGrabLog.error('Init failed:', err);
      reactGrabLog.info('__REACT_GRAB_UNAVAILABLE__');
    }
  }

  initReactGrab();
})();
`

/**
 * React Grab injection script - loads library and activates the element selector
 * Library code is bundled inline at build time
 */
export const REACT_GRAB_INJECT_SCRIPT = `
(function() {
  // If already initialized, just activate
  if (window.__COWORK_REACT_GRAB_API__) {
    window.__COWORK_REACT_GRAB_API__.activate();
    reactGrabLog.info('__REACT_GRAB_READY__');
    return;
  }

  // Check if library already loaded
  if (window.__REACT_GRAB_MODULE__ || window.ReactGrab) {
    ${REACT_GRAB_INIT_SCRIPT}
    return;
  }

  // Inject react-grab library (bundled at build time)
  try {
    ${reactGrabSource}

    // Small delay to ensure global is available
    setTimeout(function() {
      ${REACT_GRAB_INIT_SCRIPT}
    }, 50);
  } catch (err) {
    reactGrabLog.error('Failed to load library:', err);
    reactGrabLog.info('__REACT_GRAB_UNAVAILABLE__');
  }
})();
`

/**
 * React Grab deactivation script - completely disposes the element selector
 */
export const REACT_GRAB_DEACTIVATE_SCRIPT = `
(function() {
  try {
    const api = window.__COWORK_REACT_GRAB_API__;
    if (api) {
      // Try deactivate first
      if (typeof api.deactivate === 'function') {
        api.deactivate();
        reactGrabLog.info('Deactivated');
      }
      // Then dispose to fully clean up
      if (typeof api.dispose === 'function') {
        api.dispose();
        reactGrabLog.info('Disposed');
      }
      // Clear the reference
      delete window.__COWORK_REACT_GRAB_API__;
      reactGrabLog.info('__REACT_GRAB_DEACTIVATED__');
    } else {
      reactGrabLog.info('No API found to deactivate');
    }
  } catch (err) {
    reactGrabLog.error('Deactivation error:', err);
  }
})();
`

/**
 * Element selection data structure passed via console message
 */
export interface ElementSelectionData {
  /** First 10KB of the element's outer HTML */
  html: string
  /** React component name if available */
  componentName: string | null
  /** Source file path if available */
  filePath: string | null
}

/**
 * Console message markers for React Grab communication
 */
export const REACT_GRAB_MARKERS = {
  READY: "__REACT_GRAB_READY__",
  UNAVAILABLE: "__REACT_GRAB_UNAVAILABLE__",
  ELEMENT_SELECTED: "__ELEMENT_SELECTED__:",
  DEACTIVATED: "__REACT_GRAB_DEACTIVATED__",
} as const
