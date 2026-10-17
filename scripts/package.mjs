// Chrome ウェブストアに出す ZIP を作る: src/ → dist/chrome/ → dist/account-deck-for-aws-<版>.zip
//   npm run package
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, SRC } from "./lib/extension.mjs";

const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "chrome");

const manifest = JSON.parse(await readFile(path.join(SRC, "manifest.json"), "utf8"));
const zipPath = path.join(DIST, `account-deck-for-aws-${manifest.version}.zip`);

await rm(STAGE, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(DIST, { recursive: true });
await cp(SRC, STAGE, { recursive: true });

// tar（Windows 10 以降と macOS に入っている bsdtar）は拡張子 .zip を見て ZIP 形式で書く。
// Git Bash の tar は GNU tar（ZIP を書けず、C: をホスト名と解釈する）なので、Windows では System32 の tar を明示する。
// "./" 付きの名前にならないよう、最上位の項目を名前で並べて渡す
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const entries = await readdir(STAGE);
execFileSync(TAR, ["-a", "-c", "-f", zipPath, "-C", STAGE, ...entries], { stdio: "inherit" });

const listed = execFileSync(TAR, ["-t", "-f", zipPath], { encoding: "utf8" }).trim().split(/\r?\n/);
console.log(`ZIP: ${path.relative(ROOT, zipPath)}（${listed.filter((n) => !n.endsWith("/")).length} ファイル）`);
for (const name of listed) console.log("  " + name);
