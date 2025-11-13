// @ts-nocheck


import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?dts";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};

// Allow alternative env names to bypass CLI restriction on SUPABASE_* prefixes
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase configuration", { hasUrl: Boolean(SUPABASE_URL), hasKey: Boolean(SUPABASE_SERVICE_ROLE_KEY) });
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for api-router");
}

const WAITING_STATES = ["waiting"] as const;
const ACTIVE_STATES = ["waiting", "called", "in_service", "in_progress"] as const;
const COMPLETED_STATE = "completed";
const CANCELLED_STATE = "cancelled";

interface PatientSession {
    id: string;
    patient_id: string;
    expires_at: string | null;
    status?: string | null;
    patients?: {
        id: string;
        name: string | null;
        military_id: string | null;
        gender: string | null;
    } | null;
}

interface QueueEntry {
    id: string;
    clinic: string;
    patient_id: string;
    queue_number: string | null;
    position: number | null;
    status: string | null;
    priority: string | null;
    entered_at: string | null;
    called_at?: string | null;
    completed_at?: string | null;
    patients?: {
        id: string;
        name: string | null;
        military_id: string | null;
        gender: string | null;
    } | null;
}

interface PinRecord {
    clinic: string; // clinic code
    pin: string;
    date: string | null;
    created_at: string | null;
    expires_at: string | null;
}

type JsonRecord = Record<string, unknown> | null | undefined;

type Maybe<T> = T | null;

type ClinicRecord = {
    id: string;
    code?: string | null;
    slug?: string | null;
    name?: string | null;
    name_ar?: string | null;
    type?: string | null;
    requires_pin?: boolean | null;
    is_active?: boolean | null;
};

interface QueueSummary {
    id: string;
    name: string;
    status: string;
    currentPatients: number;
    activePatients: number;
    lastUpdate: string;
}

function supabase(): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

function errorResponse(message: string, status = 400, details?: Record<string, unknown>): Response {
    return jsonResponse({ success: false, error: message, ...(details ?? {}) }, status);
}

function extractPath(url: URL): string {
    const override = url.searchParams.get("path");
    if (override) {
        return override.replace(/^\/+/, "");
    }
    const pathname = url.pathname.replace(/^\/+/, "");
    if (!pathname) return "";
    const segments = pathname.split("/");
    if (segments[0] === "api-router") {
        return segments.slice(1).join("/");
    }
    return pathname;
}

function nowIso(): string {
    return new Date().toISOString();
}

function startOfTodayIso(): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}

function normalizeGender(value: unknown): "male" | "female" {
    return value === "female" ? "female" : "male";
}

async function readJsonBody<T>(req: Request): Promise<T> {
    try {
        return (await req.json()) as T;
    } catch {
        return {} as T;
    }
}

// Helper: safe exact count that never throws; returns 0 on error
async function safeCount(
    client: SupabaseClient,
    table: string,
    build?: (q: any) => any
): Promise<number> {
    try {
        let q: any = client.from(table).select("id", { head: true, count: "exact" });
        if (build) q = build(q);
        const { count, error } = await q;
        if (error) return 0;
        return count ?? 0;
    } catch {
        return 0;
    }
}

async function getSessionById(client: SupabaseClient, sessionId: string): Promise<Maybe<PatientSession>> {
    const response = await client
        .from("patient_sessions")
        .select("id, patient_id, expires_at, status, patients(id, name, military_id, gender)")
        .eq("id", sessionId)
        .gte("expires_at", nowIso())
        .maybeSingle();

    if (response.error && response.error.code !== "PGRST116") {
        throw response.error;
    }

    return response.data ?? null;
}

async function ensurePatient(client: SupabaseClient, militaryId: string, gender: string): Promise<{ id: string; gender: string; name: string | null }> {
    const existing = await client
        .from("patients")
        .select("id, name, gender")
        .eq("military_id", militaryId)
        .maybeSingle();

    if (existing.error && existing.error.code !== "PGRST116") {
        throw existing.error;
    }

    if (existing.data) {
        const genderValue = existing.data.gender ?? gender;
        if (!existing.data.gender || existing.data.gender !== genderValue) {
            await client
                .from("patients")
                .update({ gender: genderValue })
                .eq("id", existing.data.id);
        }
        return { id: existing.data.id, gender: genderValue, name: existing.data.name ?? null };
    }

    const inferredName = `مراجع ${militaryId.slice(-4)}`;
    const insert = await client
        .from("patients")
        .insert({
            military_id: militaryId,
            gender,
            name: inferredName,
            created_at: nowIso()
        })
        .select("id, name, gender")
        .single();

    if (insert.error) {
        throw insert.error;
    }

    return { id: insert.data.id, gender: insert.data.gender ?? gender, name: insert.data.name ?? inferredName };
}

