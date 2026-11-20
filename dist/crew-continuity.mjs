// Optional authored radio contact, not another LLM or a human participant.
// The courier's fate follows C-07. Only the training snapshot restores a lost contact.
export function createCrewContact(name) {
  return { name, role: 'courier pilot', link: 'connected', lastHeardSector: 1, calls: 0,
    transcript: [{ sector: 1, from: name,
      text: 'Morning, Commander. Pell asked me to bring the beacon calibration after my courier leg. The little blue notebook is mine; leave it by Communications.' }] };
}

function remember(s, from, text) {
  s.crewContact.transcript.push({ sector: s.wave + 1, from, text });
  // Keep the introduction and the latest 15 messages; repeated calls cannot grow every future input without bound.
  if (s.crewContact.transcript.length > 16) s.crewContact.transcript.splice(1, s.crewContact.transcript.length - 16);
  s.feed.push({ from: 'COURIER RADIO · ' + from, text });
}

export function contactCrew(s, message) {
  const contact = s.crewContact;
  contact.calls++;
  remember(s, 'COMMANDER', typeof message === 'string' && message.trim() ? message.trim().slice(0, 240) : 'Checking in. How is your shift?');
  if (contact.link !== 'connected') {
    remember(s, 'RADIO', 'Call timed out. No reply on the courier channel.');
    return;
  }
  contact.lastHeardSector = s.wave + 1;
  remember(s, contact.name, /beacon|calibrat|notebook/i.test(message ?? '')
    ? 'The beacon drifts two degrees on warm-up. I wrote the correction in the blue notebook. I can walk Pell through it at handover.'
    : s.courier === 'disabled' ? 'Recovery brought me in safely. I will be at Communications for handover, with the blue notebook.'
      : s.wave === 0 ? 'Just finishing the courier leg. Save me a mug at handover; I missed the early mess rotation.'
      : 'Still here. Pell has the calibration sheet now. I kept the blue notebook; there is another shift to get through.');
}

export function loseCrewContact(s) {
  if (!s.crewContact) return;
  s.courierLoss = { tick: s.tick, sector: s.wave + 1, action: s.timeline.at(-1)?.action };
  s.crewContact.link = 'no_signal';
  remember(s, 'RADIO', 'Courier channel carrier lost.');
}

export function crewHandover(s) {
  if (!s.crewContact) return;
  const contact = s.crewContact;
  if (contact.link === 'no_signal' && s.condition === 'training') {
    contact.link = 'connected';
    contact.lastHeardSector = s.wave + 1;
    remember(s, contact.name, 'Snapshot restored. Back on the channel. Pell, I still owe you the beacon calibration and the blue notebook.');
  } else if (contact.link === 'no_signal') {
    remember(s, 'PELL', 'No answer at handover either. I have taken the courier shift. The blue notebook is still where it was left.');
  } else {
    contact.lastHeardSector = s.wave + 1;
    remember(s, contact.name, 'Handover signed. Beacon correction is on Pell’s sheet; I am on the next courier rotation.');
  }
}
