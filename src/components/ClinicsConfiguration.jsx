import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './Card'
import { Button } from './Button'
import { Input } from './Input'
import { KeyRound, Shield, Trash2, UserPlus } from 'lucide-react'
import api from '../lib/api'

/**
 * Doctor management module used inside the admin dashboard.
 *
 * The original clinic-configuration screen was repurposed to satisfy the new
 * simplified scope without introducing another file.
 */
export function DoctorManagement({ token, doctors = [], clinics = [], onChange, language }) {
  const [form, setForm] = useState({ displayName: '', username: '', password: '', clinicId: '' })
  const [passwordDrafts, setPasswordDrafts] = useState({})
  const [feedback, setFeedback] = useState(null)
  const [busyKey, setBusyKey] = useState('')

  const clinicOptions = useMemo(() => clinics.map((clinic) => ({
    id: clinic.id,
    name: clinic.name
  })), [clinics])

  const showFeedback = (message, tone = 'success') => {
    setFeedback({ message, tone })
    window.setTimeout(() => setFeedback(null), 2500)
  }

  const runAction = async (key, action) => {
    setBusyKey(key)
    try {
      await action()
      await onChange?.()
    } catch (error) {
      showFeedback(error.message, 'error')
    } finally {
      setBusyKey('')
    }
  }

  const handleCreateDoctor = async (event) => {
    event.preventDefault()
    await runAction('create-doctor', async () => {
      await api.createDoctor(token, form)
      setForm({ displayName: '', username: '', password: '', clinicId: '' })
      showFeedback(language === 'ar' ? 'تم إنشاء الطبيب بنجاح' : 'Doctor created successfully')
    })
  }

  return (
    <div className="space-y-6" data-testid="doctor-management-panel">
      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 ${feedback.tone === 'error' ? 'border-red-400 bg-red-500/15 text-red-100' : 'border-green-400 bg-green-500/15 text-green-100'}`}
          data-testid="doctor-management-feedback"
        >
          {feedback.message}
        </div>
      )}

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <UserPlus className="h-5 w-5 text-secondary" />
            {language === 'ar' ? 'إنشاء طبيب / عيادة' : 'Create Doctor / Clinic'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleCreateDoctor}>
            <Input
              value={form.displayName}
              onChange={(event) => setForm((previous) => ({ ...previous, displayName: event.target.value }))}
              placeholder={language === 'ar' ? 'اسم الطبيب' : 'Doctor name'}
              className="bg-gray-700/40 border-gray-600 text-white"
              data-testid="doctor-create-display-name-input"
              required
            />
            <Input
              value={form.username}
              onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
              placeholder={language === 'ar' ? 'اسم المستخدم' : 'Username'}
              className="bg-gray-700/40 border-gray-600 text-white"
              data-testid="doctor-create-username-input"
              required
            />
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
              placeholder={language === 'ar' ? 'كلمة المرور' : 'Password'}
              className="bg-gray-700/40 border-gray-600 text-white"
              data-testid="doctor-create-password-input"
              required
            />
            <select
              value={form.clinicId}
              onChange={(event) => setForm((previous) => ({ ...previous, clinicId: event.target.value }))}
              className="flex h-10 rounded-md border border-gray-600 bg-gray-700/40 px-3 py-2 text-sm text-white"
              data-testid="doctor-create-clinic-select"
              required
            >
              <option value="">{language === 'ar' ? 'اختر العيادة' : 'Select clinic'}</option>
              {clinicOptions.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
              ))}
            </select>
            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <Button type="submit" variant="gradient" data-testid="doctor-create-submit-button" disabled={busyKey === 'create-doctor'}>
                {busyKey === 'create-doctor'
                  ? (language === 'ar' ? 'جاري الإنشاء...' : 'Creating...')
                  : (language === 'ar' ? 'إنشاء الطبيب' : 'Create doctor')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{language === 'ar' ? 'الأطباء الحاليون' : 'Current doctors'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {doctors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-600 px-4 py-6 text-center text-gray-300" data-testid="doctor-empty-state">
              {language === 'ar' ? 'لا توجد حسابات أطباء بعد.' : 'No doctor accounts yet.'}
            </div>
          ) : doctors.map((doctor) => {
            const draftPassword = passwordDrafts[doctor.id] || ''
            const freezeKey = `freeze-${doctor.id}`
            const passwordKey = `password-${doctor.id}`
            const deleteKey = `delete-${doctor.id}`

            return (
              <div key={doctor.id} className="rounded-xl border border-gray-700 bg-gray-900/40 p-4" data-testid={`doctor-card-${doctor.id}`}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="text-lg font-semibold text-white" data-testid={`doctor-name-${doctor.id}`}>{doctor.displayName}</div>
                    <div className="text-sm text-gray-300" data-testid={`doctor-username-${doctor.id}`}>{doctor.username}</div>
                    <div className="text-sm text-gray-300" data-testid={`doctor-clinic-${doctor.id}`}>{doctor.clinicName}</div>
                    <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${doctor.isFrozen ? 'bg-red-500/20 text-red-200' : 'bg-green-500/20 text-green-200'}`} data-testid={`doctor-status-${doctor.id}`}>
                      {doctor.isFrozen
                        ? (language === 'ar' ? 'مجمّد' : 'Frozen')
                        : (language === 'ar' ? 'نشط' : 'Active')}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] xl:min-w-[38rem]">
                    <Input
                      type="password"
                      value={draftPassword}
                      onChange={(event) => setPasswordDrafts((previous) => ({ ...previous, [doctor.id]: event.target.value }))}
                      placeholder={language === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}
                      className="bg-gray-700/40 border-gray-600 text-white"
                      data-testid={`doctor-password-input-${doctor.id}`}
                    />
                    <Button
                      variant="outline"
                      className="border-gray-600 text-white"
                      onClick={() => runAction(passwordKey, async () => {
                        await api.updateDoctorPassword(token, doctor.id, draftPassword)
                        setPasswordDrafts((previous) => ({ ...previous, [doctor.id]: '' }))
                        showFeedback(language === 'ar' ? 'تم تحديث كلمة المرور' : 'Password updated')
                      })}
                      data-testid={`doctor-password-update-button-${doctor.id}`}
                      disabled={!draftPassword || busyKey === passwordKey}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="border-gray-600 text-white"
                      onClick={() => runAction(freezeKey, async () => {
                        await api.toggleDoctorFreeze(token, doctor.id)
                        showFeedback(doctor.isFrozen
                          ? (language === 'ar' ? 'تم إلغاء التجميد' : 'Doctor unfrozen')
                          : (language === 'ar' ? 'تم تجميد الطبيب' : 'Doctor frozen'))
                      })}
                      data-testid={`doctor-freeze-button-${doctor.id}`}
                      disabled={busyKey === freezeKey}
                    >
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="border-red-400 text-red-200"
                      onClick={() => runAction(deleteKey, async () => {
                        await api.deleteDoctor(token, doctor.id)
                        showFeedback(language === 'ar' ? 'تم حذف الطبيب' : 'Doctor deleted')
                      })}
                      data-testid={`doctor-delete-button-${doctor.id}`}
                      disabled={busyKey === deleteKey}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

export const ClinicsConfiguration = DoctorManagement
