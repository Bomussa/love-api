import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './Card'
import { Button } from './Button'
import { Globe, LogOut, RefreshCw } from 'lucide-react'
import api from '../lib/api'
/**
 * Patient live journey screen.
 *
 * The patient no longer completes clinics manually. The screen is now a read-
 * only realtime tracker that reflects doctor and admin actions instantly.
 */
export function PatientPage({ session, onLogout, language, toggleLanguage }) {
  const [journey, setJourney] = useState(null)
  const [error, setError] = useState('')

  const loadJourney = async () => {
    try {
      const nextJourney = await api.getPatientJourney(session.patientId)
      setJourney(nextJourney)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  useEffect(() => {
    loadJourney()

    const subscription = api.subscribeToQueue({ patientId: session.patientId }, () => {
      loadJourney().catch(() => {})
    })

    return () => subscription.unsubscribe()
  }, [session.patientId])

  const completedSteps = useMemo(() => (
    journey?.steps?.filter((step) => step.status === 'completed').length || 0
  ), [journey])

  const currentVisit = journey?.currentVisit || null

  return (
    <div className="min-h-screen p-4" data-testid="patient-page">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-300 hover:text-white hover:bg-gray-800/50"
            onClick={toggleLanguage}
            data-testid="patient-language-toggle-button"
          >
            <Globe className="icon icon-md me-2" />
            {language === 'ar' ? 'English' : 'العربية'}
          </Button>
          <div className="text-center">
            <img src="/logo.jpeg" alt="قيادة الخدمات الطبية" className="mx-auto w-24 h-24 rounded-full shadow-lg" />
            <h1 className="mt-3 text-2xl font-bold text-white">{language === 'ar' ? 'رحلة المراجع' : 'Patient journey'}</h1>
            <p className="text-sm text-gray-300" data-testid="patient-identifier">{session.patientId}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => loadJourney()} className="border-gray-600 text-gray-300" data-testid="patient-refresh-button">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="gradientSecondary" onClick={onLogout} data-testid="patient-logout-button">
              <LogOut className="h-4 w-4" />
              {language === 'ar' ? 'خروج' : 'Logout'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-400 bg-red-500/15 px-4 py-3 text-red-100" data-testid="patient-error-banner">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard label={language === 'ar' ? 'العيادة الحالية' : 'Current clinic'} value={currentVisit?.clinicName || '—'} testId="patient-current-clinic-value" />
          <SummaryCard label={language === 'ar' ? 'رقم الدور' : 'Queue number'} value={currentVisit?.queueNumber || '—'} testId="patient-current-queue-number-value" />
          <SummaryCard label={language === 'ar' ? 'أمامك' : 'Ahead'} value={currentVisit?.ahead ?? 0} testId="patient-ahead-count-value" />
          <SummaryCard label={language === 'ar' ? 'المنجز' : 'Completed'} value={`${completedSteps}/${journey?.steps?.length || 0}`} testId="patient-completed-steps-value" />
        </div>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{language === 'ar' ? 'الحالة الحالية' : 'Current status'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <DetailBlock label={language === 'ar' ? 'الحالة' : 'Status'} value={currentVisit?.statusLabel || (language === 'ar' ? 'بانتظار التحديث' : 'Waiting for update')} testId="patient-current-status-value" />
              <DetailBlock label={language === 'ar' ? 'المريض المخدوم حالياً' : 'Serving number'} value={currentVisit?.currentServingNumber || '—'} testId="patient-serving-number-value" />
              <DetailBlock label={language === 'ar' ? 'آخر تحديث' : 'Updated at'} value={journey?.updatedAt || '—'} testId="patient-last-updated-value" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{language === 'ar' ? 'المسار الطبي' : 'Medical route'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(journey?.steps || []).map((step, index) => (
              <div key={`${step.clinicId}-${index}`} className="rounded-xl border border-gray-700 bg-gray-900/40 p-4" data-testid={`patient-step-${step.clinicId}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white" data-testid={`patient-step-name-${step.clinicId}`}>{step.clinicName}</div>
                    <div className="text-sm text-gray-400" data-testid={`patient-step-order-${step.clinicId}`}>{language === 'ar' ? `المحطة ${index + 1}` : `Step ${index + 1}`}</div>
                  </div>
                  <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${step.status === 'completed' ? 'bg-green-500/20 text-green-200' : step.status === 'skipped' ? 'bg-red-500/20 text-red-200' : step.status === 'serving' || step.status === 'called' ? 'bg-yellow-500/20 text-yellow-200' : step.status === 'waiting' ? 'bg-blue-500/20 text-blue-200' : 'bg-gray-700 text-gray-200'}`} data-testid={`patient-step-status-${step.clinicId}`}>
                    {step.statusLabel}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <DetailBlock label={language === 'ar' ? 'رقمك' : 'Your number'} value={step.queueNumber || '—'} testId={`patient-step-number-${step.clinicId}`} />
                  <DetailBlock label={language === 'ar' ? 'أمامك' : 'Ahead'} value={step.ahead ?? '—'} testId={`patient-step-ahead-${step.clinicId}`} />
                  <DetailBlock label={language === 'ar' ? 'الحالة التفصيلية' : 'Detailed status'} value={step.note || step.statusLabel} testId={`patient-step-note-${step.clinicId}`} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, testId }) {
  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-5">
        <div className="text-sm text-gray-400">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-white" data-testid={testId}>{value}</div>
      </CardContent>
    </Card>
  )
}

function DetailBlock({ label, value, testId }) {
  return (
    <div className="rounded-lg bg-gray-800/60 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white" data-testid={testId}>{value}</div>
    </div>
  )
}

