"""Best-effort Langfuse tracing for the agent workflow.

One trace per runtime process, one child observation per agent role. Tracing is
off unless LANGFUSE_ENABLED=true, and a failure here never fails a run: the
recorder swallows its own errors and warns on stderr. stdout is the JSONL
protocol and logging is disabled process-wide, so stderr is the only channel.

Model inputs are labeled ConfidentialityLabel.PRIVATE without exception, so no
prompt or completion text is sent. Observations carry length and a truncated
digest instead, plus the structural fields a demo post-mortem actually needs:
model, latency, token counts, finish_reason and schema-repair attempts.
"""
import asyncio
import base64
import contextlib
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

INGESTION_PATH = "/api/public/ingestion"
TIMEOUT_SECONDS = 4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(content: Any) -> dict[str, Any]:
    """Shape of PRIVATE content, never the content itself."""
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)
    return {"length": len(text), "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]}


def token_usage(response: Any) -> dict[str, Any] | None:
    """Read token counts if the framework surfaced them; report nothing if it did not."""
    usage = getattr(response, "usage", None) or getattr(response, "usage_details", None)
    if usage is None:
        return None
    def count(*names: str) -> int | None:
        for name in names:
            value = getattr(usage, name, None)
            if value is None and isinstance(usage, dict):
                value = usage.get(name)
            if isinstance(value, (int, float)):
                return int(value)
        return None
    prompt = count("input_tokens", "prompt_tokens", "input")
    completion = count("output_tokens", "completion_tokens", "output")
    if prompt is None and completion is None:
        return None
    total = count("total_tokens", "total") or (prompt or 0) + (completion or 0)
    return {"input": prompt or 0, "output": completion or 0, "total": total, "unit": "TOKENS"}


class Recorder:
    """Collects observations in memory and ships them in one request at the end."""

    def __init__(self) -> None:
        self.trace_id = str(uuid.uuid4())
        self.events: list[dict[str, Any]] = []
        self.enabled = os.environ.get("LANGFUSE_ENABLED", "false").strip().lower() == "true"
        self.url = os.environ.get("LANGFUSE_URL", "http://localhost:3100").rstrip("/")
        public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
        secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")
        if self.enabled and not (public_key and secret_key):
            self._warn("LANGFUSE_ENABLED=true but keys are missing; tracing stays off")
            self.enabled = False
        self._credentials = f"{public_key}:{secret_key}"

    def _warn(self, message: str) -> None:
        print(f"langfuse: {message}", file=sys.stderr, flush=True)

    def _event(self, event_type: str, body: dict[str, Any]) -> None:
        self.events.append({"id": str(uuid.uuid4()), "timestamp": _now(), "type": event_type, "body": body})

    @contextlib.asynccontextmanager
    async def step(self, name: str, *, role: str, model: str | None = None):
        """Time one workflow step. The body fills the yielded dict with span detail."""
        if not self.enabled:
            yield {}
            return
        start, detail = _now(), {}
        try:
            yield detail
        except Exception as error:
            detail.setdefault("level", "ERROR")
            detail.setdefault("status_message", type(error).__name__)
            raise
        finally:
            with contextlib.suppress(Exception):
                self._observation(name, role, model, start, detail)

    def _observation(self, name: str, role: str, model: str | None, start: str, detail: dict[str, Any]) -> None:
        body: dict[str, Any] = {"id": str(uuid.uuid4()), "traceId": self.trace_id, "name": name,
                                "startTime": start, "endTime": _now(),
                                "metadata": {"role": role, **{k: v for k, v in detail.items()
                                                              if k not in ("usage", "level", "status_message", "input", "output")}}}
        for field in ("level", "status_message", "input", "output"):
            if field in detail:
                body[field] = detail[field]
        # generation-create is what makes Langfuse render the model, latency and token columns.
        if model:
            body["model"] = model
            if detail.get("usage"):
                body["usage"] = detail["usage"]
            self._event("generation-create", body)
        else:
            self._event("span-create", body)

    async def flush(self, *, name: str, detail: dict[str, Any] | None = None) -> None:
        if not self.enabled or not self.events:
            return
        self._event("trace-create", {"id": self.trace_id, "name": name, "timestamp": _now(),
                                     "tags": ["assistent", "workshop"], "metadata": detail or {}})
        payload = {"batch": self.events, "metadata": {"sdk": "agent-runtime"}}
        self.events = []
        with contextlib.suppress(Exception):
            await asyncio.to_thread(self._post, payload)

    def _post(self, payload: dict[str, Any]) -> None:
        # urllib speaks HTTP/1.1 only, which is required: Langfuse's Next.js frontend
        # resets HTTP/2 connections mid-handshake when self-hosted.
        request = urllib.request.Request(
            self.url + INGESTION_PATH,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     "Authorization": "Basic " + base64.b64encode(self._credentials.encode("utf-8")).decode("ascii")},
            method="POST")
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                if response.status >= 300:
                    self._warn(f"ingestion returned HTTP {response.status}")
        except urllib.error.HTTPError as error:
            self._warn(f"ingestion returned HTTP {error.code}")
        except Exception as error:
            self._warn(f"ingestion failed: {type(error).__name__}")
