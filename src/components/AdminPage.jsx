import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './Card'
import { Button } from './Button'
import { DoctorManagement } from './ClinicsConfiguration'
import {
  BarChart3,
  Building2,
  Globe,
  Home,
  LogOut,
  PhoneCall,
  RefreshCw,
  Users,
  Clock,
  CheckCircle,
  Stethoscope
} from 'lucide-react'
import api from '../lib/api'

/**
 * Simplified administrator workspace.
 *
 * Only the allowed production screens remain: dashboard, queue management, and
 * doctor management.
 */
export function AdminPage({ session, onLogout, language, toggleLanguage }) {
  const [currentView, setCurrentView] = useState('dashboard')
  const [dashboard, setDashboard] = useState(null)
  const [busyKey, setBusyKey] = useState('')
  const [feedback, setFeedback] = useState(null)

  const showFeedback = (message, tone = 'success') => {
    setFeedback({ message, tone })
    window.setTimeout(() => setFeedback(null), 2500)
  }

  const loadDashboard = async () => {
    const nextDashboard = await api.getAdminDashboard(session.token)
    setDashboard(nextDashboard)
  }

  useEffect(() => {
    loadDashboard().catch((error) => showFeedback(error.message, 'error'))

    const subscription = api.subscribeToQueue({}, () => {
      loadDashboard().catch(() => {})
    })

    return () => subscription.unsubscribe()
  }, [session.token])

  const runAction = async (key, action) => {
    setBusyKey(key)
    try {
      await action()
      await loadDashboard()
    } catch (error) {
      showFeedback(error.message, 'error')
    } finally {
      setBusyKey('')
    }
  }

  const renderSidebar = () => (
    <div className="w-64 bg-gray-800/50 border-r border-gray-700 p-4 z-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-yellow-500 rounded-full flex items-center justify-center">
          <Stethoscope className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-white font-semibold">{language === 'ar' ? 'لوحة الإدارة' : 'Admin panel'}</h2>
          <p className="text-gray-400 text-sm">{session.username}</p>
        </div>
      </div>

      <nav className="space-y-2">
        <Button
          variant={currentView === 'dashboard' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => setCurrentView('dashboard')}
          data-testid="admin-nav-dashboard-button"
        >
          <BarChart3 className="icon icon-md me-3" />
          {language === 'ar' ? 'لوحة التحكم' : 'Dashboard'}
        </Button>
        <Button
          variant={currentView === 'queues' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => setCurrentView('queues')}
          data-testid="admin-nav-queues-button"
        >
          <Users className="icon icon-md me-3" />
          {language === 'ar' ? 'إدارة الطوابير' : 'Queue management'}
        </Button>
        <Button
          variant={currentView === 'doctors' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => setCurrentView('doctors')}
          data-testid="admin-nav-doctors-button"
        >
          <Building2 className="icon icon-md me-3" />
          {language === 'ar' ? 'إدارة الأطباء' : 'Doctor management'}
        </Button>
      </nav>
    </div>
  )

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{language === 'ar' ? 'لوحة التحكم' : 'Dashboard'}</h1>
        <Button variant="outline" onClick={() => loadDashboard().catch((error) => showFeedback(error.message, 'error'))} disabled={busyKey === 'refresh-dashboard'} data-testid="admin-dashboard-refresh-button">
          <RefreshCw className="icon icon-md me-2" />
          {language === 'ar' ? 'تحديث' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label={language === 'ar' ? 'إجمالي المرضى' : 'Total patients'} value={dashboard?.overview?.totalPatients || 0} icon={<Users className="icon icon-xl text-blue-400" />} testId="admin-total-patients-value" />
        <MetricCard label={language === 'ar' ? 'بانتظار النداء' : 'Waiting'} value={dashboard?.overview?.waitingCount || 0} icon={<Home className="icon icon-xl text-green-400" />} testId="admin-waiting-count-value" />
        <MetricCard label={language === 'ar' ? 'مكتمل' : 'Completed'} value={dashboard?.overview?.completedCount || 0} icon={<CheckCircle className="icon icon-xl text-purple-400" />} testId="admin-completed-count-value" />
        <MetricCard label={language === 'ar' ? 'متوسط الانتظار' : 'Avg wait'} value={dashboard?.overview?.avgWaitMinutes || 0} icon={<Clock className="icon icon-xl text-yellow-400" />} testId="admin-avg-wait-value" />
      </div>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{language === 'ar' ? 'حالة العيادات' : 'Clinic status'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(dashboard?.clinics || []).length === 0 ? (
            <div className="text-center text-gray-400 py-8" data-testid="admin-empty-clinic-status">
              {language === 'ar' ? 'لا توجد عيادات نشطة' : 'No active clinics'}
            </div>
          ) : (
            dashboard.clinics.map((clinic) => (
              <div key={clinic.id} className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg" data-testid={`admin-dashboard-clinic-card-${clinic.id}`}>
                <div>
                  <h3 className="text-white font-semibold">{clinic.name}</h3>
                  <p className="text-gray-400 text-sm" data-testid={`admin-dashboard-clinic-current-${clinic.id}`}>{language === 'ar' ? 'الحالي' : 'Current'}: {clinic.currentPatient?.patientId || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold" data-testid={`admin-dashboard-clinic-waiting-${clinic.id}`}>{clinic.waitingCount}</p>
                  <p className="text-gray-400 text-sm">{language === 'ar' ? 'في الانتظار' : 'Waiting'}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )

  const renderQueues = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{language === 'ar' ? 'إدارة الطوابير' : 'Queue management'}</h1>
        <Button variant="outline" onClick={() => loadDashboard().catch((error) => showFeedback(error.message, 'error'))} data-testid="admin-queues-refresh-button">
          <RefreshCw className="icon icon-md me-2" />
          {language === 'ar' ? 'تحديث' : 'Refresh'}
        </Button>
      </div>

      <div className="space-y-4">
        {(dashboard?.clinics || []).length === 0 ? (
          <div className="text-center text-gray-400 py-8" data-testid="admin-queues-empty-state">
            {language === 'ar' ? 'لا توجد طوابير للإدارة' : 'No queues to manage'}
          </div>
        ) : (
          dashboard.clinics.map((clinic) => (
            <Card key={clinic.id} className="bg-gray-800/50 border-gray-700" data-testid={`admin-queue-card-${clinic.id}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-semibold text-lg">{clinic.name}</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-white" data-testid={`admin-queue-current-number-${clinic.id}`}>{clinic.currentPatient?.queueNumber || '—'}</p>
                        <p className="text-gray-400 text-sm">{language === 'ar' ? 'الحالي' : 'Current'}</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-yellow-400" data-testid={`admin-queue-waiting-count-${clinic.id}`}>{clinic.waitingCount || 0}</p>
                        <p className="text-gray-400 text-sm">{language === 'ar' ? 'بانتظار النداء' : 'Waiting'}</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-green-400" data-testid={`admin-queue-completed-count-${clinic.id}`}>{clinic.completedCount || 0}</p>
                        <p className="text-gray-400 text-sm">{language === 'ar' ? 'مكتمل' : 'Completed'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runAction(`call-next-${clinic.id}`, async () => {
                        await api.callNextPatient(session.token, { clinicId: clinic.id })
                        showFeedback(language === 'ar' ? 'تم استدعاء المراجع التالي' : 'Next patient called')
                      })}
                      disabled={busyKey === `call-next-${clinic.id}` || !clinic.waitingCount}
                      className="border-yellow-500 text-yellow-400 hover:bg-yellow-500/10"
                      data-testid={`admin-call-next-button-${clinic.id}`}
                    >
                      <PhoneCall className="h-4 w-4" />
                      {language === 'ar' ? 'استدعاء التالي' : 'Call next'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo.jpeg" alt="قيادة الخدمات الطبية" className="w-12 h-12 object-contain rounded-full" />
              <div className="text-right">
                <h1 className="text-white font-semibold text-lg">{language === 'ar' ? 'قيادة الخدمات الطبية' : 'Medical Services Directorate'}</h1>
                <p className="text-gray-400 text-sm">{language === 'ar' ? 'الخدمات الطبية' : 'Military Medical Services'}</p>
              </div>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-white font-medium">{language === 'ar' ? 'نظام اللجنة الطبية' : 'Medical Committee System'}</h2>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white" onClick={toggleLanguage} data-testid="admin-language-toggle-button">
              <Globe className="icon icon-md me-2" />
              {language === 'ar' ? 'English' : 'العربية'}
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b border-gray-800 bg-gray-800/30">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-yellow-500 rounded-full flex items-center justify-center">
              <Stethoscope className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-semibold">{language === 'ar' ? 'لوحة الإدارة' : 'Admin dashboard'}</h2>
              <p className="text-gray-400 text-sm">{session.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="border-yellow-500 text-yellow-400" data-testid="admin-home-button">
              <Home className="icon icon-md me-2" />
              {language === 'ar' ? 'الرئيسية' : 'Home'}
            </Button>
            <Button variant="gradientSecondary" size="sm" onClick={onLogout} data-testid="admin-logout-button">
              <LogOut className="icon icon-md me-2" />
              {language === 'ar' ? 'خروج' : 'Logout'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex relative">
        {renderSidebar()}
        <main className="flex-1 p-6">
          {feedback && (
            <div className={`mb-4 rounded-lg border px-4 py-3 ${feedback.tone === 'error' ? 'border-red-400 bg-red-500/15 text-red-100' : 'border-green-400 bg-green-500/15 text-green-100'}`} data-testid="admin-feedback-banner">
              {feedback.message}
            </div>
          )}
          {currentView === 'dashboard' && renderDashboard()}
          {currentView === 'queues' && renderQueues()}
          {currentView === 'doctors' && (
            <DoctorManagement
              token={session.token}
              doctors={dashboard?.doctors || []}
              clinics={dashboard?.clinics || []}
              onChange={loadDashboard}
              language={language}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function MetricCard({ label, value, icon, testId }) {
  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm">{label}</p>
            <p className="text-3xl font-bold text-white" data-testid={testId}>{value}</p>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}
