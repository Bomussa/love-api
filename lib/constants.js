// مصدر الحقيقة الوحيد للـ clinics

export const CLINICS = {
  VITALS: 'BIO',
  LAB: 'LAB',
  XRAY: 'XR',
  EYES: 'EYE',
  INTERNAL: 'INT',
  SURGERY: 'SUR',
  ENT: 'ENT',
  PSYCHIATRY: 'PSY',
  DENTAL: 'DNT',
};

export const CLINIC_FLOW = {
  recruitment_male: [
    'BIO',
    'LAB',
    'XR',
    'EYE',
    'INT',
    'SUR',
    'ENT',
    'PSY',
    'DNT'
  ]
};
