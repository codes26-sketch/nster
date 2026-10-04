import { getStore } from "@netlify/blobs";
import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const store = getStore({ name: "answer-room", consistency: "strong" });
const SESSION_COOKIE = "answer_room_session";
const SESSION_SECONDS = 60 * 60 * 12;

class SetupError extends Error {}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function safeEqual(left, right) {
  const leftDigest = createHmac("sha256", "answer-room-compare").update(String(left)).digest();
  const rightDigest = createHmac("sha256", "answer-room-compare").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new SetupError("The site owner needs to set SESSION_SECRET to a random value of at least 32 characters.");
  }
  return secret;
}

function makeSession(role, visitorVersion) {
  const payload = {
    role,
    visitorVersion,
    expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const entry = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function readSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.role || payload.expires < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  const secure = process.env.URL?.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function readSettings() {
  const settings = await store.get("settings", { type: "json", consistency: "strong" });
  if (settings) return settings;

  const initialPassword = process.env.VISITOR_PASSWORD;
  if (!initialPassword) {
    throw new SetupError("Set VISITOR_PASSWORD in the Netlify environment to enable visitor access.");
  }
  if (initialPassword.length < 5 || initialPassword.length > 128) {
    throw new SetupError("VISITOR_PASSWORD must be between 5 and 128 characters.");
  }

  const salt = randomBytes(16).toString("hex");
  await store.setJSON("settings", {
    visitorSalt: salt,
    visitorHash: scryptSync(initialPassword, salt, 64).toString("hex"),
    visitorVersion: 1,
  }, { onlyIfNew: true });
  return await store.get("settings", { type: "json", consistency: "strong" });
}

async function authenticatedSession(request) {
  const session = readSession(request);
  if (!session) return null;
  if (session.role === "visitor") {
    const settings = await readSettings();
    if (session.visitorVersion !== settings.visitorVersion) return null;
  }
  return session;
}

function endpointPath(request) {
  const pathname = new URL(request.url).pathname;
  const apiIndex = pathname.indexOf("/api/");
  if (apiIndex >= 0) return pathname.slice(apiIndex + 5);
  const functionIndex = pathname.indexOf("/.netlify/functions/api/");
  if (functionIndex >= 0) return pathname.slice(functionIndex + "/.netlify/functions/api/".length);
  return "";
}

async function requestBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getQuestions() {
  const { blobs } = await store.list({ prefix: "question/" });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
  return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function canCreate(role) {
  return role === "main-owner" || role === "content-owner";
}

export default async (request) => {
  try {
    const path = endpointPath(request);
    const method = request.method.toUpperCase();

    if (path === "session" && method === "GET") {
      const session = await authenticatedSession(request);
      return json({ authenticated: Boolean(session), role: session?.role || null });
    }

    if (path === "login" && method === "POST") {
      const body = await requestBody(request);
      const password = typeof body?.password === "string" ? body.password : "";
      let role = null;
      let visitorVersion;

      if (body?.type === "owner") {
        if (process.env.MAIN_OWNER_PASSWORD && safeEqual(password, process.env.MAIN_OWNER_PASSWORD)) {
          role = "main-owner";
        } else if (process.env.CONTENT_OWNER_PASSWORD && safeEqual(password, process.env.CONTENT_OWNER_PASSWORD)) {
          role = "content-owner";
        }
      } else if (body?.type === "visitor") {
        const settings = await readSettings();
        const candidate = scryptSync(password, settings.visitorSalt, 64).toString("hex");
        if (safeEqual(candidate, settings.visitorHash)) {
          role = "visitor";
          visitorVersion = settings.visitorVersion;
        }
      }

      if (!role) return json({ error: "That password did not match. Please try again." }, 401);
      return json({ authenticated: true, role }, 200, {
        "set-cookie": sessionCookie(makeSession(role, visitorVersion)),
        "cache-control": "no-store",
      });
    }

    if (path === "logout" && method === "POST") {
      return json({ authenticated: false }, 200, {
        "set-cookie": sessionCookie("", 0),
        "cache-control": "no-store",
      });
    }

    const session = await authenticatedSession(request);
    if (!session) return json({ error: "Please unlock the library to continue." }, 401);

    if (path === "questions" && method === "GET") {
      return json({ questions: await getQuestions() }, 200, { "cache-control": "no-store" });
    }

    if (path === "questions" && method === "POST") {
      if (!canCreate(session.role)) return json({ error: "This account cannot add questions." }, 403);
      const body = await requestBody(request);
      const question = typeof body?.question === "string" ? body.question.trim() : "";
      const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      const language = typeof body?.language === "string" && /^[a-z0-9+#.-]{1,20}$/i.test(body.language)
        ? body.language.toLowerCase()
        : "text";

      if (!question || !answer) return json({ error: "Add both a question and an answer." }, 400);
      if (question.length > 280 || answer.length > 12000 || code.length > 12000) {
        return json({ error: "Please keep the question, answer, and code within the indicated limits." }, 400);
      }

      const record = {
        id: randomUUID(),
        question,
        answer,
        code,
        language,
        createdAt: new Date().toISOString(),
        createdBy: session.role,
      };
      await store.setJSON(`question/${record.id}`, record, { onlyIfNew: true });
      return json({ question: record }, 201, { "cache-control": "no-store" });
    }

    if (path === "admin/visitor-password" && method === "POST") {
      if (session.role !== "main-owner") return json({ error: "Only the main owner can change the visitor password." }, 403);
      const body = await requestBody(request);
      const password = typeof body?.password === "string" ? body.password.trim() : "";
      if (password.length < 5 || password.length > 128) {
        return json({ error: "Choose a visitor password between 5 and 128 characters." }, 400);
      }
      const settings = await readSettings();
      const visitorSalt = randomBytes(16).toString("hex");
      await store.setJSON("settings", {
        visitorSalt,
        visitorHash: scryptSync(password, visitorSalt, 64).toString("hex"),
        visitorVersion: settings.visitorVersion + 1,
      });
      return json({ updated: true }, 200, { "cache-control": "no-store" });
    }

    return json({ error: "That library action was not found." }, 404);
  } catch (error) {
    if (error instanceof SetupError) return json({ error: error.message }, 503);
    console.error("Answer Room API error", error);
    return json({ error: "The library could not complete that request. Please try again." }, 500);
  }
};
