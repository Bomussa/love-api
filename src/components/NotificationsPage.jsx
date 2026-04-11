import React from 'react'
import { Card, CardContent } from './Card'

/**
 * Legacy notifications screen placeholder after scope reduction.
 */
export function NotificationsPage({ language }) {
  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-6 text-center text-gray-300" data-testid="notifications-page-removed-card">
        {language === 'ar' ? 'تمت إزالة شاشة الإشعارات المستقلة من هذا الإصدار.' : 'Standalone notifications screen was removed from this release.'}
      </CardContent>
    </Card>
  )
}

