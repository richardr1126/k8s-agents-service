from __future__ import annotations

import math
import re

import numexpr
from pydantic import BaseModel, Field


class OutputModel(BaseModel):
    expression: str = Field(..., json_schema_extra={"summary_role": "echoed_input"})
    result: str = Field(..., json_schema_extra={"summary_role": "field"})


def run(expression: str) -> OutputModel:
    local_dict = {"pi": math.pi, "e": math.e}
    raw = str(
        numexpr.evaluate(
            expression.strip(),
            global_dict={},
            local_dict=local_dict,
        )
    )
    cleaned = re.sub(r"^\[|\]$", "", raw)
    return OutputModel(expression=expression, result=cleaned)
