import React from 'react'
import { Card, CardContent } from './Card'

/**
 * Legacy screen placeholder after feature removal.
 */
export function PatientsManagement({ language }) {
  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-6 text-center text-gray-300" data-testid="patients-management-removed-card">
        {language === 'ar' ? 'تمت إزالة شاشة إدارة المراجعين من هذا الإصدار.' : 'Patients management screen was removed from this release.'}
      </CardContent>
    </Card>
  )
}

