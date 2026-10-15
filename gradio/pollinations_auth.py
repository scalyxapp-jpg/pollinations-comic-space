"""Sign a visitor in with their own Pollen, using the device flow.

The device flow needs no redirect URI, which is what makes it usable inside a
Space. ``client_id`` is optional: with an app key the app is attributed and earns
its share, and without one the visitor still pays with their own Pollen.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import requests

ENTER_URL = os.environ.get("POLLINATIONS_ENTER_URL", "https://enter.pollinations.ai")
DEFAULT_TIMEOUT_SECONDS = 300


class DeviceAuthError(RuntimeError):
    """A failure worth showing to the visitor."""


@dataclass(frozen=True)
class DeviceCode:
    """What the visitor has to see in order to approve the sign-in."""

    device_code: str
    user_code: str
    verification_url: str
    interval: int


def app_key() -> str | None:
    """The optional app key ('pk_...') that attributes visitors to this Space."""
    value = (os.environ.get("POLLINATIONS_APP_KEY") or "").strip()
    return value or None


def request_device_code(scope: str = "profile usage") -> DeviceCode:
    body: dict[str, str] = {"scope": scope}
    key = app_key()
    if key:
        body["client_id"] = key
    response = requests.post(f"{ENTER_URL}/api/device/code", json=body, timeout=30)
    if response.status_code // 100 != 2:
        raise DeviceAuthError(_describe(response))
    payload = response.json()
    return DeviceCode(
        device_code=payload["device_code"],
        user_code=payload["user_code"],
        verification_url=payload.get("verification_uri_complete")
        or payload["verification_uri"],
        interval=int(payload.get("interval") or 5),
    )


def poll_for_key(
    device_code: DeviceCode, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
) -> str:
    """Wait until the visitor approves, then return the minted API key."""
    body: dict[str, str] = {"device_code": device_code.device_code}
    key = app_key()
    if key:
        body["client_id"] = key

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        response = requests.post(f"{ENTER_URL}/api/device/token", json=body, timeout=30)
        payload = _payload(response)
        if response.status_code // 100 == 2 and payload.get("access_token"):
            return str(payload["access_token"])
        error = str(payload.get("error") or "")
        if error in {"authorization_pending", ""}:
            time.sleep(device_code.interval)
            continue
        raise DeviceAuthError(
            payload.get("error_description") or error or _describe(response)
        )
    raise DeviceAuthError(
        "The sign-in was not approved in time. Press the button again for a new code."
    )


def _payload(response: requests.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _describe(response: requests.Response) -> str:
    payload = _payload(response)
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    if isinstance(error, str) and error:
        return error
    return f"Pollinations answered HTTP {response.status_code}"
