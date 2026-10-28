export function subscriptionFromInput(data, now = Date.now()) {
  if (data.date === null || data.date === '') return null;
  if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error('INVALID_SUBSCRIPTION_DATE');
  const parsed = new Date(`${data.date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== data.date) throw new Error('INVALID_SUBSCRIPTION_DATE');
  if (!['period_end','renewal'].includes(data.kind)) throw new Error('INVALID_SUBSCRIPTION_KIND');
  return {date:data.date,kind:data.kind,source:'manual',updatedAt:now};
}
