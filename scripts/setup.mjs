#!/usr/bin/env node
// JARVIS preflight — a friendly, advisory check you run with `npm run setup`.
//
// It changes nothing and installs nothing. It looks at your machine, tells you
// what is ready and what is missing, and prints the two commands that start
// JARVIS. Every check degrades to a single friendly line if something is not
// there, and the script always exits 0 — it is advice, not a gate.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const tick = '  ok  ';
const warn = ' note ';
const info = '  ·   ';

function line(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

console.log('');
console.log('JARVIS preflight — checking your machine (nothing is changed)');
console.log('------------------------------------------------------------');

// --- Node version --------------------------------------------------------
try {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= 20) {
    line(tick, `Node.js ${process.versions.node} (20+ required).`);
  } else {
    line(warn, `Node.js ${process.versions.node} is below 20. Please upgrade — the bridge needs Node 20 or newer.`);
  }
} catch {
  line(warn, 'Could not read the Node.js version. JARVIS needs Node 20 or newer.');
}

// --- Google Antigravity / Gemini ---------------------------------------
function checkGeminiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return 'environment (GEMINI_API_KEY)';
  }
  try {
    const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    const match = envLocal.match(/^\s*GEMINI_API_KEY\s*=\s*([^\s#]+)/m);
    if (match && match[1]) return '.env.local';
  } catch {
    // ignore
  }
  return null;
}

const geminiSource = checkGeminiKey();
if (geminiSource) {
  line(tick, `Google Antigravity / Gemini brain ready — key found via ${geminiSource}.`);
} else {
  line(info, 'No GEMINI_API_KEY found. You can add one in .env.local to use Google Antigravity / Gemini (free from https://aistudio.google.com/app/api-keys).');
}

// --- Antigravity MCP servers ---------------------------------------------
const agyMcpPath = join(homedir(), '.gemini', 'config', 'mcp_config.json');
try {
  const agyRaw = readFileSync(agyMcpPath, 'utf8');
  const agyParsed = JSON.parse(agyRaw);
  const agyServers = agyParsed?.mcpServers ? Object.keys(agyParsed.mcpServers) : [];
  if (agyServers.length > 0) {
    line(tick, `Antigravity MCP config found with ${agyServers.length} server${agyServers.length === 1 ? '' : 's'} (${agyServers.join(', ')}).`);
  }
} catch {
  // ignore
}

// --- Claude CLI on PATH (optional alternative) ---------------------------
let claudeFound = false;
try {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (res.status === 0 && res.stdout) {
    claudeFound = true;
    line(tick, `Claude CLI found: ${res.stdout.trim()}`);
  }
} catch {
  // ignore
}
if (!claudeFound && !geminiSource) {
  line(warn, 'Neither GEMINI_API_KEY nor Claude CLI was detected.');
  line(info, 'Recommendation: Set GEMINI_API_KEY in .env.local to run with Google Antigravity / Gemini.');
}

// --- ~/.claude.json and MCP servers --------------------------------------
const claudeJsonPath = join(homedir(), '.claude.json');
let mcpCount = 0;
try {
  const raw = readFileSync(claudeJsonPath, 'utf8');
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const servers = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers : {};
  mcpCount = Object.keys(servers).length;
  if (mcpCount > 0) {
    line(tick, `~/.claude.json found with ${mcpCount} MCP server${mcpCount === 1 ? '' : 's'} configured.`);
  }
} catch {
  // ignore
}

// --- ElevenLabs key (env or the elevenlabs MCP entry) --------------------
function findElevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    return 'environment (ELEVENLABS_API_KEY)';
  }
  try {
    const raw = readFileSync(claudeJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const servers = parsed && parsed.mcpServers ? parsed.mcpServers : {};
    const el = servers.elevenlabs;
    const env = el && el.env ? el.env : {};
    if (env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim()) {
      return 'the elevenlabs MCP server in ~/.claude.json';
    }
  } catch {
    // ignore — no key discoverable
  }
  return null;
}

const elSource = findElevenLabsKey();
if (elSource) {
  line(tick, `Premium voice available — ElevenLabs key found via ${elSource}.`);
} else {
  line(info, 'No ElevenLabs key found — JARVIS will use browser speech (that is completely fine).');
}

// --- How to run ----------------------------------------------------------
console.log('');
console.log('To run JARVIS:');
console.log('  npm start           # runs the brain and face together');
console.log('  or:');
console.log('  Terminal 1: npm run bridge');
console.log('  Terminal 2: npm run dev');
console.log('');
console.log('Then open http://localhost:5173 in Chrome or Edge, click INITIALISE, and say "Hey Jarvis".');
console.log('');

process.exit(0);