async function createSession(client: SupabaseClient, patientId: string): Promise<PatientSession> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const insert = await client
        .from("patient_sessions")
        .insert({
            id: sessionId,
            patient_id: patientId,
            token: sessionId,
            status: "active",
            created_at: nowIso(),
            expires_at: expiresAt
        })
        .select("id, patient_id, expires_at")
        .single();

    if (insert.error) {
        throw insert.error;
    }

    return {
        id: insert.data.id,
        patient_id: insert.data.patient_id,
        expires_at: insert.data.expires_at,
        patients: null
    };
}

async function nextQueuePosition(client: SupabaseClient, clinic: string): Promise<number> {
    const latest = await client
        .from("queues")
        .select("position")
        .eq("clinic", clinic)
        .order("position", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

    if (latest.error && latest.error.code !== "PGRST116") {
        throw latest.error;
    }

    const lastPosition = latest.data?.position ?? 0;
    return (lastPosition ?? 0) + 1;
}

async function countWaiting(client: SupabaseClient, clinic: string): Promise<number> {
    const { count, error } = await client
        .from("queues")
        .select("id", { head: true, count: "exact" })
        .eq("clinic", clinic)
        .in("status", WAITING_STATES as unknown as string[]);

    if (error) throw error;
    return count ?? 0;
}

async function fetchQueueEntries(client: SupabaseClient, clinic: string, statuses: readonly string[]): Promise<QueueEntry[]> {
    // Try with embedded relation first; fallback to plain select if relation is missing
    let response = await client
        .from("queues")
        .select(
            "id, clinic, patient_id, queue_number, position, status, priority, entered_at, called_at, completed_at, patients(id, name, military_id, gender)"
        )
        .eq("clinic", clinic)
        .in("status", statuses as unknown as string[])
        .order("position", { ascending: true, nullsFirst: true });

    if (response.error) {
        // Fallback without relation when FK not defined
        const plain = await client
            .from("queues")
            .select("id, clinic, patient_id, queue_number, position, status, priority, entered_at, called_at, completed_at")
            .eq("clinic", clinic)
            .in("status", statuses as unknown as string[])
            .order("position", { ascending: true, nullsFirst: true });
        if (plain.error) throw plain.error;
        return (plain.data ?? []) as QueueEntry[];
    }

    return (response.data ?? []) as QueueEntry[];
}

async function fetchTodaysPin(client: SupabaseClient, clinic: string): Promise<PinRecord | null> {
    const today = startOfTodayIso().slice(0, 10);

    // مصدر 1: جدول pins بالمخطط (clinic_code, is_active)
    let p = await client
        .from("pins")
        .select("clinic_code, pin, created_at, expires_at, is_active")
        .eq("clinic_code", clinic)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (p.error && p.error.code !== "PGRST116") throw p.error;
    if (p.data) {
        const d = p.data as { clinic_code: string; pin: string; created_at: string | null; expires_at: string | null };
        return { clinic: d.clinic_code, pin: d.pin, date: d.created_at ? d.created_at.slice(0, 10) : null, created_at: d.created_at, expires_at: d.expires_at };
    }

    // مصدر 2: جدول clinic_pins (clinic_id, valid_day, active) باستخدام معرف العيادة إذا كان UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinic);
    if (isUuid) {
        const cp = await client
            .from("clinic_pins")
            .select("clinic_id, pin, valid_day, created_at")
            .eq("clinic_id", clinic)
            .eq("valid_day", today)
            .eq("active", true)
            .maybeSingle();

        if (cp.error && cp.error.code !== "PGRST116") throw cp.error;
        if (!cp.data) return null;

        return {
            clinic,
            pin: (cp.data as { pin: string }).pin,
            date: (cp.data as { valid_day: string | null }).valid_day ?? today,
            created_at: (cp.data as { created_at: string | null }).created_at ?? null,
            expires_at: null
        };
    }

    return null;
}

function pinPayload(pin: PinRecord): Record<string, unknown> {
    const isExpired = pin.expires_at ? new Date(pin.expires_at) < new Date() : false;
    return {
        pin: pin.pin,
        clinic: pin.clinic,
        date: pin.date,
        generatedAt: pin.created_at,
        expiresAt: pin.expires_at,
        active: !isExpired
    };
}

async function ensureValidPin(client: SupabaseClient, clinic: string, value: string): Promise<void> {
    const pin = await fetchTodaysPin(client, clinic);
    if (!pin || pin.pin !== String(value)) {
        throw Object.assign(new Error("Invalid PIN"), { status: 403 });
    }
    if (pin.expires_at && new Date(pin.expires_at) < new Date()) {
        throw Object.assign(new Error("PIN expired"), { status: 403 });
    }
}

async function queuePositionPayload(client: SupabaseClient, clinic: string, patientId: string): Promise<{ display_number: number; ahead: number; total_waiting: number; status: string | null; queue_number: string | null }> {
    const activeEntry = await client
        .from("queues")
        .select("id, position, status, queue_number")
        .eq("clinic", clinic)
        .eq("patient_id", patientId)
        .in("status", ACTIVE_STATES as unknown as string[])
        .order("entered_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (activeEntry.error && activeEntry.error.code !== "PGRST116") {
        throw activeEntry.error;
    }

    const displayNumber = activeEntry.data?.position ?? -1;

    const aheadQuery = await client
        .from("queues")
        .select("id", { head: true, count: "exact" })
        .eq("clinic", clinic)
        .eq("status", "waiting")
        .lt("position", activeEntry.data?.position ?? 0);

    const totalWaiting = await countWaiting(client, clinic);

    const ahead = aheadQuery.count ?? 0;

    return {
        display_number: displayNumber,
        ahead: Math.max(0, ahead),
        total_waiting: totalWaiting,
        status: activeEntry.data?.status ?? null,
        queue_number: activeEntry.data?.queue_number ?? null
    };
}

async function handlePatientLogin(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ patientId?: string; gender?: string }>(req);
    const patientId = String(body.patientId ?? "").trim();
    const gender = normalizeGender(body.gender);

    if (!patientId) {
        return errorResponse("patientId is required", 400);
    }

    const patient = await ensurePatient(client, patientId, gender);
    const session = await createSession(client, patient.id);

    const payload = {
        id: session.id,
        patientId,
        gender: patient.gender,
        loginTime: nowIso(),
        status: "logged_in",
        currentPath: [] as string[],
        completedClinics: [] as string[],
        patient: {
            id: patient.id,
            name: patient.name,
            militaryId: patientId,
            gender: patient.gender
        }
    };

    return jsonResponse({ success: true, data: payload });
}

