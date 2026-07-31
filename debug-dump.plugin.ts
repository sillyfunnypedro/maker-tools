// Dev-only debug dump endpoint.
//
// Receives a debug bundle (source photo, pipeline intermediates, exported SVG,
// metadata) from the running app and writes it to disk, so the files can be
// inspected outside the browser instead of being read off a screenshot.
//
// `apply: "serve"` means this exists only under `vite dev` and can never end up
// in a production build. Note that the dev server runs with `host: true`, so
// while it is running this write endpoint is reachable from other machines on
// the LAN. Filenames are sanitised and everything is confined to `outDir`, but
// don't leave the dev server exposed on an untrusted network.
import { createWriteStream, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

/** Reject anything that isn't a plain filename: no slashes, no "..", no dotfiles. */
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_BYTES = 64 * 1024 * 1024; // one photo + intermediates, with headroom

export function debugDump(outDir = "debug-dumps"): Plugin {
  return {
    name: "debug-dump",
    apply: "serve",
    configureServer(server) {
      const root = resolve(server.config.root, outDir);

      server.middlewares.use("/__debug/dump", (req, res) => {
        const done = (code: number, body: string) => {
          res.statusCode = code;
          res.setHeader("content-type", "text/plain");
          res.end(body);
        };
        if (req.method !== "POST") return done(405, "POST only");

        const q = new URL(req.url ?? "/", "http://localhost").searchParams;
        const session = q.get("session") ?? "";
        const name = q.get("name") ?? "";
        if (!SAFE.test(session) || !SAFE.test(name)) return done(400, "bad session or name");

        const dir = join(root, session);
        let file: string;
        try {
          mkdirSync(dir, { recursive: true });
          file = join(dir, name);
        } catch (e) {
          return done(500, `mkdir failed: ${String(e)}`);
        }

        const out = createWriteStream(file);
        let size = 0;
        let aborted = false;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES && !aborted) {
            aborted = true;
            out.destroy();
            done(413, `over ${MAX_BYTES} bytes`);
            req.destroy();
          }
        });
        req.on("error", () => { if (!aborted) { aborted = true; out.destroy(); done(400, "request error"); } });
        out.on("error", (e) => { if (!aborted) { aborted = true; done(500, String(e)); } });
        out.on("finish", () => {
          if (aborted) return;
          server.config.logger.info(
            `[debug-dump] ${relative(process.cwd(), file)} · ${size} bytes`,
            { timestamp: true },
          );
          done(200, "ok");
        });
        req.pipe(out);
      });

      server.config.logger.info(
        `[debug-dump] POST /__debug/dump?session=<id>&name=<file> -> ${relative(process.cwd(), root)}/`,
        { timestamp: true },
      );
    },
  };
}
