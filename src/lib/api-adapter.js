/**
 * Legacy adapter stub.
 *
 * The application now talks directly to the unified backend service. Any legacy
 * consumer importing this file receives a clear failure instead of silently
 * switching to a second data source.
 */
class APIAdapter {
  fail() {
    throw new Error('Legacy adapter disabled. Use src/lib/api-unified.js instead.')
  }

  issuePin() { return this.fail() }
  validatePin() { return this.fail() }
  enterQueue() { return this.fail() }
  completeQueue() { return this.fail() }
  getQueueStatus() { return this.fail() }
  assignRoute() { return this.fail() }
  getRoute() { return this.fail() }
  unlockNextStep() { return this.fail() }
  getClinics() { return this.fail() }
  getHealth() { return this.fail() }
  connectToEvents() { return null }
  getStatus() { return { currentMode: 'disabled', features: {} } }
}

const apiAdapter = new APIAdapter()

export default apiAdapter