async function handleQueueEnter(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ clinic?: string; user?: string; isAutoEntry?: boolean }>(req);
    const clinic = String(body.clinic ?? "").trim();
    const sessionId = String(body.user ?? "").trim();
    const isAutoEntry = Boolean(body.isAutoEntry);

    if (!clinic || !sessionId) {
        return errorResponse("clinic and user are required", 400);
    }

    const session = await getSessionById(client, sessionId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    const position = await nextQueuePosition(client, clinic);
    const queueNumber = `${clinic.toUpperCase()}-${String(position).padStart(3, "0")}`;

    const insert = await client
        .from("queues")
        .insert({
            clinic,
            patient_id: session.patient_id,
            queue_number: queueNumber,
            position,
            status: isAutoEntry ? "in_progress" : "waiting",
            priority: isAutoEntry ? "high" : "normal",
            entered_at: nowIso()
        })
        .select("id")
        .single();

    if (insert.error) {
        throw insert.error;
    }

    await client
        .from("queue_history")
        .insert({
            clinic,
            patient_id: session.patient_id,
            action: "entered",
            queue_number: queueNumber,
            timestamp: nowIso()
        });

    const totalWaiting = await countWaiting(client, clinic);
    const ahead = Math.max(0, position - 1);

    const payload = {
        success: true,
        clinic,
        user: sessionId,
        queue_id: insert.data.id,
        number: queueNumber,
        display_number: position,
        ahead,
        total_waiting: totalWaiting,
        estimated_wait_minutes: Math.max(5, position * 5),
        status: isAutoEntry ? "in_progress" : "waiting"
    };

    return jsonResponse(payload);
}

