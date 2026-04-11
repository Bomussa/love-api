import React, { useEffect, useState } from 'react'
import { Card, CardContent } from './Card'
import { Button } from './Button'
import { Input } from './Input'
import { Globe, Shield, Stethoscope, User } from 'lucide-react'
import { t } from '../lib/i18n'

/**
 * Unified authentication screen for patient, admin, and doctor flows.
 *
 * @param {object} props
 * @param {(payload: { patientId: string, gender: string }) => void} props.onPatientLogin
 * @param {(payload: { username: string, password: string }) => Promise<void>} props.onAdminLogin
 * @param {(payload: { username: string, password: string }) => Promise<void>} props.onDoctorLogin
 * @param {'patient'|'admin'|'doctor'} props.initialMode
 * @param {string} props.language
 * @param {() => void} props.toggleLanguage
 * @returns {JSX.Element}
 */
export function LoginPage({ onPatientLogin, onAdminLogin, onDoctorLogin, initialMode, language, toggleLanguage }) {
  const [patientId, setPatientId] = useState('')
  const [gender, setGender] = useState('male')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState(initialMode || 'patient')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    setMode(initialMode || 'patient')
  }, [initialMode])

  /**
   * Converts Arabic numerals to ASCII digits for consistent backend validation.
   *
   * @param {string} value
   * @returns {string}
   */
  const normalizeArabicNumbers = (str) => {
    const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
    const englishNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

    let result = str
    for (let i = 0; i < arabicNumbers.length; i++) {
      result = result.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i])
    }
    return result;
  }

  const handlePatientIdChange = (e) => {
    setPatientId(normalizeArabicNumbers(e.target.value))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!patientId.trim()) return

    setLoading(true)
    try {
      await onPatientLogin({ patientId: patientId.trim(), gender })
    } finally {
      setLoading(false)
    }
  }

  const handleRoleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    setLoading(true)
    try {
      if (mode === 'admin') {
        await onAdminLogin({ username: username.trim(), password: password.trim() })
      }

      if (mode === 'doctor') {
        await onDoctorLogin({ username: username.trim(), password: password.trim() })
      }
    } finally {
      setLoading(false)
    }
  }

  const roleTitle = mode === 'admin'
    ? (language === 'ar' ? 'دخول الإدارة' : 'Admin Login')
    : mode === 'doctor'
      ? (language === 'ar' ? 'دخول الطبيب' : 'Doctor Login')
      : t('welcome', language)

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative" data-testid="login-page">
      <div className="w-full max-w-md space-y-8">
        <div className="absolute top-4 left-4 z-50">
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-300 hover:text-white hover:bg-gray-800/50"
            onClick={toggleLanguage}
            data-testid="language-toggle-button"
          >
            <Globe className="w-4 h-4 mr-2" />
            {language === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>

        <div className="text-center space-y-4">
          <img src="/logo.jpeg" alt="قيادة الخدمات الطبية" className="mx-auto w-32 h-32 rounded-full shadow-lg" />

          <div>
            <h1 className="text-3xl font-bold text-white">
              {language === 'ar' ? 'قيادة الخدمات الطبية' : 'Medical Services Command'}
            </h1>
            <p className="text-xl text-gray-300 mt-2">
              {language === 'ar' ? 'Medical Services' : 'قيادة الخدمات الطبية'}
            </p>
            <p className="text-gray-400 mt-2">
              {language === 'ar'
                ? 'المركز الطبي المتخصص العسكري - العطار - اللجنة الطبية'
                : 'Military Specialized Medical Center – Al-Attar – Medical Committee'}
            </p>
          </div>
        </div>

        <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
          <CardContent className="p-8">
            <div className="mb-6 grid grid-cols-3 gap-2" data-testid="login-mode-switcher">
              <Button
                type="button"
                variant={mode === 'patient' ? 'gradient' : 'outline'}
                className={mode === 'patient' ? '' : 'border-gray-600 text-gray-200'}
                onClick={() => setMode('patient')}
                data-testid="login-mode-patient-button"
              >
                {language === 'ar' ? 'مراجع' : 'Patient'}
              </Button>
              <Button
                type="button"
                variant={mode === 'doctor' ? 'gradient' : 'outline'}
                className={mode === 'doctor' ? '' : 'border-gray-600 text-gray-200'}
                onClick={() => setMode('doctor')}
                data-testid="login-mode-doctor-button"
              >
                {language === 'ar' ? 'طبيب' : 'Doctor'}
              </Button>
              <Button
                type="button"
                variant={mode === 'admin' ? 'gradient' : 'outline'}
                className={mode === 'admin' ? '' : 'border-gray-600 text-gray-200'}
                onClick={() => setMode('admin')}
                data-testid="login-mode-admin-button"
              >
                {language === 'ar' ? 'إدارة' : 'Admin'}
              </Button>
            </div>

            <div className="text-center mb-6">
              {mode === 'admin' ? (
                <Shield className="mx-auto w-12 h-12 text-yellow-400 mb-4" />
              ) : mode === 'doctor' ? (
                <Stethoscope className="mx-auto w-12 h-12 text-secondary mb-4" />
              ) : (
                <User className="mx-auto w-12 h-12 text-gray-400 mb-4" />
              )}
              <h2 className="text-xl font-semibold text-white" data-testid="login-mode-title">{roleTitle}</h2>
            </div>

            {mode === 'patient' ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('personalNumber', language)}
                  </label>
                  <Input
                    type="text"
                    placeholder={t('enterPersonalNumber', language)}
                    value={patientId}
                    onChange={handlePatientIdChange}
                    className="bg-gray-700/50 border-gray-600 text-white placeholder-gray-400"
                    pattern="^[0-9]{2,12}$"
                    title={language === 'ar' ? 'الرقم العسكري يجب أن يتكون من 2 إلى 12 رقمًا' : 'Military number must be 2-12 digits'}
                    minLength={2}
                    maxLength={12}
                    required
                    data-testid="patient-id-input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    {t('gender', language)}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant={gender === 'male' ? 'gradient' : 'outline'}
                      className={`h-12 ${gender === 'male' ? '' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                      onClick={() => setGender('male')}
                      data-testid="patient-gender-male-button"
                    >
                      {t('male', language)}
                    </Button>
                    <Button
                      type="button"
                      variant={gender === 'female' ? 'gradient' : 'outline'}
                      className={`h-12 ${gender === 'female' ? '' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                      onClick={() => setGender('female')}
                      data-testid="patient-gender-female-button"
                    >
                      {t('female', language)}
                    </Button>
                  </div>
                </div>

                {gender === 'female' && (
                  <div className="bg-pink-900/30 border-2 border-pink-500/50 rounded-xl p-4 text-center" data-testid="female-note-card">
                    <div className="text-pink-300 text-lg font-bold mb-2">{language === 'ar' ? 'ملاحظة مهمة' : 'Important note'}</div>
                    <div className="text-pink-200 text-sm leading-relaxed">
                      يرجى التسجيل في <span className="font-bold">استقبال المركز الطبي التخصصي العسكري الرئيسي</span> قبل البدء بالفحوصات
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full h-12 text-lg font-semibold"
                  disabled={loading || !patientId.trim()}
                  data-testid="patient-login-submit-button"
                >
                  {loading
                    ? (language === 'ar' ? 'جاري المعالجة...' : 'Processing...')
                    : (language === 'ar' ? 'متابعة' : 'Continue')}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRoleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {language === 'ar' ? 'اسم المستخدم' : 'Username'}
                  </label>
                  <Input
                    type="text"
                    placeholder={language === 'ar' ? 'أدخل اسم المستخدم' : 'Enter username'}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-gray-700/50 border-gray-600 text-white placeholder-gray-400"
                    required
                    data-testid={`${mode}-username-input`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {language === 'ar' ? 'كلمة المرور' : 'Password'}
                  </label>
                  <Input
                    type="password"
                    placeholder={language === 'ar' ? 'أدخل كلمة المرور' : 'Enter password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-gray-700/50 border-gray-600 text-white placeholder-gray-400"
                    required
                    data-testid={`${mode}-password-input`}
                  />
                </div>

                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full h-12 text-lg font-semibold"
                  disabled={loading || !username.trim() || !password.trim()}
                  data-testid={`${mode}-login-submit-button`}
                >
                  {loading
                    ? (language === 'ar' ? 'جاري التحقق...' : 'Verifying...')
                    : (language === 'ar' ? 'دخول' : 'Login')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
