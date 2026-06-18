export function unresolvedContactJIDs(records: Array<{ jid?: string; display_name?: string; number?: string; profile_picture_id?: string }>) {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const jid = String(record.jid || '').trim();
    const displayName = String(record.display_name || '').trim();
    const needsResolve = !record.profile_picture_id || !record.number || !displayName || displayName === '未知联系人' || displayName.startsWith('LID ') || displayName.startsWith('联系人');
    if (!jid.endsWith('@lid') || !needsResolve || seen.has(jid)) continue;
    seen.add(jid);
    targets.push(jid);
    if (targets.length >= 20) break;
  }
  return targets;
}
