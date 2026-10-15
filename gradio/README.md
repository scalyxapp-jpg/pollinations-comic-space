# Server-side variant (optional)

The Space itself is a **static** page: the browser calls Pollinations directly, and that
is what makes it free to duplicate. This folder is the same comic generator as a Gradio
app, for anyone who wants a Python backend instead — a longer script, server-side caching,
or an endpoint other tools can call.

Gradio Spaces need a Hugging Face **PRO** subscription on `cpu-basic`, which is why the
Space itself is static.

```bash
pip install -r requirements.txt
python app.py
```

`pytest test_comic.py -q` runs the parser and geometry tests without an API key.
