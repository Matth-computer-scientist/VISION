import os

os.environ.setdefault("VISION_WORKER_TOKEN", "test-worker-secret")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def base_payload(**overrides):
    payload = {
        "job_id": "11111111-1111-1111-1111-111111111111",
        "kind": "image_upscale",
        "input_uri": "input.png",
        "output_dir": "out",
        "callback_url": "http://api/callback",
        "worker_token": "test-worker-secret",
    }
    payload.update(overrides)
    return payload


def test_worker_execute_rejects_wrong_token():
    response = client.post(
        "/v1/worker/execute",
        json=base_payload(worker_token="wrong-token"),
    )
    assert response.status_code == 401


def test_worker_execute_accepts_correct_token():
    response = client.post(
        "/v1/worker/execute",
        json=base_payload(),
    )
    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] is True


def test_pipelines_endpoint_lists_new_pipelines():
    response = client.get("/v1/pipelines")
    assert response.status_code == 200
    ids = {pipeline["id"] for pipeline in response.json()}
    assert {"colorization", "denoise", "segmentation"}.issubset(ids)