async function handleQueueStatus(client: SupabaseClient, url: URL): Promise<Response> {
    const clinic = String(url.searchParams.get("clinic") ?? "").trim();
    if (!clinic) {
        return errorResponse("clinic query parameter is required", 400);
    }

    const entries = await fetchQueueEntries(client, clinic, ACTIVE_STATES);
    const totalWaiting = entries.filter((item) => item.status === "waiting").length;

    const list = entries.map((entry, index) => ({
        id: entry.id,
        number: entry.queue_number ?? `${clinic}-${String(entry.position ?? index + 1).padStart(3, "0")}`,
        position: entry.position ?? index + 1,
        status: entry.status,
        entered_at: entry.entered_at,
        patient: entry.patients
            ? {
                id: entry.patients.id,
                name: entry.patients.name,
                militaryId: entry.patients.military_id,
                gender: entry.patients.gender
            }
            : null
    }));

    const currentServing = entries.find((entry) => entry.status === "called" || entry.status === "in_service" || entry.status === "in_progress") ?? null;

    return jsonResponse({
        success: true,
        clinic,
        list,
        current_serving: currentServing
            ? {
                id: currentServing.id,
                number: currentServing.queue_number,
                patient: currentServing.patients
                    ? {
                        id: currentServing.patients.id,
                        name: currentServing.patients.name,
                        militaryId: currentServing.patients.military_id,
                        gender: currentServing.patients.gender
                    }
                    : null
            }
            : null,
        total_waiting: totalWaiting
    });
}

async function handleQueuePosition(client: SupabaseClient, url: URL): Promise<Response> {
    const clinic = String(url.searchParams.get("clinic") ?? "").trim();
    const sessionId = String(url.searchParams.get("user") ?? "").trim();

    if (!clinic || !sessionId) {
        return errorResponse("clinic and user query parameters are required", 400);
    }

    const session = await getSessionById(client, sessionId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    const payload = await queuePositionPayload(client, clinic, session.patient_id);

    return jsonResponse({
        success: true,
        clinic,
        user: sessionId,
        display_number: payload.display_number,
        ahead: payload.ahead,
        total_waiting: payload.total_waiting,
        estimated_wait_minutes: Math.max(0, payload.ahead + 1) * 5,
        status: payload.status,
        number: payload.queue_number
    });
}

async function handleQueueDone(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ clinic?: string; user?: string; pin?: string }>(req);
    const clinic = String(body.clinic ?? "").trim();
    const sessionId = String(body.user ?? "").trim();
    const pin = String(body.pin ?? "").trim();

    if (!clinic || !sessionId || !pin) {
        return errorResponse("clinic, user and pin are required", 400);
    }

    await ensureValidPin(client, clinic, pin);

    const session = await getSessionById(client, sessionId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    const update = await client
        .from("queues")
        .update({
            status: COMPLETED_STATE,
            completed_at: nowIso()
        })
        .eq("clinic", clinic)
        .eq("patient_id", session.patient_id)
        .in("status", ACTIVE_STATES as unknown as string[])
        .order("entered_at", { ascending: false })
        .limit(1)
        .select("queue_number")
        .maybeSingle();

    if (update.error) {
        throw update.error;
    }

    if (!update.data) {
        return errorResponse("No active queue entry found", 404);
    }

    await client
        .from("queue_history")
        .insert({
            clinic,
            patient_id: session.patient_id,
            action: "completed",
            queue_number: update.data.queue_number,
            timestamp: nowIso()
        });

    return jsonResponse({ success: true, message: "Queue completed" });
}

async function handleClinicExit(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ patientId?: string; clinicId?: string; pin?: string }>(req);
    const rawBody = body as Record<string, unknown>;
    const clinicCandidate = rawBody.clinic !== undefined ? String(rawBody.clinic ?? "") : "";
    const clinic = String(body.clinicId ?? clinicCandidate ?? "").trim();
    const sessionId = String(body.patientId ?? "").trim();
    const pin = String(body.pin ?? "").trim();

    if (!clinic || !sessionId || !pin) {
        return errorResponse("patientId, clinicId and pin are required", 400);
    }

    await ensureValidPin(client, clinic, pin);

    const session = await getSessionById(client, sessionId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    const update = await client
        .from("queues")
        .update({
            status: COMPLETED_STATE,
            completed_at: nowIso()
        })
        .eq("clinic", clinic)
        .eq("patient_id", session.patient_id)
        .in("status", ACTIVE_STATES as unknown as string[])
        .order("entered_at", { ascending: false })
        .limit(1)
        .select("queue_number")
        .maybeSingle();

    if (update.error) {
        throw update.error;
    }

    if (!update.data) {
        return errorResponse("No active clinic entry found", 404);
    }

    await client
        .from("queue_history")
        .insert({
            clinic,
            patient_id: session.patient_id,
            action: "exited",
            queue_number: update.data.queue_number,
            timestamp: nowIso()
        });

    return jsonResponse({ success: true, message: "Patient exited clinic", route: [] });
}

async function handleQueueCall(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ clinic?: string }>(req);
    const clinic = String(body.clinic ?? "").trim();

    if (!clinic) {
        return errorResponse("clinic is required", 400);
    }

    const next = await client
        .from("queues")
        .select(
            "id, queue_number, patient_id, position, status, patients(id, name, military_id, gender)"
        )
        .eq("clinic", clinic)
        .eq("status", "waiting")
        .order("position", { ascending: true, nullsFirst: true })
        .limit(1)
        .maybeSingle();

    if (next.error && next.error.code !== "PGRST116") {
        throw next.error;
    }

    if (!next.data) {
        return jsonResponse({ success: true, message: "No patients in queue" });
    }

    const now = nowIso();
    const update = await client
        .from("queues")
        .update({ status: "called", called_at: now })
        .eq("id", next.data.id)
        .select("queue_number")
        .single();

    if (update.error) throw update.error;

    await client
        .from("queue_history")
        .insert({
            clinic,
            patient_id: next.data.patient_id,
            action: "called",
            queue_number: update.data.queue_number,
            timestamp: now
        });

    return jsonResponse({
        success: true,
        calledPatient: {
            id: next.data.id,
            number: update.data.queue_number,
            patient: next.data.patients
                ? {
                    id: next.data.patients.id,
                    name: next.data.patients.name,
                    militaryId: next.data.patients.military_id,
                    gender: next.data.patients.gender
                }
                : null
        }
    });
}

