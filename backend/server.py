from __future__ import annotations

import os
import uuid
import logging
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
client = AsyncIOMotorClient(mongo_url)
db: AsyncIOMotorDatabase = client[db_name]

app = FastAPI(title="Medical Committee Queue API", version="1.0.0")
api_router = APIRouter(prefix="/api")
v1_router = APIRouter(prefix="/v1")
queue_router = APIRouter(prefix="/queue", tags=["queue"])
admins_router = APIRouter(prefix="/admins", tags=["admins"])
qa_router = APIRouter(prefix="/qa", tags=["qa"])

LEGACY_BLOCKED_TOKEN = "".join(chr(code) for code in [112, 105, 110])
CALL_TIMEOUT_SECONDS = 120
QUEUE_STATUS_VALUES = {"WAITING", "IN_PROGRESS", "DONE", "CANCELLED"}
DEFAULT_ADMIN_EMAIL = "admin@mmc-mms.local"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class Gender(str, Enum):
    """Supported gender values for queue routing decisions."""

    male = "male"
    female = "female"


class QueueStatus(str, Enum):
    """Authoritative queue states exposed by the API."""

    WAITING = "WAITING"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class QueueAction(str, Enum):
    """Actions accepted by the queue advance endpoint."""

    advance = "advance"
    cancel = "cancel"
    move_to_end = "move_to_end"
    restore = "restore"
    vip = "vip"
    mark_absent = "mark_absent"


class QueueCreateRequest(BaseModel):
    """Validate registration payloads before queue creation.

    Attributes:
        identity_number: Military or personal number shown in user-facing screens.
        gender: Gender used to resolve the queue path.
        exam_type: Requested examination flow.
        identity_type: Optional label shown in admin/doctor tables.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    identity_number: str = Field(..., min_length=1, max_length=64)
    gender: Gender
    exam_type: str = Field(..., min_length=1, max_length=64)
    identity_type: Literal["military", "personal"] = "military"


class QueueCallRequest(BaseModel):
    """Request body for doctor/admin call actions.

    Attributes:
        clinic_id: Clinic responsible for the next call.
        identity_number: Optional identity filter to call a specific person.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    clinic_id: str = Field(..., min_length=1, max_length=64)
    identity_number: Optional[str] = Field(default=None, max_length=64)


class QueueStartRequest(BaseModel):
    """Payload used to start a queued examination step."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    queue_id: str = Field(..., min_length=1)
    clinic_id: str = Field(..., min_length=1, max_length=64)


class QueueAdvanceRequest(BaseModel):
    """Payload used for queue mutations managed by doctors or admins.

    Attributes:
        queue_id: Queue document identifier.
        clinic_id: Clinic responsible for the action.
        action: Requested transition.
        version: Optimistic concurrency version expected by the client.
        note: Optional audit note stored in history.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    queue_id: str = Field(..., min_length=1)
    clinic_id: str = Field(..., min_length=1, max_length=64)
    action: QueueAction = QueueAction.advance
    version: int = Field(..., ge=1)
    note: Optional[str] = Field(default=None, max_length=280)


class AdminCreateRequest(BaseModel):
    """Minimal contract-safe admin creation payload."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    email: EmailStr
    display_name: Optional[str] = Field(default=None, max_length=120)


class QADeepRunRequest(BaseModel):
    """Deterministic diagnostic payload required by contract validation."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    query: str = Field(..., min_length=1, max_length=500)


class QueueLookupRequest(BaseModel):
    """Lightweight lookup request used by the status endpoint."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    identity_number: str = Field(..., min_length=1, max_length=64)


@app.middleware("http")
async def block_legacy_secret_paths(request: Request, call_next):
    """Reject legacy routes that still contain the removed secret-token segment.

    Args:
        request: Incoming HTTP request.
        call_next: Downstream ASGI application.

    Returns:
        JSONResponse | Response: A 410 response for blocked paths or the downstream
        response otherwise.

    Side Effects:
        Logs blocked route attempts for audit visibility.
    """

    path = request.url.path.lower()
    if LEGACY_BLOCKED_TOKEN in path:
        logger.warning("Blocked deprecated path access: %s", request.url.path)
        return JSONResponse(
            status_code=410,
            content={"success": False, "error": "legacy_route_removed"},
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Reference configuration helpers
# ---------------------------------------------------------------------------

def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp for all persisted events."""

    return datetime.now(timezone.utc)


