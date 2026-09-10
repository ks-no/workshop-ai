# Microsoft Agent Framework integration research

Research date: 2026-09-03 (Europe/Oslo). Scope: local Python workflow process, Cloudflare Qwen/Gemma, reusable Node domain/storage boundary. No production edits, real model calls, servers, or system installs were performed for this research.

## Recommendation

Use a Python child process per analysis, connected through bidirectional JSON Lines on stdin/stdout. Use the stable explicit `WorkflowBuilder`: planner → Node preparation request → three parallel domain executors → join. Each domain executor calls its Gemma `Agent` only when Node supplied a selected job; otherwise it emits a typed `skipped` envelope. This matches the controller's chosen design and makes framework scheduling substantive.

Node retains the case lock, revision, SQLite, document extraction, exact-citation verification, deterministic rules and explicit human confirmation. Python owns `Agent` calls, scheduling, fan-out, join and framework events. Do not retain the current Node `Promise.all` orchestration behind three cosmetic Python model wrappers.

## Verified versions and API changes

| Component | Verified release/runtime | Consequence |
|---|---|---|
| `agent-framework-core` | **1.17.0**, released September 3, 2026; Python >=3.10 | Pin this release. Search indexes still returned 1.16.0. |
| `agent-framework-openai` | **1.14.2**, released September 3, 2026 | Provider versions differ from core. This package requires core >=1.17.0,<2 and OpenAI >=2.25.0,<4. |
| Controller's project environment | Python 3.13.2; core 1.17.0; provider 1.14.2; OpenAI SDK 3.7.0 | Import/signature checks and graph smoke test ran in `backend/.venv`. |
| `Agent` | `Agent(client=..., name=..., instructions=..., default_options=...)`; `await agent.run(..., options=...)` | Use actual framework agents, with no model-authorized submission tools. |
| Chat Completions provider | `from agent_framework.openai import OpenAIChatCompletionClient` | **`OpenAIChatClient` now means Responses API**, unsuitable for the existing Cloudflare Chat Completions route. |
| Functional workflow | `@workflow` returns a definition; call `.build()` then `.run()` | Experimental in 1.17.0. Old direct `decorated_function.run()` examples are stale. |

