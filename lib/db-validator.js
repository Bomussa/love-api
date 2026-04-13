// Database Validator - Verify data exists before operations
// Critical: All operations must validate data first

/**
 * Validate patient exists and has active path
 */
export async function validatePatient(env, patientId) {
  const pathKey = `path:${patientId}`;
  const path = await env.KV_ADMIN.get(pathKey, 'json');

  if (!path) {
    return {
      valid: false,
      error: 'المراجع غير مسجل في النظام',
      code: 'PATIENT_NOT_FOUND',
    };
  }

  if (!path.route || path.route.length === 0) {
    return {
      valid: false,
      error: 'مسار المراجع غير محدد',
      code: 'PATH_NOT_DEFINED',
    };
  }

  return {
    valid: true,
    path,
  };
}

/**
 * Validate clinic exists in patient's path
 */
export async function validateClinicInPath(env, patientId, clinic) {
  const validation = await validatePatient(env, patientId);
  if (!validation.valid) {
    return validation;
  }

  const { path } = validation;

  if (!path.route.includes(clinic)) {
    return {
      valid: false,
      error: `العيادة ${clinic} غير موجودة في مسار المراجع`,
      code: 'CLINIC_NOT_IN_PATH',
      allowedClinics: path.route,
    };
  }

  return {
    valid: true,
    path,
  };
}

/**
 * Validate patient is in queue for specific clinic
 */
export async function validatePatientInQueue(env, patientId, clinic) {
  const userKey = `queue:user:${clinic}:${patientId}`;
  const userEntry = await env.KV_QUEUES.get(userKey, 'json');

  if (!userEntry) {
    return {
      valid: false,
      error: 'المراجع غير موجود في طابور هذه العيادة',
      code: 'NOT_IN_QUEUE',
    };
  }

  return {
    valid: true,
    entry: userEntry,
  };
}

/**
 */
  const today = new Date().toISOString().split('T')[0];

    return {
      valid: false,
    };
  }

    return {
      valid: false,
    };
  }


    return {
      valid: false,
    };
  }

    if (otherClinic !== clinic) {
        return {
          valid: false,
          correctClinic: otherClinic,
        };
      }
    }
  }

  return {
    valid: true,
  };
}

/**
 * Validate queue number matches
 */
export async function validateQueueNumber(env, patientId, clinic, queueNumber) {
  const validation = await validatePatientInQueue(env, patientId, clinic);
  if (!validation.valid) {
    return validation;
  }

  const userEntry = validation.entry;
  const expectedNumber = userEntry.number;
  const providedNumber = parseInt(queueNumber);

  if (expectedNumber !== providedNumber) {
    return {
      valid: false,
      error: 'رقم الطابور غير صحيح',
      code: 'INCORRECT_QUEUE_NUMBER',
      expected: expectedNumber,
      provided: providedNumber,
    };
  }

  return {
    valid: true,
    entry: userEntry,
  };
}

/**
 * Validate patient can enter clinic (is it next in path?)
 */
export async function validateCanEnterClinic(env, patientId, clinic) {
  const validation = await validateClinicInPath(env, patientId, clinic);
  if (!validation.valid) {
    return validation;
  }

  const { path } = validation;
  const currentIndex = path.current_index || 0;
  const expectedClinic = path.route[currentIndex];

  if (clinic !== expectedClinic) {
    return {
      valid: false,
      error: `يجب إكمال ${expectedClinic} أولاً قبل الانتقال إلى ${clinic}`,
      code: 'WRONG_SEQUENCE',
      expectedClinic,
      currentIndex,
    };
  }

  // Check if previous clinic was completed
  if (currentIndex > 0) {
    const previousClinic = path.route[currentIndex - 1];
    const previousCompleted = path.progress?.some(
    );

    if (!previousCompleted) {
      return {
        valid: false,
        code: 'PREVIOUS_NOT_COMPLETED',
        previousClinic,
      };
    }
  }

  return {
    valid: true,
    path,
  };
}

/**
 */
  // 1. Validate patient exists
  const patientValidation = await validatePatient(env, patientId);
  if (!patientValidation.valid) {
    return patientValidation;
  }

  // 2. Validate clinic in path
  const clinicValidation = await validateClinicInPath(env, patientId, clinic);
  if (!clinicValidation.valid) {
    return clinicValidation;
  }

  // 3. Validate patient in queue
  const queueValidation = await validatePatientInQueue(env, patientId, clinic);
  if (!queueValidation.valid) {
    return queueValidation;
  }

  // 4. Validate queue number
  const numberValidation = await validateQueueNumber(env, patientId, clinic, queueNumber);
  if (!numberValidation.valid) {
    return numberValidation;
  }

  }

  return {
    valid: true,
    path: patientValidation.path,
    entry: queueValidation.entry,
  };
}

/**
 * Complete validation for queue enter operation
 */
export async function validateQueueEnter(env, patientId, clinic) {
  // 1. Validate patient exists
  const patientValidation = await validatePatient(env, patientId);
  if (!patientValidation.valid) {
    return patientValidation;
  }

  // 2. Validate can enter this clinic
  const enterValidation = await validateCanEnterClinic(env, patientId, clinic);
  if (!enterValidation.valid) {
    return enterValidation;
  }

  return {
    valid: true,
    path: patientValidation.path,
  };
}
