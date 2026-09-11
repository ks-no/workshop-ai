import asyncio
import base64
import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

import langfuse_tracing
from langfuse_tracing import Recorder, redact, token_usage

PRIVATE_DETAIL = "Kari Nordmann flyttet fra Bergen 12.03"
DEV_KEYS = {"LANGFUSE_PUBLIC_KEY": "pk-test", "LANGFUSE_SECRET_KEY": "sk-test",
            "LANGFUSE_URL": "http://localhost:3100"}


@contextmanager
def captured_posts(enabled=True, fail=False):
    """Build a recorder with tracing on or off and collect what it would send."""
    posts = []

    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False

    def urlopen(request, timeout=None):
        if fail:
            raise OSError("connection refused")
        posts.append(request)
        return Response()

    env = {**DEV_KEYS, "LANGFUSE_ENABLED": "true" if enabled else "false"}
    with patch.dict(os.environ, env, clear=False):
        with patch.object(langfuse_tracing.urllib.request, "urlopen", urlopen):
            yield Recorder(), posts


def body_of(request):
    return json.loads(request.data.decode("utf-8"))


async def one_run(recorder, *, boom=False):
    async with recorder.step("Koordinator", role="coordinator", model="@cf/qwen/qwen3.8-27b") as span:
        span["input"] = redact({"detail": PRIVATE_DETAIL})
        span["output"] = redact(PRIVATE_DETAIL)
        span.update(attempts=2, finish_reason="stop", usage={"input": 10, "output": 5, "total": 15, "unit": "TOKENS"})
        if boom:
            raise ValueError(PRIVATE_DETAIL)
    await recorder.flush(name="assistent · workflow", detail={"outcome": "completed"})


class TracingDisabled(unittest.TestCase):
    def test_no_outgoing_call_when_disabled(self):
        with captured_posts(enabled=False) as (recorder, posts):
            asyncio.run(one_run(recorder))
        self.assertEqual(posts, [])

    def test_enabling_without_keys_stays_off(self):
        with patch.dict(os.environ, {"LANGFUSE_ENABLED": "true", "LANGFUSE_PUBLIC_KEY": "",
                                     "LANGFUSE_SECRET_KEY": ""}, clear=False):
            self.assertFalse(Recorder().enabled)


class TracingEnabled(unittest.TestCase):
    def test_one_batch_with_trace_and_generation(self):
        with captured_posts() as (recorder, posts):
            asyncio.run(one_run(recorder))
        self.assertEqual(len(posts), 1)
        batch = body_of(posts[0])["batch"]
        types = [event["type"] for event in batch]
        self.assertEqual(types, ["generation-create", "trace-create"])
        generation = batch[0]["body"]
        self.assertEqual(generation["traceId"], recorder.trace_id)
        self.assertEqual(generation["model"], "@cf/qwen/qwen3.8-27b")
        self.assertEqual(generation["usage"]["total"], 15)
        self.assertEqual(generation["metadata"]["attempts"], 2)
        self.assertEqual(generation["metadata"]["role"], "coordinator")
        self.assertIn("startTime", generation)
        self.assertIn("endTime", generation)

    def test_basic_auth_is_base64_of_public_colon_secret(self):
        with captured_posts() as (recorder, posts):
            asyncio.run(one_run(recorder))
        expected = "Basic " + base64.b64encode(b"pk-test:sk-test").decode("ascii")
        self.assertEqual(posts[0].get_header("Authorization"), expected)

    def test_step_without_model_becomes_a_span(self):
        with captured_posts() as (recorder, posts):
            async def run():
                async with recorder.step("join", role="join") as span:
                    span["branches"] = {"family": "completed"}
                await recorder.flush(name="assistent · workflow")
            asyncio.run(run())
        event = body_of(posts[0])["batch"][0]
        self.assertEqual(event["type"], "span-create")
        self.assertNotIn("model", event["body"])

    def test_failed_step_records_error_level_and_reraises(self):
        with captured_posts() as (recorder, posts):
            with self.assertRaises(ValueError):
                asyncio.run(one_run(recorder, boom=True))
            asyncio.run(recorder.flush(name="assistent · workflow"))
        generation = body_of(posts[0])["batch"][0]["body"]
        self.assertEqual(generation["level"], "ERROR")
        self.assertEqual(generation["status_message"], "ValueError")


class PrivateContentNeverLeaves(unittest.TestCase):
    def test_payload_carries_shape_not_content(self):
        with captured_posts() as (recorder, posts):
            asyncio.run(one_run(recorder))
        payload = posts[0].data.decode("utf-8")
        self.assertNotIn(PRIVATE_DETAIL, payload)
        self.assertNotIn("Nordmann", payload)
        generation = body_of(posts[0])["batch"][0]["body"]
        self.assertEqual(generation["output"], {"length": len(PRIVATE_DETAIL),
                                                "sha256": redact(PRIVATE_DETAIL)["sha256"]})

    def test_error_message_is_not_forwarded(self):
        with captured_posts() as (recorder, posts):
            with self.assertRaises(ValueError):
                asyncio.run(one_run(recorder, boom=True))
            asyncio.run(recorder.flush(name="assistent · workflow"))
        self.assertNotIn(PRIVATE_DETAIL, posts[0].data.decode("utf-8"))

    def test_credentials_are_not_in_the_body(self):
        with captured_posts() as (recorder, posts):
            asyncio.run(one_run(recorder))
        payload = posts[0].data.decode("utf-8")
        self.assertNotIn("sk-test", payload)


class NeverBlocksTheRun(unittest.TestCase):
    def test_unreachable_langfuse_does_not_raise(self):
        with captured_posts(fail=True) as (recorder, _posts):
            asyncio.run(one_run(recorder))  # No exception is the assertion.

    def test_step_returns_the_body_value_when_disabled(self):
        with captured_posts(enabled=False) as (recorder, _posts):
            async def run():
                async with recorder.step("Koordinator", role="coordinator", model="m") as span:
                    span["attempts"] = 1
                    return "output"
            self.assertEqual(asyncio.run(run()), "output")


class TokenUsage(unittest.TestCase):
    def test_reads_openai_style_attributes(self):
        class Usage:
            input_tokens, output_tokens, total_tokens = 12, 7, 19
        class Response:
            usage = Usage()
        self.assertEqual(token_usage(Response()), {"input": 12, "output": 7, "total": 19, "unit": "TOKENS"})

    def test_totals_when_only_parts_are_present(self):
        class Response:
            usage = {"prompt_tokens": 4, "completion_tokens": 6}
        self.assertEqual(token_usage(Response())["total"], 10)

    def test_absent_usage_reports_nothing(self):
        self.assertIsNone(token_usage(object()))


if __name__ == "__main__":
    unittest.main()
