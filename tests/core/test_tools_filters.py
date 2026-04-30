from agents.tools import build_keyword_filter


def test_projects_filter_mixed_conditions_uses_top_level_and() -> None:
    filter_dict = build_keyword_filter(
        "Show me python and react project documentation",
        collection_type="projects",
    )

    assert "$and" in filter_dict
    and_conditions = filter_dict["$and"]
    assert isinstance(and_conditions, list)
    assert any("$or" in condition for condition in and_conditions)
    assert any(
        condition.get("content_type") == {"$eq": "readme"}
        for condition in and_conditions
        if isinstance(condition, dict)
    )


def test_projects_filter_single_content_type_condition_is_field_only() -> None:
    filter_dict = build_keyword_filter("Need project summary", collection_type="projects")
    assert filter_dict == {"content_type": {"$eq": "description"}}


def test_resume_filter_mixed_conditions_uses_top_level_and() -> None:
    filter_dict = build_keyword_filter(
        "Show web skills",
        collection_type="resume",
    )

    assert "$and" in filter_dict
    and_conditions = filter_dict["$and"]
    assert {"section": {"$eq": "Skills"}} in and_conditions
    assert {"source": {"$like": "%richardr.dev%"}} in and_conditions


def test_filter_with_no_matches_returns_empty_dict() -> None:
    filter_dict = build_keyword_filter("hello world", collection_type="projects")
    assert filter_dict == {}
