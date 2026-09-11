"""Microsoft Agent Framework workflow; JSONL over private parent/child pipes.

The host owns sourced case data and human consent. This runtime owns agent
execution and the triage -> fan-out -> reviewer graph. No public HTTP port.
"""
import asyncio
import json
import logging
import os
import re
import sys
import uuid
from typing import Any
from urllib.parse import urlsplit

from agent_framework import Agent, Executor, WorkflowBuilder, WorkflowContext, agent_middleware, handler
from agent_framework.openai import OpenAIChatCompletionClient
from agent_framework.security import ConfidentialityLabel, ContentLabel, IntegrityLabel, LabeledMessage
from jsonschema import Draft202012Validator
from langfuse_tracing import Recorder, redact, token_usage
from openai import AsyncOpenAI, APIStatusError, APIConnectionError, APITimeoutError

logging.disable(logging.CRITICAL)  # stdout is a protocol, never a prompt/credential log.
RECORDER = Recorder()  # One process is one assistant run, so one trace.
FRAMEWORK = {"name": "Microsoft Agent Framework", "version": "1.17.0", "language": "Python"}
SECURITY_CONTRACT = {"integrity": "untrusted", "confidentiality": "private", "allowedCapabilities": ["analyze"]}
TELENOR_HOSTNAME_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9.-]*\.(?:execute-api\.[a-z0-9-]+\.amazonaws\.com|telenor\.(?:no|com))$", re.IGNORECASE)


def emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def safe_error(error: Exception) -> str:
    # Framework clients wrap SDK errors. Inspect typed causes, never their raw text.
    seen: set[int] = set()
    while id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, (APIStatusError, APIConnectionError, APITimeoutError, TimeoutError)):
            break
        cause = error.__cause__ or getattr(error, "inner_exception", None)
        if not isinstance(cause, Exception):
            break
        error = cause
    label = provider_label()
    if isinstance(error, APIStatusError):
        if error.status_code in (401, 403):
            return f"{label} avviste tilgangen. Kontroller serverens nøkkel og modelltilgang."
        if error.status_code in (402, 429):
            return f"{label} har nådd en bruksgrense. Kontroller saldo eller vent før du prøver igjen."
        return f"{label} kunne ikke fullføre modellkallet (HTTP {error.status_code})."
    if isinstance(error, (TimeoutError, APIConnectionError, APITimeoutError)):
        return f"{label} kunne ikke nås innen tidsgrensen. Opplysningene er bevart; prøv analysen på nytt."
    if isinstance(error, ValueError) and str(error).startswith("KI returnerte"):
        return str(error)
    return "Agentkjøringen kunne ikke fullføres. Opplysningene er bevart; kontroller Python-oppsettet og prøv igjen."


def configured_provider() -> str:
    # Presence selects the generic endpoint even when its value is invalid: never fall back silently.
    return (os.environ.get("AI_PROVIDER") or ("litellm" if "LLM_BASE_URL" in os.environ else "cloudflare")).strip().lower()


def provider_label() -> str:
    return {"telenor": "Telenor AI Factory", "litellm": "Modelltjenesten"}.get(configured_provider(), "Cloudflare")


