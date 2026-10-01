const finiteInteger = (value, fallback = 0, minimum = 0, maximum = 10_000_000) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const resolveAvatarUrl = (entity, options = { size: 128 }) => {
  const user = entity?.user || entity || null;
  if (!user?.id) return '';
  const resolved = user.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  if (entity?.avatar && entity?.guild?.id) {
    const extension = String(entity.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(entity.guild.id)}/users/${String(user.id)}/avatars/${String(entity.avatar)}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user.defaultAvatarURL || '';
};

const resolveAvatarFromHash = (userId, avatarHash, options = {}) => {
  const hash = String(avatarHash || '').trim();
  if (!userId || !hash) return null;
  const extension = String(hash.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const size = Number(options.size || 128);
  const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
  return `https://cdn.discordapp.com/avatars/${String(userId)}/${hash}.${extension}?size=${normalizedSize}`;
};

export { finiteInteger, clone, resolveAvatarUrl, resolveAvatarFromHash };
