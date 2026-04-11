import { createClient } from '@supabase/supabase-js'
import { getApiBase } from './api-base'

const API_BASE = getApiBase()
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').toString().trim()
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').toString().trim()

/**
 * Central frontend API client.
 *
 * The service enforces a single data source: the real backend. It also exposes
 * the Supabase realtime subscription used by admin, doctor, and patient views.
 */
class UnifiedApiService {
  constructor() {
    this.supabase = SUPABASE_URL && SUPABASE_ANON_KEY
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null
  }

  /**
   * Builds request headers and injects the optional bearer token.
   *
   * @param {string | null} token
   * @param {HeadersInit | undefined} extraHeaders
   * @returns {Record<string, string>}
   */
  buildHeaders(token, extraHeaders) {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {})
    }
  }

  /**
   * Executes an HTTP request against the Vercel API and validates the contract.
   *
   * @param {string} path
   * @param {RequestInit & { token?: string | null }} [options]
   * @returns {Promise<any>}
   * @throws {Error} When the backend returns `success: false` or non-2xx status.
   */
  async request(path, options = {}) {
    const { token = null, headers, ...rest } = options
    const response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: this.buildHeaders(token, headers)
    })

    const payload = await response.json().catch(() => ({
      success: false,
      error: 'تعذر قراءة استجابة الخادم'
    }))

    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || 'تعذر إتمام الطلب')
    }

    return payload?.data ?? payload
  }

  /**
   * Registers or restores a patient journey and opens the first clinic queue.
   */
  async patientLogin(patientId, gender, examType) {
    return this.request('/patient/login', {
      method: 'POST',
      body: JSON.stringify({ patientId, gender, examType })
    })
  }

  /**
   * Signs in the administrator using the backend-managed secret.
   */
  async adminLogin(username, password) {
    return this.request('/admin/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'admin_login', username, password })
    })
  }

  /**
   * Signs in a doctor account created from the admin dashboard.
   */
  async doctorLogin(username, password) {
    return this.request('/admin/status', {
      method: 'POST',
      body: JSON.stringify({ action: 'doctor_login', username, password })
    })
  }

  /**
   * Loads the admin dashboard payload.
   */
  async getAdminDashboard(token) {
    return this.request('/admin/status', { token })
  }

  /**
   * Creates a doctor or clinic assignment.
   */
  async createDoctor(token, payload) {
    return this.request('/admin/status', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'create_doctor', ...payload })
    })
  }

  /**
   * Updates a doctor's password.
   */
  async updateDoctorPassword(token, doctorId, password) {
    return this.request('/admin/status', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'update_doctor_password', doctorId, password })
    })
  }

  /**
   * Toggles doctor freeze state.
   */
  async toggleDoctorFreeze(token, doctorId) {
    return this.request('/admin/status', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'toggle_doctor_freeze', doctorId })
    })
  }

  /**
   * Soft-deletes a doctor account from the active roster.
   */
  async deleteDoctor(token, doctorId) {
    return this.request('/admin/status', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'delete_doctor', doctorId })
    })
  }

  /**
   * Retrieves a patient-facing queue snapshot.
   */
  async getPatientJourney(patientId) {
    return this.request(`/queue/status?patientId=${encodeURIComponent(patientId)}`)
  }

  /**
   * Retrieves a doctor-facing queue snapshot.
   */
  async getDoctorDashboard(token, doctorId) {
    return this.request(`/queue/status?doctorId=${encodeURIComponent(doctorId)}`, { token })
  }

  /**
   * Retrieves the current queue position for a patient at one clinic.
   */
  async getQueuePosition(clinicId, patientId) {
    return this.request(
      `/queue/position?clinic=${encodeURIComponent(clinicId)}&user=${encodeURIComponent(patientId)}`
    )
  }

  /**
   * Calls the next patient for a clinic.
   */
  async callNextPatient(token, payload) {
    return this.request('/queue/call', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'call_next', ...payload })
    })
  }

  /**
   * Completes the current patient and advances the route.
   */
  async completePatient(token, payload) {
    return this.request('/queue/done', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'complete_patient', ...payload })
    })
  }

  /**
   * Marks the active patient absent.
   */
  async markAbsent(token, payload) {
    return this.request('/queue/call', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'mark_absent', ...payload })
    })
  }

  /**
   * Transfers a patient to another clinic.
   */
  async transferPatient(token, payload) {
    return this.request('/queue/call', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'transfer_patient', ...payload })
    })
  }

  /**
   * Moves a patient to the end of the same clinic queue.
   */
  async postponePatient(token, payload) {
    return this.request('/queue/call', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'postpone_patient', ...payload })
    })
  }

  /**
   * Prioritises a waiting or skipped patient so they are called next.
   */
  async vipFastTrack(token, payload) {
    return this.request('/queue/call', {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'vip_fast_track', ...payload })
    })
  }

  /**
   * Returns a simple backend status payload.
   */
  async getHealthStatus() {
    return this.request('/status')
  }

  /**
   * Subscribes to the canonical queue channel.
   *
   * @param {{ clinicId?: string, patientId?: string }} filters
   * @param {(payload: any) => void} onChange
   * @returns {{ unsubscribe: () => void }}
   */
  subscribeToQueue(filters, onChange) {
    if (!this.supabase) {
      return { unsubscribe: () => {} }
    }

    const scope = filters?.patientId || filters?.clinicId || 'global'
    const channel = this.supabase.channel(`unified_queue:${scope}`)

    const queueFilter = filters?.patientId
      ? `patient_id=eq.${filters.patientId}`
      : filters?.clinicId
        ? `clinic=eq.${filters.clinicId}`
        : undefined

    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'queue',
      ...(queueFilter ? { filter: queueFilter } : {})
    }, onChange)

    if (filters?.patientId) {
      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'patients',
        filter: `patient_id=eq.${filters.patientId}`
      }, onChange)
    }

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('Realtime subscription failed for unified_queue channel')
      }
    })

    return {
      unsubscribe: () => {
        this.supabase.removeChannel(channel)
      }
    }
  }
}

const api = new UnifiedApiService()

export default api
export { api }