def provider_configuration() -> dict[str, Any]:
    provider = configured_provider()
    if provider == "litellm":
        base_url = os.environ.get("LLM_BASE_URL", "").strip()
        api_key = os.environ.get("LLM_API_KEY", "")
        url = urlsplit(base_url)
        secure = url.scheme == "https" or (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1"))
        if not url.hostname or not secure or url.username or url.password or url.query or url.fragment or not api_key:
            raise ValueError("Invalid server configuration")
        return {"api_key": api_key, "base_url": base_url.rstrip("/"), "max_retries": 0}
    if provider == "telenor":
        base = os.environ.get("TELENOR_AI_FACTORY_BASE_URL", "").strip()
        key = os.environ.get("TELENOR_AI_FACTORY_API_KEY", "").strip()
        parts = urlsplit(base)
        if parts.scheme != "https" or not TELENOR_HOSTNAME_PATTERN.match(parts.hostname or "") or parts.username or parts.password or parts.query or parts.fragment or not key:
            raise ValueError("Invalid server configuration")
        root = base.rstrip("/")
        return {"api_key": key, "base_url": root if root.endswith("/v1") else root + "/v1", "max_retries": 0}
    if provider != "cloudflare":
        raise ValueError("Invalid server configuration")
    account = os.environ.get("CF_ACCOUNT_ID", "")
    token = os.environ.get("CF_AI_GATEWAY_TOKEN", "")
    gateway = os.environ.get("CF_AI_GATEWAY_ID", "default")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", gateway):
        raise ValueError("Invalid server configuration")
    return {"api_key": token, "base_url": f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
            "max_retries": 0, "default_headers": {"cf-aig-gateway-id": gateway, "cf-aig-skip-cache": "true", "cf-aig-collect-log": "false"}}


async def host_agent(bridge, job):
    async with RECORDER.step(job["name"], role=job.get("id", "agent"), model=job["model"]) as span:
        span["executor"] = "host"  # Tokens live on the host side of the pipe, out of reach here.
        result = await bridge.request("model", job)
        if result.get("error"):
            raise ValueError("Host model failed")
        span["output"] = redact(result["output"])
        return result["output"]


async def run_stage(bridge, job: dict[str, Any], host_models: bool) -> Any:
    return await host_agent(bridge, job) if host_models else await run_agent(job)


def secured_message(role: str, content: str, *, trusted: bool = False) -> LabeledMessage:
    """Label model inputs with FIDES metadata without putting identities in labels."""
    return LabeledMessage(
        role=role,
        content=content,
        security_label=ContentLabel(
            integrity=IntegrityLabel.TRUSTED if trusted else IntegrityLabel.UNTRUSTED,
            confidentiality=ConfidentialityLabel.PRIVATE,
            metadata={"source": "host-controlled" if trusted else "citizen-or-external-data"},
        ),
    )


@agent_middleware
async def analysis_only_middleware(context, call_next) -> None:
    """Fail closed if a model run gains a tool/action capability or loses its labels."""
    declared_tools = (getattr(context.agent, "default_options", None) or {}).get("tools")
    option_tools = context.options.get("tools") if context.options else None
    if context.tools or declared_tools or option_tools:
        raise ValueError("Agent security policy rejected an unauthorized capability")
    if not context.messages or any(not isinstance(message, LabeledMessage) for message in context.messages):
        raise ValueError("Agent security policy rejected unlabeled input")
    if any(message.security_label.confidentiality != ConfidentialityLabel.PRIVATE for message in context.messages):
        raise ValueError("Agent security policy rejected incorrectly labeled input")
    await call_next()


def validate_security_contract(job: dict[str, Any]) -> None:
    context = job.get("context")
    if not isinstance(context, dict) or context.get("_security") != SECURITY_CONTRACT:
        raise ValueError("Agent security policy rejected the model context")


def response_content(response) -> str:
    """Reasoning models leave text empty and put the turn in reasoning_content."""
    text = (getattr(response, "text", None) or "").strip()
    if text:
        return text
    for message in reversed(getattr(response, "messages", None) or []):
        for content in getattr(message, "contents", None) or []:
            for candidate in (content, getattr(content, "raw_representation", None)):
                value = getattr(candidate, "reasoning_content", None)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return ""


async def run_agent(job: dict[str, Any], client_factory=AsyncOpenAI) -> dict[str, Any]:
    """One framework Agent, strict schema, at most one format repair in one budget."""
    validate_security_contract(job)
    timeout = min(180000, max(10000, int(os.environ.get("ASSISTANT_MODEL_TIMEOUT_MS", "90000")))) / 1000
    schema = job["schema"]
    validator = Draft202012Validator(schema)
    messages = [secured_message("user", json.dumps(job["context"], ensure_ascii=False))]
    async with RECORDER.step(job["name"], role=job.get("id", "agent"), model=job["model"]) as span:
        span["input"] = redact(job["context"])
        async with asyncio.timeout(timeout):
            async with client_factory(**provider_configuration(), timeout=timeout) as sdk:
                cloudflare = configured_provider() == "cloudflare"
                model = job["model"].removeprefix("workers-ai/") if cloudflare else job["model"]
                options = {"temperature": 0, "max_tokens": 2400, "response_format": {"type": "json_object"}, "store": False}
                if cloudflare:
                    options["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
                chat = OpenAIChatCompletionClient(model=model, async_client=sdk)
                agent = Agent(client=chat, name=job["name"], instructions=job["prompt"] + "\nReturn exactly one JSON object matching: " + json.dumps(schema),
                              middleware=[analysis_only_middleware],
                              default_options=options)
                for attempt in range(2):
                    response = await agent.run(messages)
                    content = response_content(response)
                    # Each attempt overwrites: the span ends up describing the attempt that decided the outcome.
                    span.update(attempts=attempt + 1, finish_reason=response.finish_reason,
                                usage=token_usage(response), output=redact(content))
                    issues: list[dict[str, Any]] = []
                    try:
                        output = json.loads(content)
                        issues = [{"path": list(error.path), "code": error.validator} for error in validator.iter_errors(output)]
                        if response.finish_reason != "length" and not issues:
                            return output
                    except (ValueError, TypeError):
                        issues = [{"code": "invalid-json"}]
                    span["validation_issues"] = [issue["code"] for issue in issues]
                    if attempt == 0:
                        messages.extend([secured_message("assistant", content[:12000]), secured_message("user",
                            "The previous output was rejected. Correct only its format against the schema, preserving grounded values, reply language and exact quotes. "
                            "Return no extra properties or reasoning. Validation issues: " + json.dumps(issues), trusted=True)])
                raise ValueError("KI returnerte et ufullstendig svar eller et format som ikke kunne kontrolleres. Ingen forslag er godkjent. Prøv igjen.")


class HostBridge:
    def __init__(self, reader: asyncio.StreamReader):
        self.reader = reader
        self.pending: dict[str, asyncio.Future] = {}

    async def request(self, method: str, data: dict[str, Any]) -> Any:
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        emit({"type": "request", "id": request_id, "method": method, "data": data})
        try:
            return await future
        finally:
            self.pending.pop(request_id, None)

    async def listen(self) -> None:
        while line := await self.reader.readline():
            message = json.loads(line)
            future = self.pending.get(message.get("id"))
            if future and not future.done():
                if message.get("error"):
                    future.set_exception(ValueError("Host rejected workflow operation"))
                else:
                    future.set_result(message.get("data"))
        for future in self.pending.values():
            if not future.done():
                future.cancel()


class Triage(Executor):
    def __init__(self, bridge: HostBridge, host_models: bool):
        super().__init__(id="triage")
        self.bridge, self.host_models = bridge, host_models

    @handler
    async def plan(self, payload: dict, ctx: WorkflowContext[dict]) -> None:
        job = payload["triage"]
        await self.bridge.request("started", {"id": "triage", "role": "triage", "name": job["name"]})
        output = await run_stage(self.bridge, job, self.host_models)
        prepared = await self.bridge.request("prepare", {"output": output})
        await ctx.send_message(prepared)


class Specialist(Executor):
    def __init__(self, service_id: str, bridge: HostBridge, host_models: bool):
        super().__init__(id=service_id)
        self.bridge, self.host_models = bridge, host_models

    @handler
    async def assess(self, payload: dict, ctx: WorkflowContext[dict]) -> None:
        job = next((item for item in payload["jobs"] if item["id"] == self.id), None)
        result: dict[str, Any] = {"id": self.id, "status": "skipped"}
        if job:
            await self.bridge.request("started", {"id": self.id, "role": "draft", "name": job["name"]})
            try:
                output = await run_stage(self.bridge, job, self.host_models)
                await self.bridge.request("specialist", {"id": self.id, "output": output})
                result["status"] = "completed"
            except Exception as error:
                await self.bridge.request("specialist", {"id": self.id, "error": safe_error(error)})
                result["status"] = "failed"
        # Every graph branch emits once, including unselected services. The fixed fan-in
        # never waits forever for a branch that did not need an actual model call.
        await ctx.send_message(result)


class Reviewer(Executor):
    def __init__(self, bridge: HostBridge, host_models: bool):
        super().__init__(id="reviewer")
        self.bridge, self.host_models = bridge, host_models

    @handler
    async def review(self, results: list[dict], ctx: WorkflowContext[dict, dict]) -> None:
        async with RECORDER.step("join", role="join") as span:
            span["branches"] = {result["id"]: result["status"] for result in results}
            # The host owns stage order and the revision bound; a job of None ends the tail.
            payload: dict[str, Any] = {}
            while job := ((await self.bridge.request("stage", payload)) or {}).get("job"):
                try:
                    payload = {"id": job["id"], "output": await run_stage(self.bridge, job, self.host_models)}
                except Exception as error:
                    payload = {"id": job["id"], "error": safe_error(error)}
            await ctx.yield_output({"framework": FRAMEWORK, "branches": results})


def build_workflow(bridge: HostBridge, host_models: bool = False):
    triage = Triage(bridge, host_models)
    specialists = [Specialist(service_id, bridge, host_models) for service_id in ("family", "housing", "moving")]
    reviewer = Reviewer(bridge, host_models)
    return (WorkflowBuilder(start_executor=triage, name="citizen-assistance", output_from=[reviewer])
            .add_fan_out_edges(triage, specialists).add_fan_in_edges(specialists, reviewer).build())


async def main() -> None:
    reader = asyncio.StreamReader(limit=2 * 1024 * 1024)
    await asyncio.get_running_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    payload = json.loads(await reader.readline())
    if payload.get("mode") == "probe":
        emit({"type": "complete", "framework": FRAMEWORK})
        return
    bridge = HostBridge(reader)
    listener = asyncio.create_task(bridge.listen())

    async def execute():
        if payload.get("mode") == "single":
            return {"output": await run_agent(payload["job"]), "framework": FRAMEWORK}
        workflow = build_workflow(bridge, payload.get("hostModels") is True)
        result = await workflow.run(payload)
        return result.get_outputs()[0]

    task = asyncio.create_task(execute())
    outcome = "completed"
    try:
        done, _ = await asyncio.wait([task, listener], return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            emit({"type": "complete", **task.result()})
    except Exception as error:
        outcome = "failed"
        emit({"type": "error", "message": safe_error(error)})
    finally:
        task.cancel()
        listener.cancel()
        await asyncio.gather(task, listener, return_exceptions=True)
        await RECORDER.flush(name=f"assistent · {payload.get('mode', 'workflow')}",
                             detail={"mode": payload.get("mode", "workflow"), "outcome": outcome,
                                     "hostModels": payload.get("hostModels") is True})


if __name__ == "__main__":
    asyncio.run(main())
