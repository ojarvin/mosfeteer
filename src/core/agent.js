/** One-shot JSON adapter for a user-configured circuit generation executable. */
import { spawn } from 'node:child_process';
import { HARD_CONSTRAINTS, SOFT_CONSTRAINTS, SUPPORTED_TEMPLATES, CIRCUIT_SPEC_VERSION } from './circuitSpec.js';
import { symbolTypeNames } from './components/index.js';

export const AGENT_PROTOCOL_VERSION = 1;
export const DEFAULT_AGENT_TIMEOUT_MS = 30_000;
export const DEFAULT_AGENT_OUTPUT_BYTES = 1_000_000;

export class AgentAdapterError extends Error {
  constructor(message, code = 'agent-error') {
    super(message);
    this.name = 'AgentAdapterError';
    this.code = code;
  }
}

/** The executable receives this JSON object on stdin. Keep it provider-neutral. */
export function agentRequest(request) {
  return {
    protocol: AGENT_PROTOCOL_VERSION,
    request,
    output: 'CircuitSpec',
    schema: {
      version: CIRCUIT_SPEC_VERSION,
      required: ['version', 'motif', 'components', 'nets'],
      component: { required: ['id', 'type'], fields: ['id', 'refdes', 'type', 'value', 'role', 'group', 'template'] },
      net: { required: ['id', 'terminals'], fields: ['id', 'name', 'terminals', 'kind', 'logicalGroup'] },
      terminal: { accepted: ['component.terminal', '{component,terminal}'] },
      optional: ['openTerminals', 'ports', 'constraints'],
    },
    capabilities: {
      circuitSpecVersion: CIRCUIT_SPEC_VERSION,
      templates: SUPPORTED_TEMPLATES,
      componentTypes: symbolTypeNames,
      hardConstraints: HARD_CONSTRAINTS,
      softConstraints: SOFT_CONSTRAINTS,
    },
  };
}

function configuredExecutable(env = process.env) {
  return env.SCHEMATIC_AGENT || env.SCHEMATIC_AGENT_EXECUTABLE || env.AGENT_COMMAND || env.AGENT_EXECUTABLE || '';
}

export function configuredExecutables(env = process.env) {
  return [...new Set([configuredExecutable(env), ...(env.SCHEMATIC_AGENT_COMMANDS || '').split(',').map((value) => value.trim()).filter(Boolean)])];
}

function positiveInt(value, fallback, max) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Invoke exactly one executable with no shell and bounded streams. */
export function runAgent(request, options = {}) {
  const executable = options.executable || configuredExecutable(options.env || process.env);
  if (!executable) return Promise.reject(new AgentAdapterError('agent executable is not configured; set SCHEMATIC_AGENT', 'not-configured'));
  const timeoutMs = positiveInt(options.timeoutMs ?? (options.env || process.env).SCHEMATIC_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS, 120_000);
  const maxOutputBytes = positiveInt(options.maxOutputBytes ?? (options.env || process.env).SCHEMATIC_AGENT_MAX_OUTPUT_BYTES, DEFAULT_AGENT_OUTPUT_BYTES, 10_000_000);
  const payload = JSON.stringify(agentRequest(String(request)));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, [], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(new AgentAdapterError(`could not start agent: ${error.message}`, 'spawn-error'));
      return;
    }
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const fail = (message, code = 'agent-error') => finish(reject, new AgentAdapterError(message, code));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`agent timed out after ${timeoutMs} ms`, 'timeout');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        child.kill('SIGKILL');
        fail(`agent output exceeded ${maxOutputBytes} bytes`, 'output-too-large');
      } else stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 16_000) stderr += chunk.toString().slice(0, 16_000 - stderr.length);
    });
    child.once('error', (error) => fail(`could not start agent: ${error.message}`, 'spawn-error'));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (signal) { fail(`agent terminated by ${signal}${stderr ? `: ${stderr.trim()}` : ''}`, 'agent-exit'); return; }
      if (code !== 0) { fail(`agent exited with status ${code}${stderr ? `: ${stderr.trim()}` : ''}`, 'agent-exit'); return; }
      let response;
      try { response = JSON.parse(stdout); }
      catch { fail(`agent returned malformed JSON${stderr ? `: ${stderr.trim()}` : ''}`, 'malformed-output'); return; }
      finish(resolve, response);
    });
    child.stdin.once('error', () => {});
    child.stdin.end(payload);
  });
}

export function agentExecutable(env = process.env) {
  return configuredExecutable(env);
}
