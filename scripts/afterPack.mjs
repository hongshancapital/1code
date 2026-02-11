#!/usr/bin/env node
/**
 * electron-builder afterPack hook
 */

export default async function afterPack(context) {
  console.log(`[afterPack] Platform: ${context.electronPlatformName}, done.`)
}
