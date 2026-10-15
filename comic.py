"""Turn one idea into a comic page with Pollinations.

The pipeline is deliberately separate from the Gradio UI in ``app.py`` so it can
be tested without a browser.
"""

from __future__ import annotations

import io
import json
import re
import textwrap
from dataclasses import dataclass
from typing import Iterable, Sequence
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw, ImageFont

DEFAULT_BASE_URL = "https://gen.pollinations.ai"
DEFAULT_TEXT_MODEL = "openai/gpt-6-sol"
DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"

# The image endpoint refuses anything under 256 px per side.
PANEL_SIZE = 512
REQUEST_TIMEOUT = 120

SCRIPT_SYSTEM_PROMPT = (
    "You write comic pages. Answer with JSON only, no prose and no code fences: "
    '{"panels":[{"caption":"...","image":"..."}]}. '
    "One entry per panel, in reading order. The caption is one short sentence of "
    "narration or dialogue. The image field is a self-contained visual description "
    "of that panel, mentioning the same characters and setting every time so the "
    "panels look like one story."
)


class PollinationsError(RuntimeError):
    """A failure worth showing to the visitor, not a stack trace."""


@dataclass(frozen=True)
class Panel:
    """One comic panel: what to write under it, and what to draw."""

    caption: str
    image_prompt: str


class Pollinations:
    """The two Pollinations calls this Space needs."""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")

    def _auth(self) -> dict[str, str]:
        if not self.api_key:
            raise PollinationsError(
                "Add your Pollinations API key first. Get one free at "
                "https://enter.pollinations.ai/keys"
            )
        return {"Authorization": f"Bearer {self.api_key}"}

    def describe_error(self, response: requests.Response) -> str:
        """The API reports limits and bad input as JSON; pass that on."""
        try:
            payload = response.json()
        except ValueError:
            return f"Pollinations answered HTTP {response.status_code}"
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
        return f"Pollinations answered HTTP {response.status_code}"

    def write_script(
        self, idea: str, panels: int, model: str = DEFAULT_TEXT_MODEL
    ) -> list[Panel]:
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": SCRIPT_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Write a {panels}-panel comic about: {idea}",
                },
            ],
        }
        response = requests.post(
            f"{self.base_url}/v1/chat/completions",
            headers={**self._auth(), "content-type": "application/json"},
            json=body,
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code // 100 != 2:
            raise PollinationsError(self.describe_error(response))
        return parse_panels(read_answer(response.json()), panels, idea)

    def render(
        self, panel: Panel, model: str = DEFAULT_IMAGE_MODEL, size: int = PANEL_SIZE
    ) -> Image.Image:
        url = (
            f"{self.base_url}/image/{quote(panel.image_prompt)}"
            f"?model={quote(model)}&width={size}&height={size}&nologo=true"
        )
        response = requests.get(url, headers=self._auth(), timeout=REQUEST_TIMEOUT)
        if response.status_code // 100 != 2:
            raise PollinationsError(self.describe_error(response))
        image = Image.open(io.BytesIO(response.content))
        return image.convert("RGB")


def read_answer(payload: dict) -> str:
    """Pull the assistant text out of a chat completion."""
    choices = payload.get("choices") or []
    if not choices:
        raise PollinationsError("The text model returned no answer")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content or not content.strip():
        raise PollinationsError("The text model returned an empty answer")
    return content.strip()


def parse_panels(answer: str, expected: int, idea: str) -> list[Panel]:
    """Read the model's JSON, and still produce panels when it rambles.

    Models occasionally wrap JSON in prose or code fences, so this tries strict
    JSON first and then falls back to line-by-line captions. A comic page is more
    useful than an error.
    """
    data = _load_json(answer)
    raw_panels = data.get("panels") if isinstance(data, dict) else None
    panels: list[Panel] = []
    if isinstance(raw_panels, list):
        for entry in raw_panels:
            if not isinstance(entry, dict):
                continue
            caption = str(entry.get("caption") or "").strip()
            image_prompt = str(entry.get("image") or "").strip() or caption
            if caption or image_prompt:
                panels.append(
                    Panel(
                        caption=caption or image_prompt,
                        image_prompt=image_prompt or caption,
                    )
                )
    if not panels:
        lines = [line.strip(" -*\t") for line in answer.splitlines() if line.strip()]
        for line in lines[:expected] or [idea]:
            panels.append(
                Panel(caption=line, image_prompt=f"{line}, comic panel of {idea}")
            )
    return panels[:expected]


def _load_json(answer: str) -> object:
    text = answer.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except ValueError:
            return {}
    return {}


def panel_grid(
    panels: Sequence[Panel], images: Sequence[Image.Image], columns: int = 2
) -> Image.Image:
    """Lay the panels out with their captions underneath."""
    if len(panels) != len(images):
        raise ValueError("every panel needs one image")
    columns = max(1, min(columns, len(panels)))
    rows = (len(panels) + columns - 1) // columns

    size = max(image.width for image in images)
    caption_height = 96
    pad = 16
    width = columns * size + (columns + 1) * pad
    height = rows * (size + caption_height) + (rows + 1) * pad

    page = Image.new("RGB", (width, height), (18, 18, 18))
    draw = ImageDraw.Draw(page)
    font = _caption_font()

    for index, (panel, image) in enumerate(zip(panels, images)):
        column, row = index % columns, index // columns
        x = pad + column * (size + pad)
        y = pad + row * (size + caption_height + pad)
        page.paste(image.resize((size, size)), (x, y))
        draw.rectangle([x, y, x + size, y + size], outline=(70, 70, 70))
        draw.multiline_text(
            (x, y + size + 8),
            textwrap.fill(panel.caption, width=max(20, size // 11)),
            fill=(235, 235, 235),
            font=font,
            spacing=4,
        )
    return page


def _caption_font() -> ImageFont.ImageFont:
    """A readable font when the system has one, PIL's default otherwise."""
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, 22)
        except OSError:
            continue
    return ImageFont.load_default()


def build_comic(
    idea: str,
    api_key: str,
    panels: int = 4,
    text_model: str = DEFAULT_TEXT_MODEL,
    image_model: str = DEFAULT_IMAGE_MODEL,
    base_url: str = DEFAULT_BASE_URL,
    on_panel: "callable | None" = None,
) -> tuple[list[Panel], list[Image.Image], Image.Image]:
    """The whole pipeline, used by the Space and by the tests."""
    client = Pollinations(api_key, base_url)
    script = client.write_script(idea, panels, model=text_model)
    images: list[Image.Image] = []
    for index, panel in enumerate(script, start=1):
        images.append(client.render(panel, model=image_model))
        if on_panel is not None:
            on_panel(index, len(script), panel)
    return script, images, panel_grid(script, images)


def captions(panels: Iterable[Panel]) -> str:
    """Panel captions as a downloadable script."""
    return "\n\n".join(f"{i}. {p.caption}" for i, p in enumerate(panels, start=1))