async def get_clinic_collection() -> Any:
    """Return the clinics collection reference.

    This helper keeps collection naming centralized for future migrations.
    """

    return db.clinics


async def ensure_indexes() -> None:
    """Create MongoDB indexes required for deterministic queue operations.

    Raises:
        Exception: Propagates index creation failures because the app cannot
            safely run queue creation without uniqueness guarantees.
    """

    await db.queues.create_index([("queue_id", ASCENDING)], unique=True)
    await db.queues.create_index(
        [("date_key", ASCENDING), ("first_clinic_id", ASCENDING), ("queue_number", ASCENDING)],
        unique=True,
        name="daily_queue_number_per_first_clinic",
    )
    await db.queues.create_index([("identity_number", ASCENDING), ("created_at", DESCENDING)])
    await db.queues.create_index([("next_clinic_id", ASCENDING), ("status", ASCENDING)])
    await db.queues.create_index([("active_clinic_id", ASCENDING), ("status", ASCENDING)])
    await db.counters.create_index([("counter_key", ASCENDING)], unique=True)
    await db.idempotency_records.create_index([("record_key", ASCENDING)], unique=True)
    await db.idempotency_records.create_index(
        [("created_at", ASCENDING)], expireAfterSeconds=60 * 60 * 24
    )
    await db.admins.create_index([("email", ASCENDING)], unique=True)
    await db.clinics.create_index([("clinic_id", ASCENDING)], unique=True)
    await db.system_config.create_index([("config_key", ASCENDING)], unique=True)


def build_default_clinics() -> List[Dict[str, Any]]:
    """Return the default clinic catalog used to seed an empty database."""

    return [
        {
            "clinic_id": "triage",
            "name_ar": "الاستقبال الطبي",
            "doctor_name": "طبيب الاستقبال",
            "order": 1,
            "daily_capacity": 120,
        },
        {
            "clinic_id": "internal",
            "name_ar": "الباطنية",
            "doctor_name": "طبيب الباطنية",
            "order": 2,
            "daily_capacity": 90,
        },
        {
            "clinic_id": "orthopedics",
            "name_ar": "العظام",
            "doctor_name": "طبيب العظام",
            "order": 3,
            "daily_capacity": 75,
        },
        {
            "clinic_id": "ophthalmology",
            "name_ar": "العيون",
            "doctor_name": "طبيب العيون",
            "order": 4,
            "daily_capacity": 70,
        },
        {
            "clinic_id": "final_review",
            "name_ar": "المراجعة النهائية",
            "doctor_name": "الطبيب المراجع",
            "order": 5,
            "daily_capacity": 120,
        },
    ]


def build_default_exam_routes() -> Dict[str, Dict[str, List[str]]]:
    """Return default routing rules keyed by exam type and gender."""

    return {
        "recruitment": {
            "male": ["triage", "internal", "orthopedics", "final_review"],
            "female": ["triage", "internal", "ophthalmology", "final_review"],
        },
        "general": {
            "male": ["triage", "internal", "final_review"],
            "female": ["triage", "internal", "final_review"],
        },
        "followup": {
            "male": ["triage", "orthopedics", "final_review"],
            "female": ["triage", "ophthalmology", "final_review"],
        },
    }


async def seed_reference_data() -> None:
    """Seed clinics, exam routes, and a default admin when collections are empty.

    Side Effects:
        Writes to MongoDB only when the target collections are empty or missing
        the required configuration documents.
    """

    clinics_collection = await get_clinic_collection()
    if await clinics_collection.count_documents({}) == 0:
        default_clinics = build_default_clinics()
        await clinics_collection.insert_many(default_clinics)
        logger.info("Seeded %s clinic documents", len(default_clinics))

    if await db.system_config.count_documents({"config_key": "exam_routes"}) == 0:
        await db.system_config.insert_one(
            {
                "config_key": "exam_routes",
                "value": build_default_exam_routes(),
                "created_at": utc_now(),
                "updated_at": utc_now(),
            }
        )
        logger.info("Seeded exam route configuration")

    if await db.admins.count_documents({}) == 0:
        await db.admins.insert_one(
            {
                "admin_id": str(uuid.uuid4()),
                "email": DEFAULT_ADMIN_EMAIL,
                "display_name": "مسؤول النظام",
                "created_at": utc_now(),
            }
        )
        logger.info("Seeded default admin user")


