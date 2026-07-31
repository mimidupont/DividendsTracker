'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Profile, ProfileContext,
  loadProfiles, getStoredProfileId, setStoredProfileId,
} from '@/lib/profile'

export default function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles]           = useState<Profile[]>([])
  const [activeProfile, setActiveRaw]     = useState<Profile | null>(null)

  useEffect(() => {
    loadProfiles().then(list => {
      setProfiles(list)
      if (!list.length) return
      const stored = getStoredProfileId()
      const match  = list.find(p => p.id === stored) ?? list[0]
      setActiveRaw(match)

      // Persist and announce the resolved profile even when it was only a
      // default. Without this, a browser with no stored id left localStorage
      // empty, and every data hook — which keys off that id — loaded nothing.
      if (stored !== match.id) {
        setStoredProfileId(match.id)
        window.dispatchEvent(new CustomEvent('divvy:profile-change', { detail: match.id }))
      }
    })
  }, [])

  const setActiveProfile = useCallback((profile: Profile) => {
    setStoredProfileId(profile.id)
    setActiveRaw(profile)
    // Clear the useAppData cache so data reloads for the new profile
    // We do this by dispatching a custom event that useAppData listens for
    window.dispatchEvent(new CustomEvent('divvy:profile-change', { detail: profile.id }))
  }, [])

  return (
    <ProfileContext.Provider value={{ profiles, activeProfile, setActiveProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}
