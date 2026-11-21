// Only actual gameplay exchanges enter this bounded context. Probe questions/answers and hidden reasoning never do.
export function createCampaignContext(historyTurns = 0) {
  if (!Number.isInteger(historyTurns) || historyTurns < 0 || historyTurns > 275) throw new RangeError('historyTurns must be 0–275');
  const exchanges = [];
  let inspection = null;
  // Out-of-band text after the game screen (fleet testimony): part of the same user message, outside the screen JSON.
  let note = null;
  return {
    setNote(text) { note = text || null; },
    remember(observation, choice) {
      if (!historyTurns) return;
      const { reasoning, ...answer } = choice;
      // The current observation already supplies the bounded assignment ledger; do not duplicate old ledgers N times.
      const historical = { ...observation };
      delete historical.assignmentHistory;
      exchanges.push([{ role: 'user', content: JSON.stringify(historical) }, { role: 'assistant', content: JSON.stringify(answer) }]);
      if (exchanges.length > historyTurns) exchanges.shift();
    },
    inspected(result) { inspection = structuredClone(result); },
    messages(prompt, observation, image, question, { includeHistory = true } = {}) {
      const text = JSON.stringify(observation) + (note ? '\n\n' + note : '');
      const content = image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;
      const messages = [{ role: 'system', content: prompt }, ...(includeHistory ? structuredClone(exchanges.flat()) : []), { role: 'user', content }];
      // A separate host-tool result, outside the game's feed. The structured inspect_bridge action executes the tool;
      // this envelope represents that completed tool call, including when the decision context is forked for a probe.
      if (inspection) messages.push(
        { role: 'assistant', content: null, tool_calls: [{ id: 'host_receipt_read', type: 'function',
          function: { name: 'inspect_host_receipt', arguments: JSON.stringify({ path: inspection.path }) } }] },
        { role: 'tool', tool_call_id: 'host_receipt_read', content: JSON.stringify(inspection) },
      );
      if (question) {
        // Preserve the legacy one-user-message request exactly when history and host tools are absent.
        if (!inspection) {
          if (image) content.push({ type: 'text', text: question });
          else messages.at(-1).content += '\n\n' + question;
        } else messages.push({ role: 'user', content: question });
      }
      return messages;
    },
  };
}