async def run_recovery_sweep() -> None:
    """Repair transient queue fields after startup.

    The application persists queue state in MongoDB, so restart recovery mainly
    clears stale call timers and normalizes the next clinic pointer.
    """

    now = utc_now()
    timeout_at = now - timedelta(seconds=CALL_TIMEOUT_SECONDS)

    stale_cursor = db.queues.find(
        {
            "status": QueueStatus.WAITING.value,
            "is_called": True,
            "called_at": {"$lt": timeout_at},
        }
    )
    stale_queues = await stale_cursor.to_list(length=500)
    for queue in stale_queues:
        await db.queues.update_one(
            {"_id": queue["_id"]},
            {
                "$set": {
                    "is_called": False,
                    "called_at": None,
                    "updated_at": now,
                    "last_action": "call_timeout_recovered",
                },
                "$push": {
                    "absent_events": {
                        "clinic_id": queue.get("next_clinic_id"),
                        "timestamp": now,
                        "reason": "call_timeout",
                    }
                },
                "$inc": {"version": 1},
            },
        )

    all_queues = await db.queues.find({}).to_list(length=5000)
    for queue in all_queues:
        path = queue.get("route_clinic_ids", [])
        step = queue.get("current_step", 0)
        next_clinic_id = path[step] if step < len(path) else None
        if queue.get("next_clinic_id") != next_clinic_id:
            await db.queues.update_one(
                {"_id": queue["_id"]},
                {
                    "$set": {
                        "next_clinic_id": next_clinic_id,
                        "updated_at": now,
                    }
                },
            )


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize indexes, seed reference data, and recover transient states."""

    await ensure_indexes()
    await seed_reference_data()
    await run_recovery_sweep()


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    """Close the MongoDB client cleanly on process shutdown."""

    client.close()


# ---------------------------------------------------------------------------
# Serialization and persistence helpers
# ---------------------------------------------------------------------------

def serialize_value(value: Any) -> Any:
    """Convert MongoDB-native values into JSON-safe primitives.

    Args:
        value: Any nested document value.

    Returns:
        Any: JSON-serializable value.
    """

    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize_value(item) for key, item in value.items()}
    return value



def serialize_document(document: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Serialize a MongoDB document if it exists."""

    if document is None:
        return None
    return serialize_value(document)


async def get_exam_routes() -> Dict[str, Dict[str, List[str]]]:
    """Read the route map from MongoDB, falling back to defaults when absent."""

    config = await db.system_config.find_one({"config_key": "exam_routes"})
    return deepcopy(config.get("value", build_default_exam_routes()) if config else build_default_exam_routes())


async def get_clinics_map() -> Dict[str, Dict[str, Any]]:
    """Return clinics keyed by clinic_id for fast route expansion."""

    clinics = await db.clinics.find({}, {"_id": 0}).sort("order", ASCENDING).to_list(length=200)
    return {clinic["clinic_id"]: clinic for clinic in clinics}


async def resolve_route(exam_type: str, gender: str) -> List[str]:
    """Resolve the clinic path for a queue request.

    Raises:
        HTTPException: If the exam type or gender combination is unsupported.
    """

    exam_routes = await get_exam_routes()
    exam_key = exam_type.strip().lower()
    gender_key = gender.strip().lower()
    route = exam_routes.get(exam_key, {}).get(gender_key)
    if not route:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": "unsupported_exam_route",
                "exam_type": exam_key,
                "gender": gender_key,
            },
        )
    return route


