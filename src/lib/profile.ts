'use client'
/**
 * profile.ts — lightweight profile store
 *
 * Profiles are loaded from Supabase once and cached in memory.
 * The active profile ID is persisted in localStorage so it survives
 * page refreshes.  No authentication required.
 */
import { createContext, useContext } from 'react'
import { supabase } from './supabase'

export interface Profile {
  id: string
  name: string
  display_name: string
  initials: string
  base_currency: string
}

const STORAGE_KEY = 'divvy_profile_id'

// ── In-memory cache ───────────────────────────────────────────────────────────
let profilesCache: Profile[] | null = null
let inFlight: Promise<Profile[]> | null = null

export async function loadProfiles(): Promise<Profile[]> {
  if (profilesCache) return profilesCache
  if (inFlight) return inFlight
  inFlight = Promise.resolve(
    supabase.from('profiles').select('*').order('created_at')
  ).then(({ data }) => {
    profilesCache = (data ?? []) as Profile[]
    inFlight = null
    return profilesCache
  })
  return inFlight
}

// ── localStorage helpers ──────────────────────────────────────────────────────
export function getStoredProfileId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY)
}

export function setStoredProfileId(id: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, id)
}

// ── React context ─────────────────────────────────────────────────────────────
export interface ProfileContextValue {
  profiles: Profile[]
  activeProfile: Profile | null
  setActiveProfile: (profile: Profile) => void
}

export const ProfileContext = createContext<ProfileContextValue>({
  profiles: [],
  activeProfile: null,
  setActiveProfile: () => {},
})

export const useProfile = () => useContext(ProfileContext)
