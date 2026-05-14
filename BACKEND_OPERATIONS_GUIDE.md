# BACKEND_OPERATIONS_GUIDE (Source of Truth)

## 1. Architecture Overview
The backend is a hybrid system consisting of:
- **Supabase Edge Functions**: Handle logic, routing, and external integrations.
- **PostgreSQL Database**: Persistent storage with Row Level Security (RLS).
- **API Router**: A central gateway (`api-router`) that dispatches `/api/v1/*` requests to specialized functions.

## 2. API v1 Dispatch Logic
The `api-router` function acts as the entry point. It resolves the following paths:

| Path | Method | Target Function | Purpose |
| :--- | :--- | :--- | :--- |
| `patient/login` | POST | `patient-login` | Authenticates patients and creates/retrieves visits. |
| `queue/enter` | POST | `queue-enter` | Adds a patient to the clinic queue with weight logic. |
| `queue/call` | POST | `queue-call` | (Doctor) Calls the next patient in the queue. |
| `queue/status` | GET | `queue-status` | Retrieves real-time status of a patient or clinic queue. |
| `events/stream` | GET | `events-stream` | SSE endpoint for real-time dashboard updates. |
| `admin/login` | POST | `admin-login` | Authenticates administrative users. |
| `admin/status` | GET | `api-v1-status` | System health and diagnostic status for admins. |
| `pin/status` | GET | `pin-status` | (Legacy/Compatibility) Checks PIN status. |

## 3. Database & Security (RLS)
The system relies on strict RLS policies defined in `supabase/migrations`.
- **Admins**: Validated against the `admins` table.
- **Doctors**: Validated via `doctor_login` RPC and session tokens.
- **Internal Tools**: Must provide `x-internal-secret` to access `api-management`, `db-policies-manager`, and `db-tables-manager`.

## 4. Critical Algorithms
### Queue Weighting & Selection
The `queue-enter` function calculates the starting position based on `exam_type` and `gender`.
### Atomic Queue Operations
RPCs like `add_to_queue_atomic_rpc` ensure that no two patients get the same display number and prevent race conditions during high concurrency.
### Qatar Timezone Alignment
All daily resets and date comparisons MUST use `UTC+3`. The system identifies "today" based on this offset to ensure queue consistency.

## 5. Maintenance Procedures
- **Deploying Functions**: Use `supabase functions deploy [name]`.
- **Database Migrations**: New tables or schema changes MUST be added to `supabase/migrations` with a timestamped prefix.
- **Diagnostic Check**: Invoke `healthz` or `db-check` functions to verify connectivity and schema integrity.

## 6. Legacy vs. Active
- **Active**: `api-router`, `queue-*`, `patient-login`, `admin-login`.
- **Legacy (Do Not Use for New Features)**: `pin-generate`, `pin-verify`, `issue-pin`. These are kept for backward compatibility only.