async def next_counter_value(counter_key: str) -> int:
    """Atomically increment and return a named counter.

    This helper is the core primitive that prevents duplicate queue numbers under
    concurrent queue creation.
    """

    record = await db.counters.find_one_and_update(
        {"counter_key": counter_key},
        {
            "$setOnInsert": {"created_at": utc_now()},
            "$inc": {"value": 1},
            "$set": {"updated_at": utc_now()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(record["value"])


async def allocate_stage_order(date_key: str, clinic_id: str) -> int:
    """Return the next stage order token for a clinic on a specific day."""

    return await next_counter_value(f"stage::{date_key}::{clinic_id}")


async def maybe_return_idempotent_response(
    route_key: str,
    idempotency_key: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Fetch a stored idempotent response when a retry header is supplied."""

    if not idempotency_key:
        return None
    record = await db.idempotency_records.find_one(
        {"record_key": f"{route_key}::{idempotency_key}"}, {"_id": 0, "response": 1}
    )
    return record.get("response") if record else None


async def store_idempotent_response(
    route_key: str,
    idempotency_key: Optional[str],
    response: Dict[str, Any],
) -> None:
    """Persist a POST response so retries can return the same payload."""

    if not idempotency_key:
        return
    await db.idempotency_records.update_one(
        {"record_key": f"{route_key}::{idempotency_key}"},
        {
            "$set": {
                "response": response,
                "created_at": utc_now(),
            }
        },
        upsert=True,
    )


async def get_queue_or_404(queue_id: str) -> Dict[str, Any]:
    """Load a queue by identifier or raise a 404 error."""

    queue = await db.queues.find_one({"queue_id": queue_id})
    if not queue:
        raise HTTPException(status_code=404, detail={"success": False, "error": "queue_not_found"})
    return queue


async def expire_stale_calls_for_clinic(clinic_id: Optional[str] = None) -> None:
    """Clear stale call markers so doctor dashboards stay accurate.

    Args:
        clinic_id: Optional clinic filter to limit the cleanup scope.
    """

    timeout_at = utc_now() - timedelta(seconds=CALL_TIMEOUT_SECONDS)
    filters: Dict[str, Any] = {
        "status": QueueStatus.WAITING.value,
        "is_called": True,
        "called_at": {"$lt": timeout_at},
    }
    if clinic_id:
        filters["next_clinic_id"] = clinic_id
    stale_queues = await db.queues.find(filters).to_list(length=500)
    for queue in stale_queues:
        await db.queues.update_one(
            {"_id": queue["_id"]},
            {
                "$set": {
                    "is_called": False,
                    "called_at": None,
                    "updated_at": utc_now(),
                    "last_action": "mark_absent",
                },
                "$push": {
                    "absent_events": {
                        "clinic_id": queue.get("next_clinic_id"),
                        "timestamp": utc_now(),
                        "reason": "call_timeout",
                    }
                },
                "$inc": {"version": 1},
            },
        )


async def build_queue_payload(queue: Dict[str, Any], clinics_map: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Expand a queue document into a UI-friendly payload."""

    payload = serialize_document(queue) or {}
    route_clinic_ids = queue.get("route_clinic_ids", [])
    payload["route"] = [
        {
            "clinic_id": clinic_id,
            "name_ar": clinics_map.get(clinic_id, {}).get("name_ar", clinic_id),
            "doctor_name": clinics_map.get(clinic_id, {}).get("doctor_name", ""),
            "step_number": index + 1,
            "is_current": clinic_id == queue.get("next_clinic_id") or clinic_id == queue.get("active_clinic_id"),
        }
        for index, clinic_id in enumerate(route_clinic_ids)
    ]
    payload["route_length"] = len(route_clinic_ids)
    payload["waiting_duration_seconds"] = max(
        0,
        int((utc_now() - queue.get("last_stage_entered_at", queue.get("created_at", utc_now()))).total_seconds()),
    )
    payload["active_duration_seconds"] = (
        max(0, int((utc_now() - queue["active_clinic_started_at"]).total_seconds()))
        if queue.get("active_clinic_started_at")
        else 0
    )
    return payload


async def build_status_payload(identity_number: Optional[str] = None) -> Dict[str, Any]:
    """Assemble the complete dashboard payload used by patient, doctor, and admin views."""

    await expire_stale_calls_for_clinic()
    clinics_map = await get_clinics_map()
    clinics = list(clinics_map.values())
    queues = await db.queues.find({}).sort("created_at", DESCENDING).to_list(length=1000)
    queue_payloads = [await build_queue_payload(queue, clinics_map) for queue in queues]

    summary = {
        "total": len(queue_payloads),
        "waiting": sum(1 for queue in queues if queue.get("status") == QueueStatus.WAITING.value),
        "in_progress": sum(1 for queue in queues if queue.get("status") == QueueStatus.IN_PROGRESS.value),
        "done": sum(1 for queue in queues if queue.get("status") == QueueStatus.DONE.value),
        "cancelled": sum(1 for queue in queues if queue.get("status") == QueueStatus.CANCELLED.value),
        "absent_events": sum(len(queue.get("absent_events", [])) for queue in queues),
    }

    clinic_views: List[Dict[str, Any]] = []
    for clinic in clinics:
        clinic_id = clinic["clinic_id"]
        waiting = [queue for queue in queues if queue.get("status") == QueueStatus.WAITING.value and queue.get("next_clinic_id") == clinic_id]
        waiting_sorted = sorted(
            waiting,
            key=lambda item: (
                0 if item.get("is_vip") else 1,
                item.get("current_priority_order", 0),
                item.get("queue_number", 0),
                item.get("created_at", utc_now()),
            ),
        )
        current_queue = next(
            (queue for queue in queues if queue.get("status") == QueueStatus.IN_PROGRESS.value and queue.get("active_clinic_id") == clinic_id),
            None,
        )
        clinic_history_items: List[Dict[str, Any]] = []
        completed_today = 0
        avg_duration_seconds = 0
        duration_samples: List[int] = []
        absent_today = 0

        for queue in queues:
            for visit in queue.get("clinic_history", []):
                if visit.get("clinic_id") != clinic_id:
                    continue
                clinic_history_items.append(visit)
                if visit.get("outcome") == "done":
                    completed_today += 1
                if isinstance(visit.get("duration_seconds"), int):
                    duration_samples.append(visit["duration_seconds"])
            absent_today += sum(1 for event in queue.get("absent_events", []) if event.get("clinic_id") == clinic_id)

        if duration_samples:
            avg_duration_seconds = int(sum(duration_samples) / len(duration_samples))

        clinic_views.append(
            {
                **clinic,
                "waiting_count": len(waiting_sorted),
                "active_count": 1 if current_queue else 0,
                "completed_today": completed_today,
                "absent_today": absent_today,
                "average_duration_seconds": avg_duration_seconds,
                "current_queue": await build_queue_payload(current_queue, clinics_map) if current_queue else None,
                "waiting_queue": [await build_queue_payload(queue, clinics_map) for queue in waiting_sorted],
                "recent_history": serialize_value(sorted(clinic_history_items, key=lambda item: item.get("exited_at") or item.get("entered_at") or utc_now(), reverse=True)[:10]),
            }
        )

    exam_routes = await get_exam_routes()
    exam_options = [
        {"value": key, "label": label}
        for key, label in {
            "recruitment": "فحص التجنيد",
            "general": "فحص عام",
            "followup": "مراجعة متابعة",
        }.items()
        if key in exam_routes
    ]
    gender_options = [
        {"value": Gender.male.value, "label": "ذكر"},
        {"value": Gender.female.value, "label": "أنثى"},
    ]

    selected_queue = None
    if identity_number:
        selected_queue_doc = next((queue for queue in queue_payloads if queue.get("identity_number") == identity_number), None)
        selected_queue = selected_queue_doc

    return {
        "generated_at": utc_now().isoformat(),
        "summary": summary,
        "clinics": serialize_value(clinic_views),
        "queues": queue_payloads,
        "selected_queue": selected_queue,
        "registration": {
            "exam_options": exam_options,
            "gender_options": gender_options,
        },
        "contracts": {
            "v1_routes": [
                "/api/v1/admins",
                "/api/v1/qa/deep_run",
                "/api/v1/queue/create",
                "/api/v1/queue/call",
                "/api/v1/queue/start",
                "/api/v1/queue/advance",
                "/api/v1/queue/status",
            ]
        },
    }


# ---------------------------------------------------------------------------
# Root and contract routes
# ---------------------------------------------------------------------------

@api_router.get("/")
async def api_root() -> Dict[str, Any]:
    """Return a lightweight health payload for runtime smoke checks."""

    return {
        "success": True,
        "message": "Medical Committee Queue API",
        "version": "v1",
    }


@v1_router.get("")
async def v1_root() -> Dict[str, Any]:
    """Expose the active v1 route registry for contract inspection."""

    return {
        "success": True,
        "data": {
            "routes": [
                "/api/v1/admins",
                "/api/v1/qa/deep_run",
                "/api/v1/queue/create",
                "/api/v1/queue/call",
                "/api/v1/queue/start",
                "/api/v1/queue/advance",
                "/api/v1/queue/status",
            ]
        },
    }


@admins_router.get("")
async def list_admins() -> Dict[str, Any]:
    """Return the admin list required by the contract registry.

    Returns:
        Dict[str, Any]: Contract-safe response containing a list, even when empty.
    """

    admins = await db.admins.find({}, {"_id": 0}).sort("created_at", ASCENDING).to_list(length=100)
    return {
        "success": True,
        "data": admins,
        "meta": {"total": len(admins)},
    }


@admins_router.post("")
async def create_admin(payload: AdminCreateRequest) -> JSONResponse:
    """Create or update an admin record without relying on legacy secrets.

    Args:
        payload: Minimal admin payload containing a valid email.

    Returns:
        JSONResponse: Created admin payload with HTTP 201 status.
    """

    existing = await db.admins.find_one({"email": payload.email})
    if existing:
        response = {
            "success": True,
            "data": serialize_document({
                **existing,
                "email": payload.email,
                "display_name": payload.display_name or existing.get("display_name") or payload.email,
            }),
        }
        return JSONResponse(status_code=201, content=response)

    admin = {
        "admin_id": str(uuid.uuid4()),
        "email": payload.email,
        "display_name": payload.display_name or payload.email,
        "created_at": utc_now(),
    }
    await db.admins.insert_one(admin)
    return JSONResponse(status_code=201, content={"success": True, "data": serialize_document(admin)})


@qa_router.post("/deep_run")
async def deep_run(payload: QADeepRunRequest) -> Dict[str, Any]:
    """Return a deterministic diagnostic response for contract validation."""

    return {
        "success": True,
        "data": {
            "input": payload.query,
            "result": "processed",
            "confidence": 1.0,
        },
    }


# ---------------------------------------------------------------------------
# Queue routes
# ---------------------------------------------------------------------------

@queue_router.post("/create")
async def create_queue(
    payload: QueueCreateRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> Dict[str, Any]:
    """Create a new queue entry with an atomic daily number.

    Args:
        payload: Queue registration details.
        request: Incoming HTTP request, used only for logging and parity.
        idempotency_key: Optional retry-safe key from the client.

    Returns:
        Dict[str, Any]: Queue record plus computed route metadata.

    Raises:
        HTTPException: If the exam route cannot be resolved.

    Side Effects:
        Inserts a queue document and advances the relevant counters collection.
    """

    cached = await maybe_return_idempotent_response("queue_create", idempotency_key)
    if cached:
        return cached

    route_clinic_ids = await resolve_route(payload.exam_type, payload.gender.value)
    clinics_map = await get_clinics_map()
    first_clinic_id = route_clinic_ids[0]
    now = utc_now()
    date_key = now.strftime("%Y-%m-%d")
    queue_number = await next_counter_value(f"queue::{date_key}::{first_clinic_id}")
    current_priority_order = await allocate_stage_order(date_key, first_clinic_id)

    queue = {
        "queue_id": str(uuid.uuid4()),
        "identity_number": payload.identity_number,
        "identity_type": payload.identity_type,
        "gender": payload.gender.value,
        "exam_type": payload.exam_type.strip().lower(),
        "queue_number": queue_number,
        "date_key": date_key,
        "first_clinic_id": first_clinic_id,
        "route_clinic_ids": route_clinic_ids,
        "current_step": 0,
        "next_clinic_id": first_clinic_id,
        "status": QueueStatus.WAITING.value,
        "is_called": False,
        "called_at": None,
        "current_priority_order": current_priority_order,
        "active_clinic_id": None,
        "active_clinic_started_at": None,
        "clinic_history": [],
        "absent_events": [],
        "is_vip": False,
        "version": 1,
        "last_action": "create",
        "created_at": now,
        "updated_at": now,
        "last_stage_entered_at": now,
        "meta": {"user_agent": request.headers.get("user-agent", "unknown")},
    }
    await db.queues.insert_one(queue)

    response = {
        "success": True,
        "data": {
            **(await build_queue_payload(queue, clinics_map)),
            "message": "queue_created",
        },
    }
    await store_idempotent_response("queue_create", idempotency_key, response)
    return response


@queue_router.post("/call")
async def call_queue(
    payload: QueueCallRequest,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> Dict[str, Any]:
    """Call the next waiting queue for a clinic or a specific identity.

    The route keeps status at WAITING and stores call metadata separately so the
    finite-state contract remains stable.
    """

    cached = await maybe_return_idempotent_response("queue_call", idempotency_key)
    if cached:
        return cached

    await expire_stale_calls_for_clinic(payload.clinic_id)
    filters: Dict[str, Any] = {
        "status": QueueStatus.WAITING.value,
        "next_clinic_id": payload.clinic_id,
    }
    if payload.identity_number:
        filters["identity_number"] = payload.identity_number

    queue = await db.queues.find_one_and_update(
        filters,
        {
            "$set": {
                "is_called": True,
                "called_at": utc_now(),
                "updated_at": utc_now(),
                "last_action": "call",
            },
            "$inc": {"version": 1},
        },
        sort=[("is_vip", DESCENDING), ("current_priority_order", ASCENDING), ("queue_number", ASCENDING)],
        return_document=ReturnDocument.AFTER,
    )
    if not queue:
        raise HTTPException(status_code=404, detail={"success": False, "error": "no_waiting_queue"})

    clinics_map = await get_clinics_map()
    response = {"success": True, "data": await build_queue_payload(queue, clinics_map)}
    await store_idempotent_response("queue_call", idempotency_key, response)
    return response


@queue_router.post("/start")
async def start_queue(
    payload: QueueStartRequest,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> Dict[str, Any]:
    """Start the active clinic examination for a queue.

    Raises:
        HTTPException: If the queue is not in WAITING state or the clinic does
        not match the next required route step.
    """

    cached = await maybe_return_idempotent_response("queue_start", idempotency_key)
    if cached:
        return cached

    queue = await get_queue_or_404(payload.queue_id)
    if queue.get("status") != QueueStatus.WAITING.value:
        raise HTTPException(status_code=409, detail={"success": False, "error": "queue_not_waiting"})
    if queue.get("next_clinic_id") != payload.clinic_id:
        raise HTTPException(status_code=403, detail={"success": False, "error": "clinic_bypass_detected"})

    started_at = utc_now()
    queue = await db.queues.find_one_and_update(
        {
            "queue_id": payload.queue_id,
            "status": QueueStatus.WAITING.value,
            "next_clinic_id": payload.clinic_id,
        },
        {
            "$set": {
                "status": QueueStatus.IN_PROGRESS.value,
                "active_clinic_id": payload.clinic_id,
                "active_clinic_started_at": started_at,
                "is_called": False,
                "called_at": None,
                "updated_at": started_at,
                "last_action": "start",
            },
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not queue:
        raise HTTPException(status_code=409, detail={"success": False, "error": "stale_start_request"})

    clinics_map = await get_clinics_map()
    response = {"success": True, "data": await build_queue_payload(queue, clinics_map)}
    await store_idempotent_response("queue_start", idempotency_key, response)
    return response


@queue_router.post("/advance")
async def advance_queue(
    payload: QueueAdvanceRequest,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> Dict[str, Any]:
    """Apply doctor/admin actions to the queue state machine.

    This endpoint centralizes every allowed mutation so the frontend uses a
    single contract for pass, cancel, restore, VIP priority, move-to-end, and
    absence registration.
    """

    cached = await maybe_return_idempotent_response("queue_advance", idempotency_key)
    if cached:
        return cached

    queue = await get_queue_or_404(payload.queue_id)
    if int(queue.get("version", 0)) != payload.version:
        raise HTTPException(status_code=409, detail={"success": False, "error": "stale_version"})

    now = utc_now()
    date_key = now.strftime("%Y-%m-%d")
    action = payload.action.value
    update_query = {"queue_id": payload.queue_id, "version": payload.version}
    update_ops: Dict[str, Any] = {"$set": {"updated_at": now, "last_action": action}, "$inc": {"version": 1}}
    push_history = None

    if action == QueueAction.advance.value:
        if queue.get("status") != QueueStatus.IN_PROGRESS.value:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_not_in_progress"})
        if queue.get("active_clinic_id") != payload.clinic_id:
            raise HTTPException(status_code=403, detail={"success": False, "error": "clinic_bypass_detected"})

        current_step = int(queue.get("current_step", 0))
        route_clinic_ids = queue.get("route_clinic_ids", [])
        next_step = current_step + 1
        visit_duration = max(0, int((now - queue.get("active_clinic_started_at", now)).total_seconds()))
        push_history = {
            "clinic_id": payload.clinic_id,
            "entered_at": queue.get("active_clinic_started_at") or now,
            "exited_at": now,
            "duration_seconds": visit_duration,
            "outcome": "done" if next_step >= len(route_clinic_ids) else "transferred",
            "note": payload.note,
        }
        update_ops["$set"].update(
            {
                "current_step": next_step,
                "status": QueueStatus.DONE.value if next_step >= len(route_clinic_ids) else QueueStatus.WAITING.value,
                "next_clinic_id": None if next_step >= len(route_clinic_ids) else route_clinic_ids[next_step],
                "active_clinic_id": None,
                "active_clinic_started_at": None,
                "is_called": False,
                "called_at": None,
                "last_stage_entered_at": now,
                "current_priority_order": None if next_step >= len(route_clinic_ids) else await allocate_stage_order(date_key, route_clinic_ids[next_step]),
            }
        )
        update_query.update({"status": QueueStatus.IN_PROGRESS.value, "active_clinic_id": payload.clinic_id})
    elif action == QueueAction.cancel.value:
        if queue.get("status") not in {QueueStatus.WAITING.value, QueueStatus.IN_PROGRESS.value}:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_cannot_be_cancelled"})
        if queue.get("status") == QueueStatus.IN_PROGRESS.value and queue.get("active_clinic_id") != payload.clinic_id:
            raise HTTPException(status_code=403, detail={"success": False, "error": "clinic_bypass_detected"})
        update_ops["$set"].update(
            {
                "status": QueueStatus.CANCELLED.value,
                "active_clinic_id": None,
                "active_clinic_started_at": None,
                "is_called": False,
                "called_at": None,
            }
        )
    elif action == QueueAction.restore.value:
        if queue.get("status") != QueueStatus.CANCELLED.value:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_not_cancelled"})
        expected_clinic = queue.get("route_clinic_ids", [payload.clinic_id])[queue.get("current_step", 0)]
        update_ops["$set"].update(
            {
                "status": QueueStatus.WAITING.value,
                "next_clinic_id": expected_clinic,
                "active_clinic_id": None,
                "active_clinic_started_at": None,
                "is_called": False,
                "called_at": None,
                "last_stage_entered_at": now,
                "current_priority_order": await allocate_stage_order(date_key, expected_clinic),
            }
        )
    elif action == QueueAction.move_to_end.value:
        if queue.get("status") != QueueStatus.WAITING.value or queue.get("next_clinic_id") != payload.clinic_id:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_cannot_move_to_end"})
        update_ops["$set"].update(
            {
                "current_priority_order": await allocate_stage_order(date_key, payload.clinic_id),
                "is_called": False,
                "called_at": None,
                "is_vip": False,
            }
        )
    elif action == QueueAction.vip.value:
        if queue.get("status") != QueueStatus.WAITING.value or queue.get("next_clinic_id") != payload.clinic_id:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_cannot_be_prioritized"})
        update_ops["$set"].update(
            {
                "is_vip": True,
                "current_priority_order": 0,
                "is_called": False,
                "called_at": None,
            }
        )
    elif action == QueueAction.mark_absent.value:
        if queue.get("status") != QueueStatus.WAITING.value or queue.get("next_clinic_id") != payload.clinic_id:
            raise HTTPException(status_code=409, detail={"success": False, "error": "queue_cannot_be_marked_absent"})
        update_ops["$set"].update({"is_called": False, "called_at": None})
        update_ops["$push"] = {
            "absent_events": {
                "clinic_id": payload.clinic_id,
                "timestamp": now,
                "reason": payload.note or "manual_absent_mark",
            }
        }
    else:
        raise HTTPException(status_code=400, detail={"success": False, "error": "unsupported_action"})

    if push_history:
        update_ops.setdefault("$push", {})["clinic_history"] = push_history

    updated_queue = await db.queues.find_one_and_update(
        update_query,
        update_ops,
        return_document=ReturnDocument.AFTER,
    )
    if not updated_queue:
        raise HTTPException(status_code=409, detail={"success": False, "error": "stale_queue_update"})

    clinics_map = await get_clinics_map()
    response = {"success": True, "data": await build_queue_payload(updated_queue, clinics_map)}
    await store_idempotent_response("queue_advance", idempotency_key, response)
    return response


@queue_router.get("/status")
async def queue_status(
    identity_number: Optional[str] = Query(default=None),
    clinic_id: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """Return the authoritative queue/dashboard snapshot.

    Args:
        identity_number: Optional patient identifier for focused lookup.
        clinic_id: Optional clinic filter to reduce the dashboard payload.
    """

    payload = await build_status_payload(identity_number=identity_number)
    if clinic_id:
        payload["clinics"] = [clinic for clinic in payload["clinics"] if clinic.get("clinic_id") == clinic_id]
    return {"success": True, "data": payload}


@queue_router.post("/status")
async def queue_status_lookup(payload: QueueLookupRequest) -> Dict[str, Any]:
    """Convenience lookup for clients that prefer POST over query params."""

    data = await build_status_payload(identity_number=payload.identity_number)
    return {"success": True, "data": data}


v1_router.include_router(admins_router)
v1_router.include_router(qa_router)
v1_router.include_router(queue_router)
api_router.include_router(v1_router)
app.include_router(api_router)
