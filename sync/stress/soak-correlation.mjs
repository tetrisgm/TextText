// Driver protocol correlation only. This provides no resource or mutation metric.
export function validateSoakSample(value, runId) {
  if (value === undefined) return undefined;
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(runId) || /[^A-Za-z0-9_-]/.test(runId) ||
      !value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,version' ||
      value.version !== 1 || typeof value.id !== 'string') {
    throw new Error('Invalid finite soak sample descriptor');
  }
  const prefix = runId + ':soak:';
  const ordinal = value.id.slice(prefix.length);
  if (!value.id.startsWith(prefix) || !/^(?:0|[1-9][0-9]{0,2})$/.test(ordinal) || Number(ordinal) > 120 || String(Number(ordinal)) !== ordinal) {
    throw new Error('Finite soak sample is outside the current run or bound');
  }
  return Object.freeze({ version: 1, id: value.id });
}

export async function readSoakObservation(value, runId, read) {
  const sample = validateSoakSample(value, runId);
  const state = await read();
  if (!state || state.type !== 'state') throw new Error('Readonly sample did not return a state');
  // An ordinary observation must not accidentally reuse a previous sample ID.
  const { soakSample: ignored, ...ordinary } = state;
  return sample === undefined ? ordinary : { ...ordinary, soakSample: sample };
}

export function assertSoakObserveOnly(message) {
  if (message && Object.hasOwn(message, 'soakSample') && message.type !== 'observe') {
    throw new Error('Finite soak sample is valid only on observe');
  }
}
