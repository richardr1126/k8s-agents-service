from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from jobs import graphs
from skills.papers import podcast, topic
from skills.papers.sources import Paper
from skills.research import graph as research_graph
from skills.research.pipeline import Plan, Source

pytestmark = pytest.mark.asyncio


class FakeModel:
    """Answers structured calls from `answers[schema]` in turn, plain calls with `text`."""

    def __init__(self, answers: dict[type, list[Any]], text: str = "notes") -> None:
        self.answers = answers
        self.text = text

    def with_structured_output(self, schema: type) -> Any:
        model = self

        class Bound:
            async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
                return model.answers[schema].pop(0)

        return Bound()

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        class Msg:
            content = self.text

        return Msg()


@pytest.fixture(autouse=True)
def memory_saver() -> None:
    graphs.use_saver(InMemorySaver())


def paper(aid: str, year: str) -> Paper:
    return Paper(
        title=f"P{aid}", url=f"https://arxiv.org/abs/{aid}", arxiv_id=aid, published=f"{year}-01-01"
    )


async def test_topic_episode_searches_again_for_gaps_then_notes_each_paper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rounds: list[list[str]] = []

    async def plan_searches(t: str, ctx: Any) -> tuple[list[str], list[str]]:
        return ["q1"], ["Landmark"]

    async def candidates(queries: list[str], landmarks: list[str] | None = None) -> Any:
        rounds.append(queries)
        if queries == ["q1"]:
            return [paper("2.0", "2023"), paper("1.0", "2017")], {"1.0"}
        return [paper("3.0", "2025")], set()

    async def pick(t: str, found: list[Paper], n: int, ctx: Any, marked: Any = None) -> Any:
        return found[:n]

    async def read(p: Paper) -> Paper:
        p.text = "full text"
        return p

    async def web_context(t: str, ctx: Any) -> str:
        return "web passages"

    written: dict[str, str] = {}

    async def write_script(material: str, *args: Any, **kwargs: Any) -> podcast.Script:
        written["material"] = material
        return podcast.Script(title="T", summary="S", lines=[podcast.Line(host=1, text="x")] * 4)

    async def record(script: Any, about: str, papers: list[Paper], ctx: Any) -> dict[str, Any]:
        return {"text": about, "data": {"papers": [p.arxiv_id for p in papers]}}

    model = FakeModel({topic.Coverage: [topic.Coverage(covered=False, searches=["gap q"])]})
    monkeypatch.setattr(topic, "_model", lambda ctx: model)
    monkeypatch.setattr(topic, "plan_searches", plan_searches)
    monkeypatch.setattr(topic, "candidates", candidates)
    monkeypatch.setattr(topic, "pick", pick)
    monkeypatch.setattr(topic, "_read", read)
    monkeypatch.setattr(topic, "web_context", web_context)
    monkeypatch.setattr(topic.podcast, "write_script", write_script)
    monkeypatch.setattr(topic.podcast, "record", record)

    result = await topic.make("rag", 3, "short", None, True, {"configurable": {"job_id": "j1"}})
    # The coverage check sent it back once for the gap, then it went on.
    assert rounds == [["q1"], ["gap q"]]
    # All three papers, oldest first, each with its own notes, and the web passages.
    assert result["data"]["papers"] == ["1.0", "2.0", "3.0"]
    material = written["material"]
    assert material.index("P1.0") < material.index("P2.0") < material.index("P3.0")
    assert material.count("notes") == 3 and "web passages" in material


async def test_deep_research_fills_gaps_once_then_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    searched: list[list[str]] = []

    async def plan(question: str, depth: str, config: Any) -> Plan:
        return Plan(queries=["a", "b"], news=False)

    async def gather(question: str, depth: str, config: Any, the_plan: Plan) -> Any:
        searched.append(the_plan.queries)
        n = len(searched)
        return the_plan, [
            Source(url=f"https://s{n}", title=f"S{n}", snippet="", passages=[(1.0, "p")])
        ]

    async def write_report(
        question: str, the_plan: Plan, sources: list[Source], config: Any
    ) -> str:
        return f"{the_plan.queries} from {[s.url for s in sources]}"

    answers = {research_graph.Gaps: [research_graph.Gaps(answered=False, searches=["a", "c"])]}
    monkeypatch.setattr(research_graph, "_model", lambda config: FakeModel(answers))
    monkeypatch.setattr(research_graph, "plan", plan)
    monkeypatch.setattr(research_graph, "gather", gather)
    monkeypatch.setattr(research_graph, "write_report", write_report)

    report = await research_graph.deep_report("q?", {"configurable": {"job_id": "j2"}})
    # The gap search skipped the query already run, and the second round stopped the loop.
    assert searched == [["a", "b"], ["c"]]
    assert report == "['a', 'b', 'c'] from ['https://s1', 'https://s2']"
