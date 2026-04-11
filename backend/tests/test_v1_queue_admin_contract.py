"""Backend contract tests for v1 admin/patient/queue workflows."""

import os
import time
import uuid

import pytest
import requests


# Module: shared endpoint + test data setup for admin/patient/queue features
BASE_URL = (os.environ.get("API_BASE") or os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")


@pytest.fixture(scope="session")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="session")
def ctx():
    timestamp = int(time.time())
    suffix = uuid.uuid4().hex[:6]
    return {
        "admin_token": None,
        "doctor_id": None,
        "doctor_username": f"test_doc_{suffix}",
        "doctor_password": f"DocPass!{suffix}",
        "doctor_clinic": "lab",
        "patient_main": str(timestamp)[-10:],
        "patient_aux": str(timestamp + 1)[-10:],
    }


def _require_base_url():
    if not BASE_URL:
        pytest.fail("API_BASE/REACT_APP_BACKEND_URL is missing; cannot execute backend contract tests")


def _post(client, path, payload, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else None
    return client.post(f"{BASE_URL}{path}", json=payload, headers=headers, timeout=30)


def _get(client, path, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else None
    return client.get(f"{BASE_URL}{path}", headers=headers, timeout=30)


# Module: authentication + admin contract tests
def test_admin_login_returns_success_token(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/admin/status",
        {"action": "admin_login", "username": "admin", "password": "BOMUSSA14490"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert isinstance(data.get("token"), str) and data.get("token"), body
    ctx["admin_token"] = data["token"]


# Module: patient login + queue status contract tests
def test_patient_login_creates_or_restores_queue_entry(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/patient/login",
        {"patientId": ctx["patient_main"], "gender": "male", "examType": "recruitment"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert data.get("patientId") == ctx["patient_main"], body
    assert isinstance(data.get("route"), list) and len(data.get("route", [])) > 0, body
    assert data.get("currentClinic"), body
    assert isinstance(data.get("queueNumber"), int), body


def test_patient_queue_status_returns_steps_and_current_visit(api_client, ctx):
    _require_base_url()
    response = _get(api_client, f"/api/v1/queue/status?patientId={ctx['patient_main']}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert data.get("patientId") == ctx["patient_main"], body
    assert isinstance(data.get("steps"), list), body
    assert "currentVisit" in data, body


# Module: queue action contracts
def test_call_next_moves_patient_to_called_state(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/queue/call",
        {"action": "call_next", "clinicId": "lab"},
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert "clinicId" in data, body


def test_complete_patient_advances_route(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/queue/done",
        {
            "action": "complete_patient",
            "clinicId": "lab",
            "patientId": ctx["patient_main"],
        },
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert data.get("patientId") == ctx["patient_main"], body
    assert "nextClinic" in data, body


def test_mark_absent_sets_skipped_no_show(api_client, ctx):
    _require_base_url()
    _post(
        api_client,
        "/api/v1/patient/login",
        {"patientId": ctx["patient_aux"], "gender": "male", "examType": "recruitment"},
    )

    response = _post(
        api_client,
        "/api/v1/queue/call",
        {
            "action": "mark_absent",
            "clinicId": "lab",
            "patientId": ctx["patient_aux"],
        },
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body


def test_transfer_patient_moves_to_target_clinic_waiting(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/queue/call",
        {
            "action": "transfer_patient",
            "clinicId": "lab",
            "patientId": ctx["patient_main"],
            "targetClinicId": "xray",
        },
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert data.get("clinicId") == "xray", body


def test_postpone_patient_keeps_active_deprioritized(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/queue/call",
        {
            "action": "postpone_patient",
            "clinicId": "lab",
            "patientId": ctx["patient_aux"],
        },
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body


def test_vip_fast_track_prioritizes_waiting_patient(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/queue/call",
        {
            "action": "vip_fast_track",
            "clinicId": "lab",
            "patientId": ctx["patient_aux"],
        },
        token=ctx.get("admin_token"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body


# Module: admin dashboard + doctor management contracts
def test_admin_status_with_bearer_returns_overview(api_client, ctx):
    _require_base_url()
    response = _get(api_client, "/api/v1/admin/status", token=ctx.get("admin_token"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert isinstance(data.get("overview"), dict), body
    assert isinstance(data.get("clinics"), list), body
    assert isinstance(data.get("doctors"), list), body


def test_admin_doctor_management_actions(api_client, ctx):
    _require_base_url()
    token = ctx.get("admin_token")

    create_res = _post(
        api_client,
        "/api/v1/admin/status",
        {
            "action": "create_doctor",
            "displayName": "TEST Doctor",
            "username": ctx["doctor_username"],
            "password": ctx["doctor_password"],
            "clinicId": ctx["doctor_clinic"],
        },
        token=token,
    )
    assert create_res.status_code == 200, create_res.text
    create_body = create_res.json()
    assert create_body.get("success") is True, create_body
    doctor_id = (create_body.get("data") or {}).get("doctorId")
    assert isinstance(doctor_id, str) and doctor_id, create_body
    ctx["doctor_id"] = doctor_id

    update_res = _post(
        api_client,
        "/api/v1/admin/status",
        {"action": "update_doctor_password", "doctorId": doctor_id, "password": f"{ctx['doctor_password']}#"},
        token=token,
    )
    assert update_res.status_code == 200, update_res.text
    assert update_res.json().get("success") is True, update_res.json()
    ctx["doctor_password"] = f"{ctx['doctor_password']}#"

    freeze_res = _post(
        api_client,
        "/api/v1/admin/status",
        {"action": "toggle_doctor_freeze", "doctorId": doctor_id},
        token=token,
    )
    assert freeze_res.status_code == 200, freeze_res.text
    assert freeze_res.json().get("success") is True, freeze_res.json()

    unfreeze_res = _post(
        api_client,
        "/api/v1/admin/status",
        {"action": "toggle_doctor_freeze", "doctorId": doctor_id},
        token=token,
    )
    assert unfreeze_res.status_code == 200, unfreeze_res.text
    assert unfreeze_res.json().get("success") is True, unfreeze_res.json()

    delete_res = _post(
        api_client,
        "/api/v1/admin/status",
        {"action": "delete_doctor", "doctorId": doctor_id},
        token=token,
    )
    assert delete_res.status_code == 200, delete_res.text
    assert delete_res.json().get("success") is True, delete_res.json()


def test_doctor_login_for_created_doctor(api_client, ctx):
    _require_base_url()
    response = _post(
        api_client,
        "/api/v1/admin/status",
        {
            "action": "doctor_login",
            "username": ctx["doctor_username"],
            "password": ctx["doctor_password"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert isinstance(data.get("token"), str) and data.get("token"), body
    assert isinstance(data.get("doctorId"), str) and data.get("doctorId"), body


def test_doctor_queue_status_dashboard_payload(api_client, ctx):
    _require_base_url()
    login_res = _post(
        api_client,
        "/api/v1/admin/status",
        {
            "action": "doctor_login",
            "username": ctx["doctor_username"],
            "password": ctx["doctor_password"],
        },
    )
    assert login_res.status_code == 200, login_res.text
    login_data = (login_res.json().get("data") or {})
    doctor_token = login_data.get("token")
    doctor_id = login_data.get("doctorId")
    assert doctor_token and doctor_id, login_res.json()

    response = _get(api_client, f"/api/v1/queue/status?doctorId={doctor_id}", token=doctor_token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("success") is True, body
    data = body.get("data") or {}
    assert isinstance(data.get("doctor"), dict), body
    assert isinstance(data.get("stats"), dict), body
    assert isinstance(data.get("waitingPatients"), list), body
