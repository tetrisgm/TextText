import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { pdfFixture } from "../src/lib/reading/__tests__/pdf-fixture.ts";

// Exercise Turbopack's emitted worker, not the original source copied by tracing.
// This catches its workerData wrapping and its bundled dependency resolution.
const directory = resolve(process.argv[2] ?? ".texttext/oracle-build");
const chunks = resolve(directory, "server/chunks");
const matches = readdirSync(chunks).filter(name =>
  name.startsWith("[worker thread]-src_lib_reading_pdf-extraction_worker_mjs_") && name.endsWith(".js"));
if (matches.length !== 1) throw new Error("Expected one bundled PDF parser worker.");
const worker = new Worker(resolve(chunks, matches[0]), {
  workerData: { bytes: pdfFixture("Production PDF worker verified"), __turbopack_globals__: {} },
  env: {}, execArgv: [], stdout: true, stderr: true,
  resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
});
worker.stdout.resume(); worker.stderr.resume();
let result;
const timer = setTimeout(() => { void worker.terminate(); }, 8_000);
try {
  const code = await new Promise((accept, reject) => {
    worker.once("message", value => { result = value; });
    worker.once("error", reject); worker.once("exit", accept);
  });
  if (code !== 0 || result?.markdown !== "Production PDF worker verified") {
    throw new Error("Bundled PDF parser did not preserve bytes and finish cleanly.");
  }
  console.log("PASS bundled production PDF worker");
} finally { clearTimeout(timer); await worker.terminate(); }
