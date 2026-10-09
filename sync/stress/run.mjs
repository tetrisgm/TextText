#!/usr/bin/env node
// Usage: node sync/stress/run.mjs <config.json>   (see README.md; exits 1 on first failure, evidence kept)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Coordinator } from './coordinator.mjs';

const path = process.argv[2];
if (!path) { process.stderr.write('usage: node sync/stress/run.mjs <config.json>\n'); process.exit(2); }
const config = JSON.parse(readFileSync(resolve(path), 'utf8'));
const summary = await new Coordinator(config).run();
process.stdout.write(`${summary.status} (${summary.roundsCompleted}/${summary.roundsPlanned} rounds, acceptance ${summary.acceptance})\n${summary.outputDir}\n`);
if (summary.failure) process.stdout.write(`${summary.failure.code}: ${JSON.stringify(summary.failure.detail).slice(0, 1000)}\n`);
process.exit(summary.status === 'passed' ? 0 : 1);
