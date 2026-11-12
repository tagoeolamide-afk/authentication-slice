import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { authRouter } from "./auth-routes";
import { config } from "./config";
import { redirectIfSignedIn, requireSessionPage } from "./session";
import { getPending } from "./verification";

const app = express();
const PUBLIC_DIR = path.resolve(process.cwd(), "login-screen");

app.disable("x-powered-by");
// Behind a reverse proxy in production, trust its X-Forwarded-For so rate limits see real client IPs.
if (config.isProduction) app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));

/*
 * CSRF defence for the API: only accept JSON (a cross-site HTML form can't send it without
 * a CORS preflight, which we never approve) and reject requests from another origin.
 */
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (!req.is("application/json")) return res.status(415).json({ error: "Send JSON." });
  const origin = req.headers.origin;
  const sameOrigin = `${req.protocol}://${req.headers.host}`;
  if (origin && origin !== sameOrigin && origin !== new URL(config.appUrl).origin) {
    return res.status(403).json({ error: "Cross-origin request blocked." });
  }
  next();
});

app.use("/api/auth", authRouter);

/*
 * Every way of writing a page's address ("/dashboard", "/Dashboard.html", "/./dashboard.html/")
 * is rewritten to one standard form ("/dashboard.html") first, so the guards below can't be
 * side-stepped by spelling the URL differently. The query string (e.g. ?token=…) is kept.
 */
const PAGES = new Set(["index", "sign-up", "verify-email", "forgot-password", "reset-password", "dashboard"]);
app.use((req, _res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  let name: string;
  try {
    name = path.posix.normalize(decodeURIComponent(req.path)).toLowerCase();
  } catch {
    return next(); // malformed address: leave it to the 404 handling
  }
  name = name.replace(/\/+$/, "").replace(/^\/+/, "").replace(/\.html$/, "") || "index";
  if (PAGES.has(name)) {
    const q = req.url.indexOf("?");
    req.url = `/${name}.html${q === -1 ? "" : req.url.slice(q)}`;
  }
  next();
});

// Page guards run before the static files are served.
app.get(["/", "/index.html", "/sign-up.html"], redirectIfSignedIn);
app.get("/dashboard.html", requireSessionPage, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
// The code screen only makes sense straight after sign-up / an unverified login.
app.get("/verify-email.html", redirectIfSignedIn, (req, res, next) => {
  if (!getPending(req)) return res.redirect(302, "/index.html");
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/reset-password.html", (_req, res, next) => {
  res.set("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(config.port, () => {
  console.info(`shrink running at http://localhost:${config.port}`);
});
