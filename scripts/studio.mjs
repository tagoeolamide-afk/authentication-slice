/*
 * Opens Prisma Studio on the SQLite database.
 *
 * Why this exists: Prisma 7.10's Studio only recognises SQLite URLs written as
 * "file://<path>", but the app's DATABASE_URL uses the standard "file:./dev.db" form,
 * which Studio rejects as "not supported". This turns it into an absolute
 * file:// URL that Studio accepts, then starts Studio with it.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const file = url.replace(/^file:(\/\/)?/, "");
const absolute = path.resolve(process.cwd(), file).split(path.sep).join("/");

const cli = path.resolve("node_modules/prisma/build/index.js");
const child = spawn(process.execPath, [cli, "studio", "--url", `file://${absolute}`, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
