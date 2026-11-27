import copy
import json
import unittest
from pathlib import Path
from filler.meeting import validate, render


class MeetingTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((Path(__file__).parents[1] / "examples/meeting.json").read_text())

    def test_overlap_and_unknown_speaker_preserved(self):
        validate(self.record)
        report = render(self.record)
        self.assertIn("Unknown speaker", report)
        self.assertIn("3.00–6.00s", report)
        self.assertIn("Owner: Sam (fictional)", report)

    def test_bad_references_and_values_rejected(self):
        mutations = [
            lambda r: r["segments"][0].update(end=-1),
            lambda r: r["segments"][0].update(start=float("nan")),
            lambda r: r["segments"][0].update(start=True),
            lambda r: r["segments"][0].update(speaker="missing"),
            lambda r: r["segments"][0].update(speaker=[]),
            lambda r: r["segments"][1].update(id="s1"),
            lambda r: r["insights"][0].update(evidence=["missing"]),
            lambda r: r["insights"][0].update(evidence=[]),
            lambda r: r["insights"][0].update(owner="missing"),
            lambda r: r["insights"][0].update(kind=[]),
            lambda r: r["insights"][1].update(id="i1"),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                record = copy.deepcopy(self.record)
                mutation(record)
                with self.assertRaises(ValueError):
                    validate(record)

    def test_empty_meeting(self):
        validate({"title": "Empty", "speakers": {}, "segments": [], "insights": []})

    def test_owner_not_inferred_from_speaker(self):
        self.record["insights"][1]["owner"] = None
        self.assertIn("Owner: Unassigned. Evidence segment IDs: s3", render(self.record))


if __name__ == "__main__":
    unittest.main()