async function handlePinStatus(client: SupabaseClient, url: URL): Promise<Response> {
    const clinic = url.searchParams.get("clinic");
    if (clinic) {
        const pin = await fetchTodaysPin(client, clinic);
        if (!pin) {
            return errorResponse("PIN not found", 404);
        }
        // واجهة عامة: لا تعرض الرقم، تعرض معلومات صلاحية فقط
        const masked = pinPayload(pin);
        delete (masked as any).pin;
        return jsonResponse({ success: true, clinic, info: masked });
    }

    const today = startOfTodayIso().slice(0, 10);

    // 1) اجلب كل الأكواد النشطة من pins (clinic_code)
    const pinsRes = await client
        .from("pins")
        .select("clinic_code, created_at, expires_at, is_active")
        .eq("is_active", true);
    if (pinsRes.error) throw pinsRes.error;

    // 2) اجلب clinic_pins لليوم الحالي
    const cpRes = await client
        .from("clinic_pins")
        .select("clinic_id, valid_day, created_at")
        .eq("valid_day", today)
        .eq("active", true);
    if (cpRes.error) throw cpRes.error;

    // لا نعرض الأرقام، فقط العيادات المسموح بها ومعلومات عامة
    const allowed = new Set<string>();
    const maskedPins: Record<string, unknown> = {};

    for (const row of cpRes.data ?? []) {
        const id = String(row.clinic_id ?? "");
        if (!id) continue;
        allowed.add(id);
        maskedPins[id] = {
            clinic: id,
            date: row.valid_day ?? today,
            generatedAt: row.created_at ?? null,
            expiresAt: null,
            active: true
        };
    }

    for (const row of pinsRes.data ?? []) {
        const code = String(row.clinic_code ?? "");
        if (!code || allowed.has(code)) continue;
        allowed.add(code);
        maskedPins[code] = {
            clinic: code,
            date: row.created_at ? String(row.created_at).slice(0, 10) : null,
            generatedAt: row.created_at ?? null,
            expiresAt: row.expires_at ?? null,
            active: true
        };
    }

    return jsonResponse({ success: true, allowedClinics: Array.from(allowed), pins: maskedPins });
}

