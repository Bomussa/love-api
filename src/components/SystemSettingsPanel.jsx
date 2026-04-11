import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './Card'
import { Button } from './Button'
import { CheckCircle2, Globe, LogOut, PhoneCall, RefreshCw, Stethoscope, Users, XCircle } from 'lucide-react'
import api from '../lib/api'

/**
 * Doctor workspace.
 *
 * The legacy settings screen has been replaced by the operational doctor view
 * required by the queue system while keeping the file footprint unchanged.
 */
export function DoctorScreen({ session, onLogout, language = 'ar', toggleLanguage }) {
  const [dashboard, setDashboard] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [busyAction, setBusyAction] = useState('')
  const [transferTarget, setTransferTarget] = useState('')

  const availableTransferClinics = useMemo(() => (
    dashboard?.availableClinics?.filter((clinic) => clinic.id !== dashboard?.doctor?.clinicId) || []
  ), [dashboard])

  const showFeedback = (message, tone = 'success') => {
    setFeedback({ message, tone })
    window.setTimeout(() => setFeedback(null), 2500)
  }

  const loadDashboard = async () => {
    const nextDashboard = await api.getDoctorDashboard(session.token, session.doctorId)
    setDashboard(nextDashboard)
    setTransferTarget((previous) => previous || nextDashboard.availableClinics?.find((clinic) => clinic.id !== nextDashboard.doctor.clinicId)?.id || '')
  }

  useEffect(() => {
    loadDashboard().catch((error) => showFeedback(error.message, 'error'))

    const subscription = api.subscribeToQueue({ clinicId: session.clinicId }, () => {
      loadDashboard().catch(() => {})
    })

    return () => subscription.unsubscribe()
  }, [session.clinicId, session.doctorId, session.token])

  const runAction = async (key, action) => {
    setBusyAction(key)
    try {
      await action()
      await loadDashboard()
    } catch (error) {
      showFeedback(error.message, 'error')
    } finally {
      setBusyAction('')
    }
  }

  const currentPatient = dashboard?.currentPatient || null

  return (
    <div className="min-h-screen bg-gray-900" data-testid="doctor-screen">
      <header className="border-b border-gray-800 bg-gray-900/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="text-sm text-gray-400">{language === 'ar' ? 'شاشة الطبيب' : 'Doctor screen'}</div>
            <h1 className="text-2xl font-semibold text-white" data-testid="doctor-screen-title">{dashboard?.doctor?.displayName || session.displayName}</h1>
            <div className="text-sm text-gray-300" data-testid="doctor-screen-clinic-name">{dashboard?.doctor?.clinicName || session.clinicName}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="text-white" onClick={toggleLanguage} data-testid="doctor-language-toggle-button">
              <Globe className="h-4 w-4" />
              {language === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Button variant="outline" className="border-gray-600 text-white" onClick={() => loadDashboard().catch((error) => showFeedback(error.message, 'error'))} data-testid="doctor-refresh-button">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="gradientSecondary" onClick={onLogout} data-testid="doctor-logout-button">
              <LogOut className="h-4 w-4" />
              {language === 'ar' ? 'خروج' : 'Logout'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {feedback && (
          <div className={`rounded-lg border px-4 py-3 ${feedback.tone === 'error' ? 'border-red-400 bg-red-500/15 text-red-100' : 'border-green-400 bg-green-500/15 text-green-100'}`} data-testid="doctor-feedback-banner">
            {feedback.message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label={language === 'ar' ? 'المريض الحالي' : 'Current patient'} value={currentPatient?.patientId || '—'} testId="doctor-current-patient-value" />
          <MetricCard label={language === 'ar' ? 'بانتظار النداء' : 'Waiting'} value={dashboard?.stats?.waitingCount || 0} testId="doctor-waiting-count-value" />
          <MetricCard label={language === 'ar' ? 'مكتمل' : 'Completed'} value={dashboard?.stats?.completedCount || 0} testId="doctor-completed-count-value" />
          <MetricCard label={language === 'ar' ? 'غياب' : 'Absent'} value={dashboard?.stats?.absentCount || 0} testId="doctor-absent-count-value" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-white">
                <Stethoscope className="h-5 w-5 text-secondary" />
                {language === 'ar' ? 'المريض الحالي' : 'Current patient'}
              </CardTitle>
              <Button
                variant="gradient"
                onClick={() => runAction('call-next', async () => {
                  await api.callNextPatient(session.token, { clinicId: session.clinicId, doctorId: session.doctorId })
                  showFeedback(language === 'ar' ? 'تم استدعاء المراجع التالي' : 'Next patient called')
                })}
                disabled={busyAction === 'call-next'}
                data-testid="doctor-call-next-button"
              >
                <PhoneCall className="h-4 w-4" />
                {language === 'ar' ? 'استدعاء التالي' : 'Call next'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentPatient ? (
                <>
                  <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4" data-testid="doctor-current-patient-card">
                    <div className="grid gap-3 md:grid-cols-3">
                      <InfoBlock label={language === 'ar' ? 'رقم المراجع' : 'Patient ID'} value={currentPatient.patientId} testId="doctor-current-patient-id" />
                      <InfoBlock label={language === 'ar' ? 'رقم الدور' : 'Queue number'} value={currentPatient.queueNumber} testId="doctor-current-patient-queue-number" />
                      <InfoBlock label={language === 'ar' ? 'الحالة' : 'Status'} value={currentPatient.statusLabel} testId="doctor-current-patient-status" />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <Button
                      variant="gradient"
                      onClick={() => runAction('complete-current', async () => {
                        await api.completePatient(session.token, { clinicId: session.clinicId, doctorId: session.doctorId, patientId: currentPatient.patientId })
                        showFeedback(language === 'ar' ? 'تم إكمال المراجع وتحويله للمحطة التالية' : 'Patient completed and advanced')
                      })}
                      data-testid="doctor-complete-current-button"
                      disabled={busyAction === 'complete-current'}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {language === 'ar' ? 'إكمال' : 'Complete'}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-gray-600 text-white"
                      onClick={() => runAction('absent-current', async () => {
                        await api.markAbsent(session.token, { clinicId: session.clinicId, doctorId: session.doctorId, patientId: currentPatient.patientId })
                        showFeedback(language === 'ar' ? 'تم تسجيل المراجع كغياب' : 'Patient marked absent')
                      })}
                      data-testid="doctor-mark-absent-button"
                      disabled={busyAction === 'absent-current'}
                    >
                      <XCircle className="h-4 w-4" />
                      {language === 'ar' ? 'غياب' : 'Absent'}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-gray-600 text-white"
                      onClick={() => runAction('postpone-current', async () => {
                        await api.postponePatient(session.token, { clinicId: session.clinicId, doctorId: session.doctorId, patientId: currentPatient.patientId })
                        showFeedback(language === 'ar' ? 'تم تأجيل المراجع لنهاية الدور' : 'Patient postponed')
                      })}
                      data-testid="doctor-postpone-button"
                      disabled={busyAction === 'postpone-current'}
                    >
                      <Users className="h-4 w-4" />
                      {language === 'ar' ? 'تأجيل' : 'Postpone'}
                    </Button>
                    <div className="flex gap-2">
                      <select
                        value={transferTarget}
                        onChange={(event) => setTransferTarget(event.target.value)}
                        className="flex h-10 w-full rounded-md border border-gray-600 bg-gray-700/40 px-3 py-2 text-sm text-white"
                        data-testid="doctor-transfer-target-select"
                      >
                        {availableTransferClinics.map((clinic) => (
                          <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        className="border-gray-600 text-white"
                        onClick={() => runAction('transfer-current', async () => {
                          await api.transferPatient(session.token, {
                            clinicId: session.clinicId,
                            doctorId: session.doctorId,
                            patientId: currentPatient.patientId,
                            targetClinicId: transferTarget
                          })
                          showFeedback(language === 'ar' ? 'تم تحويل المراجع' : 'Patient transferred')
                        })}
                        data-testid="doctor-transfer-button"
                        disabled={!transferTarget || busyAction === 'transfer-current'}
                      >
                        {language === 'ar' ? 'تحويل' : 'Transfer'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-600 px-4 py-6 text-center text-gray-300" data-testid="doctor-no-current-patient">
                  {language === 'ar' ? 'لا يوجد مريض حالي. استخدم زر استدعاء التالي.' : 'No active patient. Call the next one.'}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">{language === 'ar' ? 'قائمة الغياب' : 'Absent list'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(dashboard?.absentPatients || []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-600 px-4 py-6 text-center text-gray-300" data-testid="doctor-empty-absent-list">
                  {language === 'ar' ? 'لا توجد حالات غياب.' : 'No absent cases.'}
                </div>
              ) : dashboard.absentPatients.map((patient) => (
                <div key={`${patient.patientId}-${patient.loggedAt}`} className="rounded-lg border border-gray-700 bg-gray-900/40 px-4 py-3" data-testid={`doctor-absent-row-${patient.patientId}`}>
                  <div className="text-white">{patient.patientId}</div>
                  <div className="text-sm text-gray-400">{patient.loggedAt}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-white">{language === 'ar' ? 'قائمة الانتظار' : 'Waiting list'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(dashboard?.waitingPatients || []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-600 px-4 py-6 text-center text-gray-300" data-testid="doctor-empty-waiting-list">
                {language === 'ar' ? 'قائمة الانتظار فارغة.' : 'Waiting list is empty.'}
              </div>
            ) : dashboard.waitingPatients.map((patient) => (
              <div key={patient.patientId} className="flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-900/40 p-4 lg:flex-row lg:items-center lg:justify-between" data-testid={`doctor-waiting-row-${patient.patientId}`}>
                <div className="grid gap-2 md:grid-cols-3 lg:w-[70%]">
                  <InfoBlock label={language === 'ar' ? 'رقم المراجع' : 'Patient ID'} value={patient.patientId} testId={`doctor-waiting-patient-id-${patient.patientId}`} />
                  <InfoBlock label={language === 'ar' ? 'رقم الدور' : 'Queue number'} value={patient.queueNumber} testId={`doctor-waiting-queue-number-${patient.patientId}`} />
                  <InfoBlock label={language === 'ar' ? 'عدد المنتظرين قبله' : 'Ahead'} value={patient.ahead} testId={`doctor-waiting-ahead-${patient.patientId}`} />
                </div>
                <Button
                  variant="outline"
                  className="border-gray-600 text-white"
                  onClick={() => runAction(`vip-${patient.patientId}`, async () => {
                    await api.vipFastTrack(session.token, { clinicId: session.clinicId, doctorId: session.doctorId, patientId: patient.patientId })
                    showFeedback(language === 'ar' ? 'تم إعطاء أولوية VIP' : 'VIP priority granted')
                  })}
                  data-testid={`doctor-vip-button-${patient.patientId}`}
                  disabled={busyAction === `vip-${patient.patientId}`}
                >
                  {language === 'ar' ? 'VIP Fast Track' : 'VIP Fast Track'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function MetricCard({ label, value, testId }) {
  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-5">
        <div className="text-sm text-gray-400">{label}</div>
        <div className="mt-2 text-3xl font-semibold text-white" data-testid={testId}>{value}</div>
      </CardContent>
    </Card>
  )
}

function InfoBlock({ label, value, testId }) {
  return (
    <div className="rounded-lg bg-gray-800/60 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white" data-testid={testId}>{value}</div>
    </div>
  )
}

export const SystemSettingsPanel = DoctorScreen

