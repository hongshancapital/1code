// Dev mode detection
export const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

// Auth server port - use different port in dev to allow running alongside production
export const AUTH_SERVER_PORT = IS_DEV ? 21322 : 21321

// Okta OAuth callback port
// Both dev and production use 3000 (Okta only allows one callback URL configured)
// TODO: Configure separate Okta app for dev if needed, then change to: IS_DEV ? 3300 : 3000
export const OKTA_CALLBACK_PORT = 3000
