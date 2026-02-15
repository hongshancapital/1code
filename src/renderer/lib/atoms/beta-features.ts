import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { isFeatureAvailable } from "../feature-flags"

// User personalization settings for AI to recognize the user
export interface UserPersonalization {
  preferredName: string
  personalPreferences: string
}

export const userPersonalizationAtom = atomWithStorage<UserPersonalization>(
  "profile:user-personalization",
  { preferredName: "", personalPreferences: "" },
  undefined,
  { getOnInit: true },
)

// Memory Settings
export const betaMemoryEnabledAtom = atomWithStorage<boolean>(
  "preferences:beta-memory-enabled",
  false,
  undefined,
  { getOnInit: true },
)

export const memoryRecordingEnabledAtom = atomWithStorage<boolean>(
  "preferences:memory-recording-enabled",
  true,
  undefined,
  { getOnInit: true },
)

export const memoryEnabledAtom = atomWithStorage<boolean>(
  "preferences:memory-enabled",
  true,
  undefined,
  { getOnInit: true },
)

// Browser Settings
const _betaBrowserEnabledStorageAtom = atomWithStorage<boolean>(
  "preferences:beta-browser-enabled",
  false,
  undefined,
  { getOnInit: true },
)

export const betaBrowserEnabledAtom = atom(
  (get) => isFeatureAvailable("browser") ? get(_betaBrowserEnabledStorageAtom) : false,
  (_get, set, value: boolean) => set(_betaBrowserEnabledStorageAtom, value)
)

// Voice Input Settings
export const betaVoiceInputEnabledAtom = atomWithStorage<boolean>(
  "preferences:beta-voice-input-enabled",
  false,
  undefined,
  { getOnInit: true },
)
