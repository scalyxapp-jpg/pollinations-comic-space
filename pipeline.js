/**
 * The Pollinations pipeline for the comic Space.
 *
 * Everything here is plain functions so it can be tested in Node with a stub
 * fetch, and so the drawing code in app.js stays about drawing only.
 */

export const BASE_URL = "https://gen.pollinations.ai";
export const ENTER_URL = "https://enter.pollinations.ai";

export const DEFAULT_TEXT_MODEL = "openai/gpt-6-sol";
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b";

/** The image endpoint refuses anything under 256 px per side. */
export const PANEL_SIZE = 512;

/**
 * Optional: put a Pollinations app key ("pk_...") here and visitors who sign in
 * are attributed to your app, so you earn your share of what they spend. Left
 * empty, sign-in works the same way and visitors still pay with their own Pollen.
 */
export const APP_KEY = "";

export const SCRIPT_SYSTEM_PROMPT =
  "You write comic pages. Answer with JSON only, no prose and no code fences: " +
  '{"panels":[{"caption":"...","image":"..."}]}. ' +
  "One entry per panel, in reading order. The caption is one short sentence of " +
  "narration or dialogue. The image field is a self-contained visual description " +
  "of that panel, mentioning the same characters and setting every time so the " +
  "panels look like one story.";

/** A failure worth showing to the visitor, not a stack trace. */
export class PollinationsError extends Error {}

/** The API reports limits and bad input as JSON; pass that on. */
export function describeError(status, payload) {
  const error = payload && payload.error;
  if (error && typeof error === "object" && error.message)
    return String(error.message);
  if (typeof error === "string" && error) return error;
  return `Pollinations answered HTTP ${status}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Ask the text model for the panel script. */
export async function writeScript({
  idea,
  panels,
  key,
  model,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SCRIPT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Write a ${panels}-panel comic about: ${idea}`,
        },
      ],
    }),
  });
  if (!response.ok)
    throw new PollinationsError(
      describeError(response.status, await readJson(response)),
    );

  const payload = await response.json();
  const choices = payload?.choices || [];
  const content = choices[0]?.message?.content;
  if (!content || !content.trim())
    throw new PollinationsError("The text model returned no answer");
  return parsePanels(content.trim(), panels, idea);
}

/** Draw one panel and return it as an image element. */
export async function renderPanel({
  imagePrompt,
  key,
  model,
  size = PANEL_SIZE,
  fetchImpl = fetch,
}) {
  const url =
    `${BASE_URL}/image/${encodeURIComponent(imagePrompt)}` +
    `?model=${encodeURIComponent(model)}&width=${size}&height=${size}&nologo=true`;

  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!response.ok)
    throw new PollinationsError(
      describeError(response.status, await readJson(response)),
    );

  const blob = await response.blob();
  return loadImage(URL.createObjectURL(blob));
}

/** Decodes a blob URL into something drawable. */
export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new PollinationsError("The model did not return a usable image"));
    image.src = source;
  });
}

/**
 * Reads the model's JSON, and still produces panels when it rambles.
 * Models wrap JSON in prose or code fences often enough to matter.
 */
export function parsePanels(answer, expected, idea) {
  const data = loadJson(answer);
  const raw = Array.isArray(data?.panels) ? data.panels : [];
  const panels = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const caption = String(entry.caption || "").trim();
    const imagePrompt = String(entry.image || "").trim() || caption;
    if (caption || imagePrompt) {
      panels.push({
        caption: caption || imagePrompt,
        imagePrompt: imagePrompt || caption,
      });
    }
  }
  if (panels.length === 0) {
    const lines = String(answer)
      .split("\n")
      .map((line) => line.replace(/^[\s*\-•\t]+/, "").trim())
      .filter(Boolean);
    const chosen =
      lines.slice(0, expected).length > 0 ? lines.slice(0, expected) : [idea];
    for (const line of chosen) {
      panels.push({
        caption: line,
        imagePrompt: `${line}, comic panel of ${idea}`,
      });
    }
  }
  return panels.slice(0, expected);
}

function loadJson(answer) {
  let text = String(answer).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the widest braces */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Where each panel and its caption goes. Kept separate from the drawing so the
 * arithmetic can be tested without a canvas.
 */
export function panelLayout(
  count,
  { columns = 2, size = PANEL_SIZE, captionHeight = 96, pad = 16 } = {},
) {
  const safeCount = Math.max(1, count);
  const usedColumns = Math.max(1, Math.min(columns, safeCount));
  const rows = Math.ceil(safeCount / usedColumns);
  const width = usedColumns * size + (usedColumns + 1) * pad;
  const height = rows * (size + captionHeight) + (rows + 1) * pad;

  const rects = [];
  for (let index = 0; index < safeCount; index++) {
    const column = index % usedColumns;
    const row = Math.floor(index / usedColumns);
    rects.push({
      x: pad + column * (size + pad),
      y: pad + row * (size + captionHeight + pad),
      size,
      captionY: pad + row * (size + captionHeight + pad) + size + 8,
    });
  }
  return { width, height, columns: usedColumns, rows, rects };
}

/** Sign in through the device flow. No redirect URI is needed, which is what
 *  makes it usable from a static page. */
export async function signIn({
  onCode,
  appKey = APP_KEY,
  fetchImpl = fetch,
  intervalSeconds = 5,
  timeoutSeconds = 300,
  sleep = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
}) {
  const clientId = appKey ? { client_id: appKey } : {};
  const codeResponse = await fetchImpl(`${ENTER_URL}/api/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "profile usage", ...clientId }),
  });
  if (!codeResponse.ok) {
    throw new PollinationsError(
      describeError(codeResponse.status, await readJson(codeResponse)),
    );
  }
  const code = await codeResponse.json();
  onCode?.(code);

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const tokenResponse = await fetchImpl(`${ENTER_URL}/api/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: code.device_code, ...clientId }),
    });
    const payload = await readJson(tokenResponse);
    if (tokenResponse.ok && payload?.access_token) return payload.access_token;

    const error = String(payload?.error || "");
    if (error === "authorization_pending" || error === "") {
      await sleep(Number(code.interval) || intervalSeconds);
      continue;
    }
    throw new PollinationsError(
      payload?.error_description || error || "Sign-in failed",
    );
  }
  throw new PollinationsError(
    "The sign-in was not approved in time. Start it again for a new code.",
  );
}
