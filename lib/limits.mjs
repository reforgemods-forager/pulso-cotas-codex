export function buckets(result) {
  const source = result?.rateLimitsByLimitId;
  const entries = source && Object.keys(source).length ? Object.entries(source) : result?.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  return entries.map(([id, data]) => ({id, name:data.limitName || (id === 'codex' ? 'Codex' : id), plan:data.planType || null,
    windows:['primary','secondary'].flatMap(slot => {
      const w=data[slot];
      if (!w || !Number.isFinite(w.usedPercent) || !Number.isFinite(w.resetsAt) || !Number.isFinite(w.windowDurationMins)) return [];
      return [{slot,used:Math.max(0,Math.min(100,w.usedPercent)),remaining:Math.max(0,Math.min(100,100-w.usedPercent)),resetsAt:w.resetsAt,durationMins:w.windowDurationMins}];
    })}));
}
export function detectChanges(before, after, now = Date.now()/1000) {
  if (!before || !after) return [];
  const events=[];
  for (const b of after) for (const w of b.windows) {
    const old=before.find(x=>x.id===b.id)?.windows.find(x=>x.slot===w.slot && x.durationMins===w.durationMins);
    if (!old) continue;
    const gain=w.remaining-old.remaining;
    // A passed deadline alone never proves a reset. Require an observed recovery.
    if (gain >= 1) {
      const full=w.used <= 1 && old.used >= 5;
      const due=now >= old.resetsAt-5;
      events.push({bucket:b.id,slot:w.slot,durationMins:w.durationMins,from:old.remaining,to:w.remaining,
        kind:full ? (due ? 'reset' : 'early_reset') : 'recovery',at:Math.floor(now)});
    }
  }
  return events;
}
