import io
import json
import unittest
import urllib.error

import server


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_returning(payload):
    def op(req, timeout=0):
        assert req.get_header("X-goog-api-key") == "k"
        return FakeResp(json.dumps(payload).encode())
    return op


def opener_error(code):
    def op(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, code, "x", {}, None)
    return op


GOOD = {"topic": "How rain forms", "language": "en", "minutes": 2, "sections": 3, "tone": "calm"}


class ServerTests(unittest.TestCase):
    def test_validation(self):
        for bad in [{}, {**GOOD, "topic": " "}, {**GOOD, "language": "fr"}, {**GOOD, "minutes": 99},
                    {**GOOD, "sections": 0}, {**GOOD, "tone": "x"}, {**GOOD, "minutes": "abc"}]:
            with self.assertRaises(server.RequestError):
                server.validate_request(bad)
        self.assertEqual(server.validate_request(GOOD)["sections"], 3)

    def test_prompt_contains_format(self):
        p = server.build_prompt(server.validate_request({**GOOD, "language": "ne"}))
        self.assertIn("## Outro line", p)
        self.assertIn("Devanagari", p)
        self.assertIn("290", p)

    def test_sanitize(self):
        raw = "```markdown\n# Title\n## Beat 1\n- **Hello** there.\n\n1. Next.\n---\n```"
        out = server.sanitize_script(raw)
        self.assertEqual(out, "## Title\n## Beat 1\nHello there.\n\nNext.")

    def test_generate_ok(self):
        resp = {"candidates": [{"content": {"parts": [{"text": "## Beat 1\nHi there."}]}}]}
        out = server.generate_script(GOOD, "k", "m", opener_returning(resp))
        self.assertEqual(out, "## Beat 1\nHi there.")

    def test_no_key(self):
        for bad_key in ("", "   ", "your_gemini_api_key_here"):
            with self.assertRaises(server.RequestError) as c:
                server.generate_script(GOOD, bad_key, "m")
            self.assertEqual(c.exception.status, 503)

    def test_errors(self):
        self.assertEqual(self._status(opener_error(429)), 429)
        self.assertEqual(self._status(opener_error(403)), 502)
        self.assertEqual(self._status(opener_returning({"promptFeedback": {"blockReason": "SAFETY"}})), 422)
        self.assertEqual(self._status(opener_returning({"candidates": []})), 502)

    def test_retry_on_503_then_success(self):
        calls = []
        ok = {"candidates": [{"content": {"parts": [{"text": "## B\nHi."}]}}]}

        def op(req, timeout=0):
            calls.append(req.full_url)
            if len(calls) < 3:
                raise urllib.error.HTTPError(req.full_url, 503, "x", {}, None)
            return FakeResp(json.dumps(ok).encode())

        out = server.generate_script(GOOD, "k", "", op, sleep=lambda s: None)
        self.assertEqual(out, "## B\nHi.")
        self.assertEqual(len(calls), 3)

    def test_503_always_fails_with_friendly_message(self):
        with self.assertRaises(server.RequestError) as c:
            server.generate_script(GOOD, "k", "", opener_error(503), sleep=lambda s: None)
        self.assertIn("busy", str(c.exception))

    def _status(self, op):
        with self.assertRaises(server.RequestError) as c:
            server.generate_script(GOOD, "k", "m", op)
        return c.exception.status


if __name__ == "__main__":
    unittest.main()
