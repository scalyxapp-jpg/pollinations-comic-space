"""The script parser is the fragile part: models wrap JSON in prose, so it has to
produce panels anyway. These tests need no API key."""

from __future__ import annotations

from PIL import Image

from comic import Panel, captions, panel_grid, parse_panels


def test_reads_strict_json():
    answer = '{"panels":[{"caption":"A","image":"a lighthouse"},{"caption":"B","image":"a cloud"}]}'

    panels = parse_panels(answer, expected=2, idea="x")

    assert [p.caption for p in panels] == ["A", "B"]
    assert panels[0].image_prompt == "a lighthouse"


def test_reads_json_inside_a_code_fence():
    answer = 'Here you go:\n```json\n{"panels":[{"caption":"A","image":"a"}]}\n```'

    panels = parse_panels(answer, expected=1, idea="x")

    assert panels[0].caption == "A"


def test_reads_json_surrounded_by_prose():
    answer = 'Sure! {"panels":[{"caption":"A","image":"a"}]} Hope that helps.'

    panels = parse_panels(answer, expected=1, idea="x")

    assert panels[0].caption == "A"


def test_falls_back_to_lines_when_there_is_no_json():
    answer = "- A lighthouse keeper waves\n- A cloud answers\nnoise"

    panels = parse_panels(answer, expected=2, idea="a storm")

    assert len(panels) == 2
    assert panels[0].caption == "A lighthouse keeper waves"
    # The fallback still draws something related to the idea.
    assert "a storm" in panels[0].image_prompt


def test_never_returns_more_panels_than_asked_for():
    answer = '{"panels":[{"caption":"a","image":"a"},{"caption":"b","image":"b"},{"caption":"c","image":"c"}]}'

    assert len(parse_panels(answer, expected=2, idea="x")) == 2


def test_falls_back_to_the_idea_when_the_answer_is_empty():
    panels = parse_panels("", expected=4, idea="a lonely robot")

    assert len(panels) == 1
    assert "a lonely robot" in panels[0].image_prompt


def test_uses_the_caption_when_the_image_field_is_missing():
    answer = '{"panels":[{"caption":"A lighthouse keeper waves"}]}'

    panel = parse_panels(answer, expected=1, idea="x")[0]

    assert panel.image_prompt == panel.caption


def test_grid_leaves_room_for_every_caption():
    panels = [Panel(caption=f"panel {i}", image_prompt="x") for i in range(4)]
    images = [Image.new("RGB", (512, 512), "red") for _ in panels]

    page = panel_grid(panels, images, columns=2)

    # Two columns, two rows, plus padding and caption bands.
    assert page.width > 2 * 512
    assert page.height > 2 * 512


def test_grid_rejects_a_mismatch():
    panels = [Panel(caption="a", image_prompt="a")]

    try:
        panel_grid(panels, [], columns=1)
    except ValueError:
        return
    raise AssertionError("a missing image should not be silently ignored")


def test_captions_are_numbered():
    text = captions(
        [Panel(caption="A", image_prompt="a"), Panel(caption="B", image_prompt="b")]
    )

    assert text.splitlines()[0] == "1. A"
    assert text.splitlines()[-1] == "2. B"
