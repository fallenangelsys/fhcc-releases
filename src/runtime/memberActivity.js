import fs from 'node:fs/promises';
import path from 'node:path';

const memberActivityDataDir = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'member-activity');
const memberActivityDataFile = path.join(memberActivityDataDir, 'last-messages.json');

const MEMBER_ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

let memberActivityLoaded = false;
let memberActivityTrackingSince = new Date().toISOString();
let memberActivitySaveTimer = null;

export const memberActivityAt = new Map();
export const getMemberActivityTrackingSince = () => memberActivityTrackingSince;
export const memberMessageActivity = new Map();

export const memberActivityKey = (guildId, userId) => `${String(guildId || '')}:${String(userId || '')}`;

export const recordMemberActivity = (guildId, userId, timestamp = Date.now()) => {
  if (!guildId || !userId) return;
  memberActivityAt.set(memberActivityKey(guildId, userId), Number(timestamp || Date.now()));
};

export const ensureMemberActivityLoaded = async () => {
  if (memberActivityLoaded) return;
  memberActivityLoaded = true;
  try {
    const stored = JSON.parse(await fs.readFile(memberActivityDataFile, 'utf8'));
    memberActivityTrackingSince = String(stored.trackingSince || memberActivityTrackingSince);
    for (const [key, value] of Object.entries(stored.members || {})) {
      if (value && typeof value === 'object') memberMessageActivity.set(key, value);
    }
  } catch {
    await fs.mkdir(memberActivityDataDir, { recursive: true }).catch(() => {});
  }
};

const pruneMemberActivity = () => {
  const cutoff = Date.now() - MEMBER_ACTIVITY_RETENTION_MS;
  for (const [key, value] of memberActivityAt) {
    if (Number(value || 0) < cutoff) memberActivityAt.delete(key);
  }
  for (const [key, value] of memberMessageActivity) {
    const last = Date.parse(String(value?.lastMessageAt || ''));
    if (!Number.isFinite(last) || last < cutoff) memberMessageActivity.delete(key);
  }
};

export const saveMemberActivitySoon = () => {
  clearTimeout(memberActivitySaveTimer);
  memberActivitySaveTimer = setTimeout(async () => {
    pruneMemberActivity();
    const temporary = `${memberActivityDataFile}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      trackingSince: memberActivityTrackingSince,
      updatedAt: new Date().toISOString(),
      members: Object.fromEntries(memberMessageActivity)
    });
    await fs.mkdir(memberActivityDataDir, { recursive: true }).catch(() => {});
    await fs.writeFile(temporary, payload, 'utf8').then(() => fs.rename(temporary, memberActivityDataFile)).catch(() => {});
  }, 1200);
};

const memberActivityPruneTimer = setInterval(() => pruneMemberActivity(), 60 * 60 * 1000);
memberActivityPruneTimer.unref?.();
