from skills.research.pipeline import Plan, Source, _clean, _date, evidence, rank_passages


def test_ranking_prefers_relevant_passages_and_caps_per_source() -> None:
    relevant = "K3s is a lightweight Kubernetes distribution for home lab clusters. " * 3
    noise = "Cookie settings and newsletter signup for our marketing updates today. " * 3
    a = Source(
        url="https://a.dev", title="A", snippet="", text=f"{relevant}\n\n{noise}\n\n{relevant}"
    )
    b = Source(url="https://b.dev", title="B", snippet="", text=noise)
    rank_passages([a, b], ["k3s home lab kubernetes"], keep=5, per_source=1)
    assert len(a.passages) == 1 and "K3s" in a.passages[0][1]
    assert b.passages == []


def test_clean_and_dates() -> None:
    assert (
        _clean("See ![x](/i.png)[the docs](https://d.dev) at https://e.dev now")
        == "See the docs at  now"
    )
    assert _date("Tue, 27 Oct 2026 10:00:00 GMT") == "2026-10-27"
    assert _date("2026-11-04T00:00:00") == "2026-11-04"


def test_evidence_numbers_sources() -> None:
    s = Source(url="https://a.dev", title="A", snippet="snippet", passages=[(1.0, "passage")])
    out = evidence("q", Plan(queries=["q"], news=False), [s])
    assert "[1] A <https://a.dev>" in out and "[1] passage" in out and "[1](https://a.dev)" in out
