import React, { useEffect, useMemo, useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { ExamSelectionPage } from './components/ExamSelectionPage'
import { PatientPage } from './components/PatientPage'
import { AdminPage } from './components/AdminPage'
import { DoctorScreen } from './components/SystemSettingsPanel'
import api from './lib/api-unified'
import { t, getCurrentLanguage, setCurrentLanguage } from './lib/i18n'

const SESSION_STORAGE_KEY = 'mmc-session'

/**
 * Reads the persisted session from local storage.
 *
 * @returns {null | { role: string }} Previously stored session data.
 */
function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

/**
 * Persists the authenticated session for page reload resilience.
 *
 * @param {object | null} session
 */
function storeSession(session) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function App() {
  const [currentView, setCurrentView] = useState("login")
  const [pendingPatient, setPendingPatient] = useState(null)
  const [session, setSession] = useState(null)
  const [language, setLanguage] = useState(getCurrentLanguage())
  const [banner, setBanner] = useState(null)

  const requestedMode = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'patient'
    }

    if (window.location.pathname.includes('/doctor')) {
      return 'doctor'
    }

    if (window.location.pathname.includes('/admin')) {
      return 'admin'
    }

    return 'patient'
  }, [])

  useEffect(() => {
    setCurrentLanguage(language)
  }, [language])

  useEffect(() => {
    const storedSession = readStoredSession()
    if (!storedSession) {
      setCurrentView('login')
      return
    }

    setSession(storedSession)
    setCurrentView(storedSession.role)
  }, [])

  /**
   * Displays a lightweight in-app banner without adding extra UI dependencies.
   *
   * @param {string} message
   * @param {'success' | 'error' | 'info'} [tone]
   */
  const showBanner = (message, tone = 'info') => {
    setBanner({ message, tone })
    window.setTimeout(() => setBanner(null), 3000)
  }

  /**
   * Stores patient pre-check data before exam selection.
   */
  const handlePatientEntry = ({ patientId, gender }) => {
    setPendingPatient({ patientId, gender })
    setCurrentView('examSelection')
  }

  /**
   * Creates or restores the patient route after exam type selection.
   */
  const handleExamSelection = async (examType) => {
    try {
      if (!pendingPatient?.patientId || !pendingPatient?.gender) {
        throw new Error(language === 'ar' ? 'بيانات المراجع غير مكتملة' : 'Patient data is incomplete')
      }
      await api.patientLogin(pendingPatient.patientId, pendingPatient.gender, examType)

      const nextSession = {
        role: 'patient',
        patientId: pendingPatient.patientId,
        gender: pendingPatient.gender,
        examType
      }

      storeSession(nextSession)
      setSession(nextSession)
      setCurrentView('patient')
      showBanner(language === 'ar' ? 'تم إنشاء الرحلة الطبية بنجاح' : 'Medical route created successfully', 'success')
    } catch (error) {
      showBanner(error.message, 'error')
    }
  }

  /**
   * Authenticates the administrator and opens the admin workspace.
   */
  const handleAdminLogin = async ({ username, password }) => {
    try {
      const adminSession = await api.adminLogin(username, password)
      const nextSession = { role: 'admin', ...adminSession }

      storeSession(nextSession)
      setSession(nextSession)
      setCurrentView('admin')
      showBanner(language === 'ar' ? 'تم تسجيل دخول الإدارة' : 'Administrator signed in', 'success')
    } catch (error) {
      showBanner(error.message, 'error')
    }
  }

  /**
   * Authenticates a doctor and opens the doctor workspace.
   */
  const handleDoctorLogin = async ({ username, password }) => {
    try {
      const doctorSession = await api.doctorLogin(username, password)
      const nextSession = { role: 'doctor', ...doctorSession }

      storeSession(nextSession)
      setSession(nextSession)
      setCurrentView('doctor')
      showBanner(language === 'ar' ? 'تم تسجيل دخول الطبيب' : 'Doctor signed in', 'success')
    } catch (error) {
      showBanner(error.message, 'error')
    }
  }

  /**
   * Clears the in-memory and persisted session state.
   */
  const handleLogout = () => {
    setPendingPatient(null)
    setSession(null)
    storeSession(null)
    setCurrentView('login')
    window.history.pushState({}, '', window.location.pathname)
  }

  const toggleLanguage = () => {
    const newLang = language === 'ar' ? 'en' : 'ar'
    setLanguage(newLang)
    setCurrentLanguage(newLang)
  }

  return (
    <div className="min-h-screen" data-testid="app-shell">
      {banner && (
        <div
          className={`fixed top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-center shadow-lg ${
            banner.tone === 'error'
              ? 'border-red-400 bg-red-500/90 text-white'
              : banner.tone === 'success'
                ? 'border-green-400 bg-green-600/90 text-white'
                : 'border-blue-400 bg-blue-600/90 text-white'
          }`}
          data-testid="app-banner"
        >
          {banner.message}
        </div>
      )}

      <main className="relative z-10">
        {currentView === 'login' && (
          <LoginPage
            initialMode={requestedMode}
            onPatientLogin={handlePatientEntry}
            onAdminLogin={handleAdminLogin}
            onDoctorLogin={handleDoctorLogin}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}

        {currentView === 'examSelection' && pendingPatient && (
          <ExamSelectionPage
            onExamSelect={handleExamSelection}
            onBack={() => setCurrentView('login')}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}

        {currentView === 'patient' && session?.role === 'patient' && (
          <PatientPage
            session={session}
            onLogout={handleLogout}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}

        {currentView === 'admin' && session?.role === 'admin' && (
          <AdminPage
            session={session}
            onLogout={handleLogout}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}

        {currentView === 'doctor' && session?.role === 'doctor' && (
          <DoctorScreen
            session={session}
            onLogout={handleLogout}
            language={language}
            toggleLanguage={toggleLanguage}
          />
        )}
      </main>
    </div>
  )
}

export default App
