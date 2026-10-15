/**
 * The fragile parts of the static Space: the script parser, the page geometry,
 * and the device-flow polling. No network, no browser, no API key.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parsePanels, panelLayout, describeError, signIn, writeScript, PollinationsError } from "../pipeline.js";

const jsonResponse = (body, status = 200) => ({
    ok: status / 100 === 2,
    status,
    json: async () => body,
    blob: async () => body,
});

test("parsePanels reads strict JSON", () => {
    const panels = parsePanels('{"panels":[{"caption":"A","image":"a lighthouse"},{"caption":"B","image":"a cloud"}]}', 2, "x");

    assert.deepEqual(panels.map((p) => p.caption), ["A", "B"]);
    assert.equal(panels[0].imagePrompt, "a lighthouse");
});

test("parsePanels reads JSON inside a code fence", () => {
    const answer = 'Here you go:\n```json\n{"panels":[{"caption":"A","image":"a"}]}\n```';

    assert.equal(parsePanels(answer, 1, "x")[0].caption, "A");
});

test("parsePanels reads JSON surrounded by prose", () => {
    const answer = 'Sure! {"panels":[{"caption":"A","image":"a"}]} Hope that helps.';

    assert.equal(parsePanels(answer, 1, "x")[0].caption, "A");
});

test("parsePanels falls back to lines when there is no JSON", () => {
    const panels = parsePanels("- A lighthouse keeper waves\n- A cloud answers\nnoise", 2, "a storm");

    assert.equal(panels.length, 2);
    assert.equal(panels[0].caption, "A lighthouse keeper waves");
    assert.match(panels[0].imagePrompt, /a storm/);
});

test("parsePanels never returns more panels than asked for", () => {
    const answer = '{"panels":[{"caption":"a","image":"a"},{"caption":"b","image":"b"},{"caption":"c","image":"c"}]}';

    assert.equal(parsePanels(answer, 2, "x").length, 2);
});

test("parsePanels falls back to the idea when the answer is empty", () => {
    const panels = parsePanels("", 4, "a lonely robot");

    assert.equal(panels.length, 1);
    assert.match(panels[0].imagePrompt, /a lonely robot/);
});

test("parsePanels uses the caption when the image field is missing", () => {
    const panel = parsePanels('{"panels":[{"caption":"A keeper waves"}]}', 1, "x")[0];

    assert.equal(panel.imagePrompt, panel.caption);
});

test("panelLayout leaves room for every caption", () => {
    const layout = panelLayout(4, { columns: 2, size: 512, captionHeight: 96, pad: 16 });

    assert.equal(layout.columns, 2);
    assert.equal(layout.rows, 2);
    assert.equal(layout.rects.length, 4);
    assert.equal(layout.width, 2 * 512 + 3 * 16);
    assert.equal(layout.height, 2 * (512 + 96) + 3 * 16);
});

test("panelLayout puts the first panel in the top left and the second to its right", () => {
    const { rects } = panelLayout(4, { columns: 2, size: 512, captionHeight: 96, pad: 16 });

    assert.deepEqual([rects[0].x, rects[0].y], [16, 16]);
    assert.equal(rects[1].y, 16, "the second panel sits on the same row");
    assert.equal(rects[1].x, 16 + 512 + 16);
    assert.ok(rects[2].y > rects[0].y, "the third panel starts a new row");
    assert.ok(rects[0].captionY > rects[0].y + 512, "captions sit below their panel");
});

test("panelLayout keeps a single column when asked for more columns than panels", () => {
    const layout = panelLayout(1, { columns: 2, size: 512 });

    assert.equal(layout.columns, 1);
    assert.equal(layout.rects.length, 1);
});

test("describeError prefers the API message", () => {
    assert.equal(
        describeError(402, { error: { message: "Insufficient balance" } }),
        "Insufficient balance",
    );
    assert.equal(describeError(500, { error: "boom" }), "boom");
    assert.equal(describeError(503, null), "Pollinations answered HTTP 503");
});

test("writeScript sends the key and returns parsed panels", async () => {
    let seen;
    const fetchImpl = async (url, options) => {
        seen = { url, options };
        return jsonResponse({ choices: [{ message: { content: '{"panels":[{"caption":"A","image":"a"}]}' } }] });
    };

    const panels = await writeScript({ idea: "a storm", panels: 1, key: "sk_test", model: "m", fetchImpl });

    assert.equal(panels[0].caption, "A");
    assert.equal(seen.options.headers.authorization, "Bearer sk_test");
    assert.match(seen.url, /chat\/completions$/);
});

test("writeScript surfaces an API error instead of a stack trace", async () => {
    const fetchImpl = async () => jsonResponse({ error: { message: "A valid API key is required" } }, 401);

    await assert.rejects(
        () => writeScript({ idea: "x", panels: 1, key: "", model: "m", fetchImpl }),
        (error) => error instanceof PollinationsError && /valid API key/.test(error.message),
    );
});

test("signIn reports the code and returns the minted key", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        if (url.endsWith("/api/device/code")) {
            return jsonResponse({ device_code: "dev", user_code: "ABCD", verification_uri: "https://enter/device", interval: 1 });
        }
        if (calls.filter((u) => u.endsWith("/api/device/token")).length < 2) {
            return jsonResponse({ error: "authorization_pending" }, 400);
        }
        return jsonResponse({ access_token: "sk_minted" });
    };
    let shown;
    const token = await signIn({
        fetchImpl,
        onCode: (code) => {
            shown = code;
        },
        sleep: async () => {},
    });

    assert.equal(token, "sk_minted");
    assert.equal(shown.user_code, "ABCD");
    assert.equal(calls.filter((u) => u.endsWith("/device/token")).length, 2, "it polls until approved");
});

test("signIn attributes the app when an app key is configured", async () => {
    const bodies = [];
    const fetchImpl = async (url, options) => {
        bodies.push(JSON.parse(options.body));
        return url.endsWith("/api/device/code")
            ? jsonResponse({ device_code: "dev", user_code: "ABCD", verification_uri: "https://enter/device", interval: 1 })
            : jsonResponse({ access_token: "sk_minted" });
    };

    await signIn({ fetchImpl, appKey: "pk_test", sleep: async () => {} });

    assert.equal(bodies[0].client_id, "pk_test", "the code request carries the app key");
    assert.equal(bodies[1].client_id, "pk_test", "and so does the token request");
});

test("signIn gives up with a readable message when nobody approves", async () => {
    const fetchImpl = async (url) =>
        url.endsWith("/api/device/code")
            ? jsonResponse({ device_code: "dev", user_code: "ABCD", verification_uri: "https://enter/device", interval: 1 })
            : jsonResponse({ error: "authorization_pending" }, 400);

    await assert.rejects(
        () => signIn({ fetchImpl, timeoutSeconds: 0, sleep: async () => {} }),
        (error) => error instanceof PollinationsError && /not approved in time/.test(error.message),
    );
});