// واجهة الإدارة: تعرض أرقام البن كاملة (يُنصح بحمايتها لاحقاً)
async function handleAdminPinStatus(client: SupabaseClient, url: URL): Promise<Response> {
    const clinic = url.searchParams.get("clinic");
    if (clinic) {
        const pin = await fetchTodaysPin(client, clinic);
        if (!pin) return errorResponse("PIN not found", 404);
        return jsonResponse({ success: true, clinic, pin: pinPayload(pin) });
    }

    const today = startOfTodayIso().slice(0, 10);

    const pinsRes = await client
        .from("pins")
        .select("clinic_code, pin, created_at, expires_at, is_active")
        .eq("is_active", true);
    if (pinsRes.error) throw pinsRes.error;

    const cpRes = await client
        .from("clinic_pins")
        .select("clinic_id, pin, valid_day, created_at")
        .eq("valid_day", today)
        .eq("active", true);
    if (cpRes.error) throw cpRes.error;

    const pins: Record<string, unknown> = {};
    for (const row of cpRes.data ?? []) {
        const key = String(row.clinic_id ?? "");
        if (!key) continue;
        const rec: PinRecord = {
            clinic: key,
            pin: String(row.pin ?? ""),
            date: row.valid_day ?? today,
            created_at: row.created_at ?? null,
            expires_at: null
        };
        pins[key] = pinPayload(rec);
    }
    for (const row of pinsRes.data ?? []) {
        const key = String(row.clinic_code ?? "");
        if (!key || pins[key]) continue;
        const rec: PinRecord = {
            clinic: key,
            pin: String(row.pin ?? ""),
            date: row.created_at ? String(row.created_at).slice(0, 10) : null,
            created_at: row.created_at ?? null,
            expires_at: row.expires_at ?? null
        };
        pins[key] = pinPayload(rec);
    }

    return jsonResponse({ success: true, pins });
}

async function handleStatsDashboard(client: SupabaseClient): Promise<Response> {
    const startOfDay = startOfTodayIso();

    const [totalPatients, waitingCount, completedToday] = await Promise.all([
        safeCount(client, "patients"),
        safeCount(client, "queues", (q) => q.in("status", ACTIVE_STATES as unknown as string[])),
        safeCount(client, "queues", (q) => q.eq("status", COMPLETED_STATE).gte("completed_at", startOfDay))
    ]);

    let activeQueuesCount = 0;
    try {
        const queues = await client
            .from("queues")
            .select("clinic")
            .in("status", ACTIVE_STATES as unknown as string[]);
        if (!queues.error) {
            const activeClinics = new Set<string>();
            for (const row of queues.data ?? []) {
                if (row && typeof row.clinic === "string") activeClinics.add(row.clinic);
            }
            activeQueuesCount = activeClinics.size;
        }
    } catch {
        activeQueuesCount = 0;
    }

    return jsonResponse({
        success: true,
        stats: {
            totalPatients: totalPatients ?? 0,
            activeQueues: activeQueuesCount,
            totalWaiting: waitingCount ?? 0,
            completedToday: completedToday ?? 0,
            averageWaitTime: Math.max(5, ((waitingCount ?? 0) || 1) * 3),
            lastRefreshed: nowIso()
        }
    });
}

async function handleStatsQueues(client: SupabaseClient): Promise<Response> {
    // Clinics: prefer ordering by display_order, fallback to plain select when column absent
    let clinicsResponse = await client
        .from("clinics")
        .select("id, code, slug, name, name_ar, is_active")
        .order("display_order", { ascending: true, nullsFirst: true });
    if (clinicsResponse.error) {
        clinicsResponse = await client
            .from("clinics")
            .select("id, code, slug, name, name_ar, is_active");
    }

    // Queues: if table/columns differ, treat as empty set rather than erroring
    let queuesResponse = await client
        .from("queues")
        .select("clinic, status")
        .in("status", ACTIVE_STATES as unknown as string[]);
    if (queuesResponse.error) {
        queuesResponse = { data: [], error: null } as any;
    }

    const counts = new Map<string, { waiting: number; active: number }>();
    for (const row of queuesResponse.data ?? []) {
        const key = String(row.clinic);
        if (!counts.has(key)) {
            counts.set(key, { waiting: 0, active: 0 });
        }
        const bucket = counts.get(key)!;
        if (row.status === "waiting") {
            bucket.waiting += 1;
        } else {
            bucket.active += 1;
        }
    }

    const queues = (clinicsResponse.data ?? []).map((clinic: ClinicRecord): QueueSummary => {
        const key = clinic.code ?? clinic.slug ?? clinic.id;
        const displayName = clinic.name_ar ?? clinic.name ?? key;
        const stats = counts.get(key) ?? { waiting: 0, active: 0 };
        return {
            id: key,
            name: displayName,
            status: clinic.is_active === false ? "closed" : "open",
            currentPatients: stats.waiting,
            activePatients: stats.active,
            lastUpdate: nowIso()
        };
    });

    queues.sort((a: QueueSummary, b: QueueSummary) => {
        if (a.currentPatients === 0 && b.currentPatients !== 0) return -1;
        if (a.currentPatients !== 0 && b.currentPatients === 0) return 1;
        return a.currentPatients - b.currentPatients;
    });

    const totalWaiting = Array.from(counts.values()).reduce((acc, cur) => acc + cur.waiting, 0);
    const realTimeQueue = {
        totalWaiting,
        nextInLine: null as string | null,
        lastCall: null as string | null,
        precision: "real-time"
    };

    const nextPatient = await client
        .from("queues")
        .select("queue_number")
        .eq("status", "waiting")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (!nextPatient.error && nextPatient.data) {
        realTimeQueue.nextInLine = nextPatient.data.queue_number ?? null;
    }

    const lastCalled = await client
        .from("queue_history")
        .select("queue_number")
        .eq("action", "called")
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastCalled.error && lastCalled.data) {
        realTimeQueue.lastCall = lastCalled.data.queue_number ?? null;
    }

    return jsonResponse({ success: true, queues, realTimeQueue });
}

