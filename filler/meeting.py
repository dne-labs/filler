"""Structural validation only: does not verify semantic truth or run inference."""
import math

KINDS = {"action", "decision", "disagreement", "consensus", "unresolved"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(record):
    require(isinstance(record, dict), "record must be an object")
    require(nonempty(record.get("title")), "title is required")
    speakers = record.get("speakers")
    require(isinstance(speakers, dict), "speakers must be an object")
    require(all(nonempty(k) and nonempty(v) for k, v in speakers.items()), "invalid speaker mapping")
    segments = record.get("segments")
    require(isinstance(segments, list), "segments must be a list")
    ids = set()
    for segment in segments:
        require(isinstance(segment, dict), "segment must be an object")
        sid = segment.get("id")
        require(nonempty(sid) and sid not in ids, "segment IDs must be unique nonempty strings")
        ids.add(sid)
        start, end = segment.get("start"), segment.get("end")
        require(all(type(t) in (int, float) and math.isfinite(t) for t in (start, end)), "timestamps must be finite numbers")
        require(0 <= start < end, "invalid timestamp interval")
        speaker = segment.get("speaker")
        require(speaker is None or (isinstance(speaker, str) and speaker in speakers), "unknown speaker ID")
        require(nonempty(segment.get("text")), "segment text required")
    insights = record.get("insights")
    require(isinstance(insights, list), "insights must be a list")
    insight_ids = set()
    for insight in insights:
        require(isinstance(insight, dict), "insight must be an object")
        iid = insight.get("id")
        require(nonempty(iid) and iid not in insight_ids, "insight IDs must be unique")
        insight_ids.add(iid)
        require(isinstance(insight.get("kind"), str) and insight["kind"] in KINDS, "invalid insight kind")
        require(nonempty(insight.get("text")), "insight text required")
        refs = insight.get("evidence")
        require(isinstance(refs, list) and bool(refs), "evidence required")
        require(all(isinstance(ref, str) and ref in ids for ref in refs), "invalid evidence reference")
        owner = insight.get("owner")
        require(owner is None or (isinstance(owner, str) and owner in speakers), "unknown owner ID")
        require(insight.get("status") in ("suggested", "confirmed"), "invalid review status")
    return record


def render(record):
    validate(record)
    lines = [f"# {record['title']}", "", "## Transcript", ""]
    for segment in sorted(record["segments"], key=lambda s: (s["start"], s["end"])):
        name = record["speakers"].get(segment["speaker"], "Unknown speaker")
        lines.extend([f"### {segment['id']}", "", f"{segment['start']:.2f}–{segment['end']:.2f}s | {name}", "", segment["text"], ""])
    lines.extend(["## Insights", ""])
    for insight in record["insights"]:
        owner = record["speakers"].get(insight.get("owner"), "Unassigned")
        evidence = ", ".join(insight["evidence"])
        lines.extend([f"- **{insight['kind']} / {insight['status']}**: {insight['text']}", f"  Owner: {owner}. Evidence segment IDs: {evidence}."])
    return "\n".join(lines)
