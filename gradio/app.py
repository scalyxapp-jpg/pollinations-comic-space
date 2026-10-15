"""A Pollinations Space people duplicate: one idea in, a comic page out.

Visitors sign in with their own Pollinations account, so the Space never needs a
key of its own and nobody's key runs dry.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import gradio as gr

import pollinations_auth as auth
from comic import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_TEXT_MODEL,
    Pollinations,
    PollinationsError,
    build_comic,
    captions,
)

PANEL_CHOICES = [2, 4, 6]

INTRO = """
**One idea in, a comic page out.** The text model writes the panel script, an image
model draws every panel, and the page is assembled with its captions.

Sign in with your Pollinations account and the requests are billed to **your** Pollen,
so this Space stays alive no matter how many people use it.
"""


def sign_in() -> tuple:
    """Walk the visitor through the device flow, showing the code as we wait."""
    try:
        code = auth.request_device_code()
    except auth.DeviceAuthError as error:
        raise gr.Error(str(error)) from error

    shown = (
        f"**1.** Open <{code.verification_url}> &nbsp; **2.** enter code "
        f"**`{code.user_code}`** &nbsp; **3.** approve"
    )
    yield shown, gr.update(visible=True), gr.update(value="Waiting for approval…"), None

    try:
        key = auth.poll_for_key(code)
    except auth.DeviceAuthError as error:
        yield (
            f"Sign-in failed: {error}",
            gr.update(visible=False),
            gr.update(value=""),
            None,
        )
        return

    yield (
        "Signed in. Your requests are billed to your own Pollen.",
        gr.update(visible=False),
        gr.update(value="Signed in ✓"),
        key,
    )


def make_comic(
    idea: str, panels: int, key: str, text_model: str, image_model: str
) -> tuple:
    if not idea.strip():
        raise gr.Error("Write what the comic should be about first.")
    if not (key or "").strip():
        raise gr.Error(
            "Sign in with Pollinations, or paste your API key from enter.pollinations.ai/keys."
        )

    progress: list[str] = []

    def note(index: int, total: int, panel) -> None:
        progress.append(f"panel {index}/{total}: {panel.caption[:70]}")

    try:
        script, _images, page = build_comic(
            idea=idea,
            api_key=key,
            panels=int(panels),
            text_model=text_model or DEFAULT_TEXT_MODEL,
            image_model=image_model or DEFAULT_IMAGE_MODEL,
            on_panel=note,
        )
    except PollinationsError as error:
        raise gr.Error(str(error)) from error

    folder = Path(tempfile.mkdtemp(prefix="comic-"))
    page_path = folder / "comic.png"
    script_path = folder / "script.txt"
    page.save(page_path)
    script_path.write_text(f"{idea}\n\n{captions(script)}\n", encoding="utf-8")

    log = "\n".join(progress)
    return page, captions(script), [str(page_path), str(script_path)], log


def build_ui() -> gr.Blocks:
    configured_app = auth.app_key() is not None
    with gr.Blocks(title="Pollinations Comic Page") as demo:
        gr.Markdown("# Pollinations Comic Page")
        gr.Markdown(INTRO)

        key_state = gr.State("")

        with gr.Row():
            with gr.Column(scale=3):
                idea = gr.Textbox(
                    label="Your idea",
                    placeholder="a lighthouse keeper who befriends a storm cloud",
                    lines=2,
                )
                panels = gr.Radio(PANEL_CHOICES, value=4, label="Panels")
                generate = gr.Button("Make the comic", variant="primary")
            with gr.Column(scale=2):
                with gr.Group():
                    gr.Markdown("### Sign in")
                    gr.Markdown(
                        "Use your own Pollen. "
                        + (
                            "This Space is registered as an app, so it earns its share."
                            if configured_app
                            else "Your key stays in this session and is never stored."
                        )
                    )
                    sign_in_button = gr.Button("Sign in with Pollinations")
                    device_box = gr.Markdown(visible=False)
                    sign_in_status = gr.Markdown()
                    key = gr.Textbox(
                        label="…or paste your API key",
                        type="password",
                        placeholder="sk_…",
                        info="From enter.pollinations.ai/keys",
                    )

        with gr.Accordion("Models", open=False):
            text_model = gr.Textbox(value=DEFAULT_TEXT_MODEL, label="Text model")
            image_model = gr.Textbox(value=DEFAULT_IMAGE_MODEL, label="Image model")

        with gr.Row():
            comic = gr.Image(label="Comic page", type="pil", height=640)
            with gr.Column():
                script_out = gr.Textbox(label="Script", lines=10)
                log_out = gr.Textbox(label="Progress", lines=6)
                files = gr.Files(label="Download")

        sign_in_button.click(
            sign_in,
            inputs=None,
            outputs=[device_box, device_box, sign_in_status, key_state],
        )
        # The pasted key is the fallback path, so keep the two in sync.
        key.change(lambda value: value, inputs=key, outputs=key_state)
        generate.click(
            make_comic,
            inputs=[idea, panels, key_state, text_model, image_model],
            outputs=[comic, script_out, files, log_out],
        )

        gr.Markdown(
            "Built with [Pollinations](https://pollinations.ai). "
            "Duplicate this Space and it runs on your account with your visitors' own Pollen."
        )
    return demo


if __name__ == "__main__":
    build_ui().launch(theme=gr.themes.Soft())