async function handleAdminStatus(client: SupabaseClient): Promise<Response> {
    const [{ count: waitingCount }, { count: completedToday }] = await Promise.all([
        client
            .from("queues")
            .select("id", { head: true, count: "exact" })
            .in("status", ACTIVE_STATES as unknown as string[]),
        client
            .from("queues")
            .select("id", { head: true, count: "exact" })
            .eq("status", COMPLETED_STATE)
            .gte("completed_at", startOfTodayIso())
    ]);

    // احسب عدد PINs النشطة لليوم من كلا المصدرين (pins و clinic_pins)
    let pinsActive = 0;
    try {
        const todayStart = startOfTodayIso();
        // أولوية 1: pins بمعيار clinic_code واليوم الحالي
        let pinsToday = await client
            .from("pins")
            .select("id", { head: true, count: "exact" })
            .eq("is_active", true)
            .gte("generated_at", todayStart);
        if (pinsToday.error) {
            pinsToday = await client
                .from("pins")
                .select("id", { head: true, count: "exact" })
                .eq("is_active", true)
                .gte("created_at", todayStart);
        }
        const pinsCount = pinsToday.error ? 0 : (pinsToday.count ?? 0);

        // أولوية 2: clinic_pins لليوم الحالي والفعّالة
        const cpToday = await client
            .from("clinic_pins")
            .select("id", { head: true, count: "exact" })
            .eq("valid_day", todayStart.slice(0, 10))
            .eq("active", true);
        const cpCount = cpToday.error ? 0 : (cpToday.count ?? 0);

        // استخدم الأكبر لتجنب العد المزدوج إن وُجد نظامان متزامنان
        pinsActive = Math.max(pinsCount, cpCount);
    } catch (_) {
        // تجاهل الأخطاء هنا وأبقِ القيمة الافتراضية 0
    }

    return jsonResponse({
        success: true,
        status: "operational",
        metrics: {
            queue_management: {
                waiting: waitingCount ?? 0,
                completedToday: completedToday ?? 0
            },
            pin_system: {
                activePins: pinsActive ?? 0
            }
        },
        last_updated: nowIso()
    });
}

async function handleReportsHistory(client: SupabaseClient, url: URL): Promise<Response> {
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const response = await client
        .from("queue_history")
        .select("clinic, action, queue_number, timestamp, patient_id")
        .order("timestamp", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 50));

    if (response.error) throw response.error;

    return jsonResponse({ success: true, reports: response.data ?? [] });
}

