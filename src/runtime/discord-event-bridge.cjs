function installDiscordEventBridge() {
  if (typeof process.send !== 'function') return;
  let discord;
  try { discord = require('discord.js'); } catch { return; }
  const Client = discord.Client;
  if (!Client?.prototype || Client.prototype.__fallenHeavenEventBridge) return;

  const originalEmit = Client.prototype.emit;
  const queue = [];
  let timer = null;
  const flush = () => {
    timer = null;
    if (!queue.length || typeof process.send !== 'function') return;
    const events = queue.splice(0, 120);
    try { process.send({ type: 'runtime:events', payload: events }); } catch {}
    if (queue.length) timer = setTimeout(flush, 150);
  };
  const enqueue = (payload) => {
    queue.push({ ...payload, observedAt: new Date().toISOString() });
    if (queue.length > 1000) queue.splice(0, queue.length - 1000);
    if (!timer) timer = setTimeout(flush, 150);
  };

  function messagePayload(kind, message) {
    if (!message?.guildId || !message?.channelId) return null;
    return {
      kind,
      guildId: String(message.guildId),
      channelId: String(message.channelId),
      messageId: message.id ? String(message.id) : null,
      authorId: message.author?.id ? String(message.author.id) : null,
      createdTimestamp: Number(message.createdTimestamp || Date.now()),
      attachmentCount: Number(message.attachments?.size || 0),
      stickerCount: Number(message.stickers?.size || 0)
    };
  }

  Client.prototype.emit = function fallenHeavenEmit(eventName, ...args) {
    try {
      if (eventName === 'messageCreate') {
        const payload = messagePayload('message:create', args[0]);
        if (payload) enqueue(payload);
      } else if (eventName === 'messageUpdate') {
        const payload = messagePayload('message:update', args[1] || args[0]);
        if (payload) enqueue(payload);
      } else if (eventName === 'messageDelete') {
        const payload = messagePayload('message:delete', args[0]);
        if (payload) enqueue(payload);
      } else if (eventName === 'guildMemberAdd' || eventName === 'guildMemberRemove') {
        const member = args[0];
        if (member?.guild?.id && member?.id) enqueue({ kind: eventName === 'guildMemberAdd' ? 'member:add' : 'member:remove', guildId: String(member.guild.id), memberId: String(member.id) });
      } else if (eventName === 'guildMemberUpdate') {
        const previous = args[0];
        const current = args[1];
        if (current?.guild?.id && current?.id) {
          enqueue({
            kind: 'member:update', guildId: String(current.guild.id), memberId: String(current.id),
            boostChanged: Number(previous?.premiumSinceTimestamp || 0) !== Number(current.premiumSinceTimestamp || 0),
            roleCount: Number(current.roles?.cache?.size || 0)
          });
        }
      } else if (['channelCreate', 'channelUpdate', 'channelDelete', 'threadCreate', 'threadUpdate', 'threadDelete'].includes(eventName)) {
        const channel = args[1] || args[0];
        if (channel?.guildId && channel?.id) enqueue({ kind: eventName.replace(/([A-Z])/g, ':$1').toLowerCase(), guildId: String(channel.guildId), channelId: String(channel.id) });
      }
    } catch {}
    return originalEmit.call(this, eventName, ...args);
  };
  Object.defineProperty(Client.prototype, '__fallenHeavenEventBridge', { value: true });
}

module.exports = { installDiscordEventBridge };
