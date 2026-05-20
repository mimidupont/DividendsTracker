import type { Metadata } from 'next'
import './globals.css'
import ProfileProvider from '@/components/ProfileProvider'

export const metadata: Metadata = {
  title: 'Divvy — Wealth Tracker',
  description: 'Personal wealth & dividend tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ProfileProvider>
          {children}
        </ProfileProvider>
      </body>
    </html>
  )
}
