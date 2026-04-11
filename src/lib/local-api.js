/**
 * Local fallback removed.
 *
 * This module is kept only to prevent broken imports in legacy branches. Any
 * attempt to use it now fails fast so the application cannot drift away from
 * the real backend again.
 */
class LocalApiService {
  fail() {
    throw new Error('Local API fallback removed. Use the unified backend service.')
  }

  patientLogin() { return this.fail() }
  enterQueue() { return this.fail() }
  getQueueStatus() { return this.fail() }
  queueDone() { return this.fail() }
  callNextPatient() { return this.fail() }
  getPinStatus() { return this.fail() }
  choosePath() { return this.fail() }
  getAdminStatus() { return this.fail() }
  getQueues() { return this.fail() }
  getDashboardStats() { return this.fail() }
  getHealthStatus() { return this.fail() }
  enterClinic() { return this.fail() }
  completeClinic() { return this.fail() }
  selectExam() { return this.fail() }
  getClinics() { return this.fail() }
}

const localApi = new LocalApiService()

export default localApi
export { localApi }