The umbrella `agent-framework` package is unnecessary here. Minimal project dependencies are `agent-framework-core==1.17.0` and `agent-framework-openai==1.14.2`, plus a lock of the resolved dependency set. `agent_framework.openai` in core is a lazy re-export; core alone does not install the provider. [Core release](https://pypi.org/project/agent-framework-core/1.17.0/), [provider release](https://pypi.org/project/agent-framework-openai/1.14.2/).

Verification used official PyPI JSON metadata and extracted wheel source under `/private/tmp/maf-research`, then the controller-installed environment. No assumption was made from GitHub `main`. The documentation-discovery skill's Context7 lookup found no package; official Microsoft Learn and released source were the fallback.

## Cloudflare client: source-verified API shape

`OpenAIChatCompletionClient` accepts `model`, `base_url`, `default_headers`, `async_client` and `instruction_role`. Use an explicitly configured `AsyncOpenAI` to disable its default transport retries and retain the existing retry policy. The endpoint base ends at `/ai/v1/`; the SDK adds `/chat/completions`. [Microsoft's compatible-endpoint documentation](https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting/openai-endpoints), [provider integration](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/openai).

```python
import os
from agent_framework import Agent
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

# Create and close this client inside the analysis child's async lifetime.
sdk = AsyncOpenAI(
    api_key=os.environ["CF_AI_GATEWAY_TOKEN"],
    base_url=("https://api.cloudflare.com/client/v4/accounts/"
              f"{os.environ['CF_ACCOUNT_ID']}/ai/v1/"),
    max_retries=0,
    timeout=90.0,
    default_headers={
        "cf-aig-gateway-id": os.getenv("CF_AI_GATEWAY_ID", "default"),
        "cf-aig-skip-cache": "true",
        "cf-aig-collect-log": "false",
    },
)
client = OpenAIChatCompletionClient(
    model=selected_model.removeprefix("workers-ai/"),
    async_client=sdk,
    instruction_role="system",
)
agent = Agent(client=client, name=role_name, instructions=trusted_instructions)
response = await agent.run(serialized_minimal_context, options={
    "temperature": 0,
    "max_tokens": 2400,
    "response_format": {"type": "json_object"},
    "store": False,
    "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
})
raw_output = response.text
# Apply the existing strict contract and bounded format repair before acceptance.
# At the analysis lifetime boundary: await sdk.close().
```

This is an integration fragment, not a standalone program: `selected_model`, instructions, context and validation come from the existing contracts. Released provider source maps `max_tokens` to `max_completion_tokens`; recognized JSON-mode dictionaries pass through. Extra OpenAI request options are forwarded. Do not accidentally pass a Pydantic model as `response_format`: that selects constrained JSON Schema output and reverses the application's previously measured JSON-mode decision.

Keep the current role precedence: explicit coordinator/specialist setting → `LLM_MODEL` → built-in Qwen/Gemma default. A distinct Agent instance per concurrently selected specialist avoids shared agent/session state. Share neither mutable messages nor mutable options. The framework introduces no reason to send larger contexts or system credentials in JSONL. Cloudflare compatibility and wire headers still require the controller's live integration check; this research made no inference request.

`timeout=90` is only a client request setting. An outer monotonic deadline must bound the complete semantic agent run, including at most one format repair. Disable SDK retries; do not retry HTTP, transport or body-read failures. Preserve strict Node acceptance of every returned plan/finding, even if Python also parses it.

## Explicit workflow and dynamic fan-out

The current builder requires a start executor in its constructor. `add_fan_out_edges` broadcasts concurrently; `add_fan_in_edges` waits for every listed source. `add_multi_selection_edge_group` supports runtime subset selection through `selection_func(message, available_ids)`. [Workflow edges](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/edges).

**Important trap:** a dynamic subset routed into a fixed three-source fan-in cannot complete when an omitted source never sends a message. Released `FanInEdgeRunner._can_execute()` checks a buffer for every listed source. For the fixed three-service allowlist, invoke all three framework wrappers, return a skipped envelope without calling the model for unselected services, and filter skipped envelopes at join. Record skipped executor work separately from actual model runs.

```python
from agent_framework import WorkflowBuilder

# Each object below is an Executor, with @handler methods.
flow = (
    WorkflowBuilder(start_executor=planner, output_from=[join])
    .add_edge(planner, prepare_in_node)
    .add_fan_out_edges(prepare_in_node, [family, housing, moving])
    .add_fan_in_edges([family, housing, moving], join)
    .build()
)
```

Within a selected domain executor, `await gemma_agent.run(...)` must use only that service's prepared context. Catch a specialist failure into a typed error envelope so the other results survive; the join then emits completed/error results to Node, whose existing gate blocks a failed-specialist handoff. An unselected wrapper returns `skipped`, not a fabricated successful analysis. With no selected services, all three skip and the workflow still returns the planner's questions/unsupported needs.

The bridge executor uses external-input requests for **Node tool work**, not citizen consent:

```python
from agent_framework import Executor, WorkflowContext, handler, response_handler

class PrepareInNode(Executor):
    @handler
    async def prepare(self, plan: dict, ctx: WorkflowContext[dict]) -> None:
        await ctx.request_info(
            {"operation": "validate-plan-and-prepare", "plan": plan},
            dict,
            request_id="prepare",
        )

    @response_handler
    async def resume(
        self, original: dict, prepared: dict, ctx: WorkflowContext[dict]
    ) -> None:
        await ctx.send_message(prepared)
```

The production version should use typed dataclasses/Pydantic envelopes and validate the operation, request ID, run ID and expected revision in Node. `dict` here illustrates the verified API signatures; it is not a proposed trust boundary.

**Executed smoke test:** installed 1.17.0 graph paused at `request_info`, resumed with `flow.run(responses={"prepare": ...}, stream=True)`, scheduled three wrappers, produced one selected and two skipped results, and reached the join. Observed events included `executor_invoked`, `executor_completed`, `superstep_started`, `superstep_completed` and `output`. This was a framework-control test with fixed synthetic values, not a model-quality test. Temporary test: `/private/tmp/maf-research/graph-smoke.py`.

## JSONL process contract

Proposed host protocol (application-owned, not a built-in Agent Framework transport):

| Direction | Envelope | Meaning |
|---|---|---|
| Node → Python | `start {runId, caseId, revision, context, schemas}` | One analysis, under Node's existing lock. |
| Python → Node | `event {runId, executorId, kind, model?}` | Selected, sanitized framework progress. |
| Python → Node | `tool_request {runId, requestId, operation, payload}` | Request the single allowlisted Node preparation operation. |
| Node → Python | `tool_response {runId, requestId, payload}` | Validated plan plus prepared selected jobs, or a typed error. |
| Python → Node | `result {runId, plan, services}` | Terminal workflow output; Node verifies before persistence. |
| Python → Node | `error {runId, code, message}` | Safe failure; no raw credentials, HTTP bodies or stack trace. |

Read one JSON object per line. Use `python -u`/flushed stdout; diagnostics go to stderr, never protocol stdout. Node uses `spawn` with argument arrays and pipes, not a shell command. Bound line length and stderr capture, handle backpressure, reject unknown operations, and enforce one expected response/result per run. Use one input-reader task; do not let parallel specialists race to read stdin.

A practical workflow pump is:

```python
run_args = {"message": initial_context}
while True:
    stream = flow.run(**run_args, stream=True)
    pending = []
    async for event in stream:
        if event.type == "request_info":
            pending.append(event)
            write_jsonl(tool_request_from(event))
        else:
            write_jsonl(safe_progress_or_output(event))
    final = await stream.get_final_response()
    if not pending:
        break
    # Drain the paused run before resuming the same built workflow.
    replies = await read_validated_tool_replies(pending)
    run_args = {"responses": replies}
```

The host should own the full-analysis wall-clock cap as well as per-agent deadlines. On request abort, timeout or child exit, close pipes and terminate the owned child, releasing the case lock in `finally`. The child should handle cancellation and close its SDK clients. No daemon or second HTTP port is needed. Unexpected process loss keeps the existing interrupted-analysis/error behavior; it is not transparent checkpoint recovery.

Do not forward framework `event.data`, `event.details`, `AgentResponse` or raw stdout wholesale to the browser. Executor-invoked events may carry complete inputs, and failure details may contain stack traces. Map allowlisted progress fields into the existing `AgentRun`/`AgentEvent` contract; only actual model invocations get an actual model-run record.

## Ownership and human gates

| Concern | Authority after migration |
|---|---|
| Planner and specialist inference | Python `Agent` + Cloudflare client. |
| Graph, fan-out, join, external preparation pause | Python `WorkflowBuilder`. |
| Catalogue IDs, schemas, citations and fact merge | Existing Node domain functions and shared machine-readable contracts. |
| Family/SFO calculation, housing/moving preparation | Existing Node `prepareService`/rule engine. |
| Sources, confirmed memory, 20 messages, absolute 24h TTL | Existing Node SQLite case store. |
| Identity/revision lock, stale consent rejection | Existing Node API/store contract. |
| Fact confirmation and final local receipt | Existing explicit human actions between analysis runs. |
| EN/NO interface, rich questions, Markdown/canvas | Frontend contract work; no framework migration assumption translates the UI. |

The Node preparation callback must run **after** a schema-valid planner result and before specialist fan-out: validate exact source quotes and proposed values, merge candidate facts, apply language and catalogue rules, compute deterministic checks, then return bounded per-service jobs. Node must never accept an arbitrary Python-specified tool name, document path, URL or command. The fixed preparation operation is enough.

Do not maintain a second citizen memory in `AgentSession` or framework checkpoint files. Each analysis consumes a snapshot of the authoritative case and then exits. Framework request-info is used here for a trusted host callback; it does not itself prove a citizen reviewed current facts. The existing current-case/current-revision human receipt remains the authority.

## Functional API and checkpoint caveat

The functional API can express dynamic selected-only calls cleanly:

```python
@step
async def plan_step(context: dict) -> dict:
    return await run_and_validate_planner(context)

@workflow
async def analysis(context: dict, ctx: RunContext) -> dict:
    plan = await plan_step(context)
    prepared = await ctx.request_info(plan, dict, request_id="prepare")
    results = await asyncio.gather(*(specialist_step(job) for job in prepared["jobs"]))
    return {"plan": plan, "services": results}

flow = analysis.build()
```

This is a viable alternative, but Microsoft explicitly labels it experimental and subject to change/removal. It was not selected for this refactor. On request-info resume it replays from the beginning; completed `@step` calls are cached by step name/call index. Without those steps, costly model calls can repeat. `.build()` creates per-caller state. [Functional workflow contract](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/functional).

Checkpointing must be explicitly configured and its retention reconciled with case deletion/TTL. In-memory workflow pause state disappears with the child. Durable checkpoints would contain sensitive case context and require a real restore protocol. Do not claim durable workflow recovery or built-in human approval merely because the framework offers these capabilities.

## Stdio versus FastAPI

| Choice | Benefits here | Costs here | Decision |
|---|---|---|---|
| Child per analysis, JSONL | One app entry point, no extra port, simple process ownership, case-isolated workflow state. | Python startup per analysis, bidirectional pipe handling, cancellation discipline. | **Selected.** No performance benchmark yet. |
| Persistent FastAPI service | Reuses imports and client pools, independent service deployment possible. | Extra server lifecycle/port, internal request authentication, another availability boundary, routing/correlation. | Unnecessary for the accepted local architecture. |

## Next steps and open checks

1. Pin the verified core/provider releases and lock Python dependencies in the project environment.
2. Implement the real graph and typed preparation RPC; preserve existing Node schemas/rules and human guards.
3. Add narrow tests for unselected skips, one specialist failure, malformed RPC, stale case/revision, process cancellation and retry deadline behavior.
4. Verify the actual framework-client Cloudflare wire request and a full Qwen → Node preparation → parallel Gemma analysis. Retain earlier model evaluations as historical evidence, not proof of this new execution path.
5. Reconcile architecture diagrams and setup docs after production behavior lands. Frontend rich-question and language/canvas contracts remain with its owner.

Unresolved: live Cloudflare behavior through the new Python provider; measured child startup cost; final frontend rich-question schema. These are implementation checks, not blockers to the chosen architecture.

Status: DONE
Summary: Current release APIs verified, stable graph/stdio design specified, actual framework pause/resume/fan-out/join smoke test passed. No production refactor or live provider result is claimed by this report.