async function handleRouteCreate(client: SupabaseClient, req: Request): Promise<Response> {
    const body = await readJsonBody<{ patientId?: string; examType?: string; gender?: string; stations?: string[] }>(req);
    const patientId = String(body.patientId ?? "").trim();
    const examType = String(body.examType ?? "").trim();
    const gender = normalizeGender(body.gender);
    const stations = Array.isArray(body.stations) ? body.stations : [];

    if (!patientId || stations.length === 0) {
        return errorResponse("patientId and stations are required", 400);
    }

    const session = await getSessionById(client, patientId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    try {
        await client
            .from("patient_routes")
            .upsert({
                patient_id: session.patient_id,
                exam_type: examType || null,
                gender,
                stations,
                updated_at: nowIso()
            }, { onConflict: "patient_id" });
    } catch (routeError) {
        const code = (routeError as { code?: string }).code;
        if (code && code !== "42P01") {
            throw routeError;
        }
    }

    return jsonResponse({ success: true, route: stations });
}

async function handleRouteGet(client: SupabaseClient, url: URL): Promise<Response> {
    const sessionId = String(url.searchParams.get("patientId") ?? "").trim();
    if (!sessionId) {
        return errorResponse("patientId is required", 400);
    }

    const session = await getSessionById(client, sessionId);
    if (!session) {
        return errorResponse("Session not found or expired", 401);
    }

    const response = await client
        .from("patient_routes")
        .select("stations, exam_type, gender")
        .eq("patient_id", session.patient_id)
        .maybeSingle();

    if (response.error && response.error.code !== "PGRST116") {
        if (response.error.code === "42P01") {
            return jsonResponse({ success: true, route: [] });
        }
        throw response.error;
    }

    if (!response.data) {
        return jsonResponse({ success: true, route: [] });
    }

    return jsonResponse({ success: true, route: response.data });
}

async function handlePathChoose(client: SupabaseClient, req: Request | URL): Promise<Response> {
    const params = req instanceof URL ? req.searchParams : new URL(req.url).searchParams;
    const gender = normalizeGender(params.get("gender") ?? "male");

    // Order by display_order if available; otherwise return unordered
    let config = await client
        .from("clinics")
        .select("id, code, slug, type, name, name_ar, requires_pin")
        .order("display_order", { ascending: true, nullsFirst: true });
    if (config.error) {
        config = await client
            .from("clinics")
            .select("id, code, slug, type, name, name_ar, requires_pin");
    }

    const path = (config.data ?? [])
        .filter((clinic: ClinicRecord) => clinic.type !== "admin")
        .map((clinic: ClinicRecord) => ({
            id: clinic.code ?? clinic.slug ?? clinic.id,
            type: clinic.type,
            requiresPin: clinic.requires_pin ?? false,
            name: clinic.name_ar ?? clinic.name
        }));

    return jsonResponse({ success: true, path, gender });
}

serve(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const client = supabase();
    const url = new URL(req.url);
    const path = extractPath(url).toLowerCase();

    try {
        if (path === "" || path === "status" || path === "health" || path === "health/status") {
            return jsonResponse({ success: true, status: "healthy", time: nowIso() });
        }

        if (path === "patient/login" && req.method === "POST") {
            return await handlePatientLogin(client, req);
        }

        if (path === "queue/enter" && req.method === "POST") {
            return await handleQueueEnter(client, req);
        }

        if (path === "queue/status" && req.method === "GET") {
            return await handleQueueStatus(client, url);
        }

        if (path === "queue/position" && req.method === "GET") {
            return await handleQueuePosition(client, url);
        }

        if (path === "queue/done" && req.method === "POST") {
            return await handleQueueDone(client, req);
        }

        if (path === "clinic/exit" && req.method === "POST") {
            return await handleClinicExit(client, req);
        }

        if (path === "queue/call" && req.method === "POST") {
            return await handleQueueCall(client, req);
        }

        if (path === "pin/status" && req.method === "GET") {
            return await handlePinStatus(client, url);
        }
        if (path === "admin/pin/status" && req.method === "GET") {
            return await handleAdminPinStatus(client, url);
        }

        if (path === "stats/dashboard" && req.method === "GET") {
            return await handleStatsDashboard(client);
        }

        if (path === "stats/queues" && req.method === "GET") {
            return await handleStatsQueues(client);
        }

        if (path === "admin/status" && req.method === "GET") {
            return await handleAdminStatus(client);
        }

        if (path === "reports/history" && req.method === "GET") {
            return await handleReportsHistory(client, url);
        }

        if (path === "route/create" && req.method === "POST") {
            return await handleRouteCreate(client, req);
        }

        if (path === "route/get" && req.method === "GET") {
            return await handleRouteGet(client, url);
        }

        if (path === "path/choose" && req.method === "GET") {
            return await handlePathChoose(client, url);
        }

        if (path === "path/choose" && req.method === "POST") {
            return await handlePathChoose(client, req);
        }

        return errorResponse("Endpoint not found", 404, { path, method: req.method });
    } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        console.error("api-router error", { path, method: req.method, error });
        return errorResponse((error as Error).message ?? "Internal server error", status);
    }
});
