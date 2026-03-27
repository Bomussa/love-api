/**
 * Pin Service for MMC-MMS
 * Logic for daily PIN generation (2-99)
 * Valid from 05:00 AM to 12:00 AM (Midnight)
 */

const generatePinCode = (min = 2, max = 99) => {
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

const getServiceDayBoundaries = () => {
  const now = new Date();
  // Service day starts at 05:00 AM
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0);
  // Service day ends at 12:00 AM (Midnight)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  
  // If current time is before 05:00 AM, the "service day" hasn't started yet
  // or it belongs to the previous calendar day's late session (but here we strictly start at 5 AM)
  return { start, end };
};

const getTodayDateKey = () => {
  const { start } = getServiceDayBoundaries();
  const now = new Date();
  
  // If it's before 5 AM, we are technically in the "no-service" zone or previous day
  // But for the sake of daily keys, if we are after midnight but before 5 AM, 
  // we might want to return the previous date if we consider the day to end at 5 AM.
  // HOWEVER, the user said "starts 5 AM and ends 12 PM (Midnight)".
  // So between 12 AM and 5 AM, there should be NO active PINs.
  
  return now.toISOString().split('T')[0];
};

const isWithinServiceHours = () => {
  const now = new Date();
  const { start, end } = getServiceDayBoundaries();
  return now >= start && now <= end;
};

const findLatestValidPin = async (db, clinicId, pin = null) => {
  const now = new Date();
  const { start, end } = getServiceDayBoundaries();
  
  if (!isWithinServiceHours()) {
    return null;
  }

  let query = db
    .from('pins')
    .select('id, clinic_id, pin, valid_until, used_at, created_at')
    .eq('clinic_id', clinicId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .gt('valid_until', now.toISOString());

  if (pin) query = query.eq('pin', pin);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
};

const generateDailyPin = async (db, clinicId) => {
  if (!isWithinServiceHours()) {
    throw new Error('OUT_OF_SERVICE_HOURS');
  }

  const existingPin = await findLatestValidPin(db, clinicId);
  if (existingPin) {
    return { pinRecord: existingPin, isExisting: true };
  }

  const { start, end } = getServiceDayBoundaries();

  const { data, error } = await db
    .from('pins')
    .insert({
      clinic_id: clinicId,
      pin: generatePinCode(2, 99),
      valid_until: end.toISOString(),
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw error;

  // Sync to clinics table for legacy display
  await db
    .from('clinics')
    .update({ pin_code: data.pin })
    .eq('id', clinicId);

  return { pinRecord: data, isExisting: false };
};

const verifyPin = async (db, clinicId, pin) => {
  if (!isWithinServiceHours()) {
    return { valid: false, error: 'OUT_OF_SERVICE_HOURS' };
  }

  const pinRecord = await findLatestValidPin(db, clinicId, pin);
  if (!pinRecord) {
    return { valid: false, pinRecord: null };
  }

  const now = new Date().toISOString();

  if (!pinRecord.used_at) {
    const { error: updateError } = await db
      .from('pins')
      .update({ used_at: now })
      .eq('id', pinRecord.id);

    if (updateError) throw updateError;

    pinRecord.used_at = now;
  }

  return { valid: true, pinRecord };
};

const getPinStatus = async (db, clinicId) => {
  const pinRecord = await findLatestValidPin(db, clinicId);

  if (!pinRecord) {
    return { hasActivePin: false, pinRecord: null };
  }

  return { hasActivePin: true, pinRecord };
};

const assertPinValidForQueueAction = async (db, clinicId, pin) => {
  const pinRecord = await findLatestValidPin(db, clinicId, pin);
  return !!pinRecord;
};

module.exports = { generatePinCode, getServiceDayBoundaries, isWithinServiceHours };