/**
 * Helper Functions - وظائف مساعدة مشتركة
 */

// CORS Headers
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Version',
  'Access-Control-Max-Age': '86400',
};

// JSON Response Helper
export function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

// Generate Unique Number
export function generateUniqueNumber() {
  const now = new Date();
  const timestamp = now.getTime();
  const random = Math.floor(Math.random() * 10000);
  return parseInt(`${timestamp}${random}`);
}

// PIN system permanently removed

// Validate Patient ID
export function validatePatientId(patientId) {
  return /^\d{2,12}$/.test(patientId);
}

// Validate Gender
export function validateGender(gender) {
  return ['male', 'female'].includes(gender);
}

// Validate Clinic
export function validateClinic(clinic) {
  const validClinics = [
    'lab', 'xray', 'vitals', 'ecg', 'audio', 'eyes',
    'internal', 'ent', 'surgery', 'dental', 'psychiatry',
    'derma', 'bones'
  ];
  return validClinics.includes(clinic.toLowerCase());
}

// Get all valid clinics
export function getValidClinics() {
  return [
    'lab', 'xray', 'vitals', 'ecg', 'audio', 'eyes',
    'internal', 'ent', 'surgery', 'dental', 'psychiatry',
    'derma', 'bones'
  ];
}

// Get Client IP
export function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
         req.headers['x-real-ip'] ||
         req.socket?.remoteAddress ||
         'unknown';
}
