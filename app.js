/**
 * The Space UI: sign in, then turn an idea into a comic page drawn on a canvas.
 * All the API work lives in pipeline.js.
 */

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
  PANEL_SIZE,
  PollinationsError,
  createKeyStore,
  panelLayout,
  renderPanel,
  signIn,
  writeScript,
} from "./pipeline.js";


const element = (id) => document.getElementById(id);
const keyField = element("key");
const logOutput = element("log");
const statusPanel = element("status");

// Keeps the key in memory as well, so blocked storage cannot lose it.
const keys = createKeyStore();

function currentKey() {
  return keyField.value.trim() || keys.get();
}

function log(line) {
  statusPanel.hidden = false;
  logOutput.textContent += `${logOutput.textContent ? "\n" : ""}${line}`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function fail(message) {
  log(`✗ ${message}`);
  logOutput.className = "script status-error";
}

function succeed(message) {
  log(`✓ ${message}`);
}

/** Chooses a column count that keeps the page compact. */
function columnsFor(panels) {
  if (panels <= 2) return Math.max(1, panels);
  return panels % 3 === 0 ? 3 : 2;
}

/** Draws the page and returns it as a PNG blob. */
function composePage(panels, images) {
  const layout = panelLayout(panels.length, {
    columns: columnsFor(panels.length),
    size: PANEL_SIZE,
  });
  const canvas = element("page");
  canvas.width = layout.width;
  canvas.height = layout.height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#12121a";
  context.fillRect(0, 0, layout.width, layout.height);
  context.font = "22px system-ui, sans-serif";
  context.textBaseline = "top";

  panels.forEach((panel, index) => {
    const rect = layout.rects[index];
    context.drawImage(images[index], rect.x, rect.y, rect.size, rect.size);
    context.strokeStyle = "#464646";
    context.lineWidth = 1;
    context.strokeRect(
      rect.x + 0.5,
      rect.y + 0.5,
      rect.size - 1,
      rect.size - 1,
    );
    drawCaption(context, panel.caption, rect.x, rect.captionY, rect.size);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Wraps the caption under its panel. */
function drawCaption(context, caption, x, y, width) {
  context.fillStyle = "#ececf1";
  const lineHeight = 28;
  let line = "";
  let offsetY = y;

  for (const word of String(caption).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > width && line) {
      context.fillText(line, x, offsetY);
      offsetY += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, offsetY);
}

function describeFailure(error) {
  if (error instanceof PollinationsError) return error.message;
  return error?.message || "Something went wrong.";
}

async function generate() {
  const idea = element("idea").value.trim();
  const key = currentKey();
  const model = element("text-model").value.trim() || DEFAULT_TEXT_MODEL;
  const imageModel = element("image-model").value.trim() || DEFAULT_IMAGE_MODEL;
  const panels = Number(element("panels").value);

  if (!idea) {
    logOutput.className = "script";
    logOutput.textContent = "";
    fail("Write what the comic should be about first.");
    return;
  }
  if (!key) {
    logOutput.className = "script";
    logOutput.textContent = "";
    fail("Sign in with Pollinations, or paste your API key.");
    return;
  }

  const button = element("generate");
  button.disabled = true;
  element("result").hidden = true;
  logOutput.className = "script";
  logOutput.textContent = "";
  statusPanel.hidden = false;

  try {
    log(`writing the script with ${model}…`);
    const script = await writeScript({ idea, panels, key, model });
    log(`script ready: ${script.length} panels`);

    const images = [];
    for (const [index, panel] of script.entries()) {
      log(
        `drawing panel ${index + 1}/${script.length}: ${panel.caption.slice(0, 60)}`,
      );
      images.push(
        await renderPanel({
          imagePrompt: panel.imagePrompt,
          key,
          model: imageModel,
        }),
      );
    }

    log("assembling the page…");
    const blob = await composePage(script, images);
    element("download-page").href = URL.createObjectURL(blob);
    element("download-script").href =
      `data:text/plain;charset=utf-8,${encodeURIComponent(
        `${idea}\n\n${script.map((panel, index) => `${index + 1}. ${panel.caption}`).join("\n\n")}\n`,
      )}`;
    element("script").textContent = script
      .map((panel, index) => `${index + 1}. ${panel.caption}`)
      .join("\n\n");
    element("result").hidden = false;
    succeed("done — scroll up for the page");
  } catch (error) {
    fail(describeFailure(error));
  } finally {
    button.disabled = false;
  }
}

async function beginSignIn() {
  const button = element("signin");
  const box = element("device");
  button.disabled = true;
  box.hidden = false;
  element("device-state").textContent = "Requesting a code…";

  try {
    const token = await signIn({
      onCode: (code) => {
        element("device-code").textContent = code.user_code;
        element("device-link").href =
          code.verification_uri_complete || code.verification_uri;
        element("device-state").textContent = "Waiting for approval…";
      },
    });
    keys.set(token);
    keyField.value = "";
    element("device-state").textContent =
      "Signed in. Your requests are billed to your own Pollen.";
    element("device-state").className = "hint status-ok";
  } catch (error) {
    element("device-state").textContent = describeFailure(error);
    element("device-state").className = "hint status-error";
  } finally {
    button.disabled = false;
  }
}

function init() {
  keyField.value = keys.get();
  element("text-model").value = DEFAULT_TEXT_MODEL;
  element("image-model").value = DEFAULT_IMAGE_MODEL;

  element("generate").addEventListener("click", generate);
  element("signin").addEventListener("click", beginSignIn);
  element("forget").addEventListener("click", () => {
    keys.set("");
    keyField.value = "";
    element("device-state").textContent = "Key forgotten.";
    element("device-state").className = "hint";
  });
  keyField.addEventListener("change", () => keys.set(keyField.value.trim()));
  element("idea").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) generate();
  });
}

init();
