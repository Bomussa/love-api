/**
 * Legacy local admin configuration placeholder.
 *
 * Authentication is now handled exclusively by the backend using runtime
 * secrets, so this file intentionally contains no credentials.
 */
export const ADMIN_CREDENTIALS = {
  username: '',
  roles: ['admin'],
  permissions: ['dashboard', 'queue_management', 'doctor_management']
}

/**
 * Local credential validation is permanently disabled.
 */
export function validateAdminCredentials() {
  return false
}

/**
 * Retained for compatibility with older imports.
 */
export function hasPermission(permission) {
  return ADMIN_CREDENTIALS.permissions.includes(permission)
}

export default ADMIN_CREDENTIALS
