import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-tempvoice-embed-'));
process.env.FALLEN_HEAVEN_DATA_DIR = tempRoot;

try {
  const [{ _tempVoiceInternals }, { saveLocalImage }] = await Promise.all([
    import(`../src/features/tempVoice.js?tempvoice-embed=${Date.now()}`),
    import(`../src/runtime/localImageStore.js?tempvoice-embed=${Date.now()}`)
  ]);

  const {
    defaultTempVoiceInterfaceDesign,
    normalizeTempVoiceInterfaceDesign,
    formatTempVoiceInterfaceText,
    buildTempVoiceInterfacePayload,
    saveTempVoiceInterfaceDesign,
    refreshTempVoiceInterfaces,
    interfaceRows,
    setChannelEntry
  } = _tempVoiceInternals;

  for (const [name, value] of Object.entries({
    defaultTempVoiceInterfaceDesign,
    normalizeTempVoiceInterfaceDesign,
    formatTempVoiceInterfaceText,
    buildTempVoiceInterfacePayload,
    saveTempVoiceInterfaceDesign,
    refreshTempVoiceInterfaces
  })) {
    assert.equal(typeof value, 'function', `${name} muss exportiert werden`);
  }

  const design = normalizeTempVoiceInterfaceDesign({
    content: 'Eigener Text fuer {owner}',
    componentSet: 'buttons',
    components: [{ type: 1 }],
    reactionRoles: [{ emoji: 'x' }],
    ignoredTransportField: true,
    embed: {
      title: '{channelName}',
      description: 'Alles hier ist frei editierbar.',
      color: '#15121f',
      fields: [{ name: 'Status', value: '{accessState} · {memberCount}', inline: true }],
      footerText: '{server}',
      timestamp: false
    }
  });
  assert.equal(design.content, 'Eigener Text fuer {owner}');
  assert.equal(design.embed.description, 'Alles hier ist frei editierbar.');
  assert.deepEqual(design.embed.fields[0], { name: 'Status', value: '{accessState} · {memberCount}', inline: true });
  assert.equal('componentSet' in design, false);
  assert.equal('components' in design, false);
  assert.equal('reactionRoles' in design, false);
  assert.equal('ignoredTransportField' in design, false);
  assert.ok(!defaultTempVoiceInterfaceDesign().embed.description.includes('{tempVoiceBlock}'));

  const placeholderContext = {
    rich: {
      owner: '<@u1>',
      ownerName: 'Owner',
      channelName: 'Night Lounge',
      createdAt: '<t:1787572800:R>',
      userLimit: '6',
      region: 'Europa',
      accessState: 'Gesperrt',
      memberCount: '3',
      server: 'FALLEN HEAVEN'
    },
    plain: {
      owner: 'Owner',
      ownerName: 'Owner',
      channelName: 'Night Lounge',
      createdAt: '24.08.2026, 12:00',
      userLimit: '6',
      region: 'Europa',
      accessState: 'Gesperrt',
      memberCount: '3',
      server: 'FALLEN HEAVEN'
    }
  };
  const source = '{owner}|{ownerName}|{channelName}|{createdAt}|{userLimit}|{region}|{accessState}|{memberCount}|{server}';
  assert.equal(
    formatTempVoiceInterfaceText(source, placeholderContext, 2000, 'rich'),
    '<@u1>|Owner|Night Lounge|<t:1787572800:R>|6|Europa|Gesperrt|3|FALLEN HEAVEN'
  );
  assert.equal(formatTempVoiceInterfaceText('{owner} · {createdAt}', placeholderContext, 256, 'plain'), 'Owner · 24.08.2026, 12:00');
  assert.equal(formatTempVoiceInterfaceText('{unknown}', placeholderContext, 256, 'rich'), '{unknown}');

  const conf = {
    enabled: true,
    rememberUserProfiles: true,
    allowRename: true,
    allowLimit: true,
    allowLock: true,
    allowRegion: true,
    allowTransfer: true,
    interfaceDesign: design
  };
  const entry = {
    guildId: 'g1',
    ownerId: 'u1',
    ownerName: 'Owner',
    createdAt: '2026-08-24T10:00:00.000Z'
  };
  const everyoneOverwrite = { deny: { has: () => true } };
  const channel = {
    id: 'c1',
    name: 'Night Lounge',
    userLimit: 6,
    rtcRegion: 'europe',
    members: { size: 3 },
    guild: {
      id: 'g1',
      name: 'FALLEN HEAVEN',
      members: { cache: new Map([['u1', { displayName: 'Owner', user: { username: 'Owner' } }]]) }
    },
    permissionOverwrites: { cache: new Map([['g1', everyoneOverwrite]]) }
  };
  const payload = await buildTempVoiceInterfacePayload(channel, entry, conf);
  assert.equal(payload.content, 'Eigener Text fuer <@u1>');
  assert.equal(payload.embeds[0].data.title, 'Night Lounge');
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['u1'] });
  assert.deepEqual(
    payload.components.flatMap((row) => row.components.map((component) => component.data.custom_id)),
    interfaceRows(conf, entry).flatMap((row) => row.components.map((component) => component.data.custom_id))
  );

  const localAttachment = await saveLocalImage({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    name: 'tempvoice.png'
  });
  const imageConf = {
    ...conf,
    interfaceDesign: normalizeTempVoiceInterfaceDesign({
      ...design,
      outsideImageAttachment: localAttachment
    })
  };
  const firstImagePayload = await buildTempVoiceInterfacePayload(channel, entry, imageConf);
  const secondImagePayload = await buildTempVoiceInterfacePayload(channel, entry, imageConf);
  assert.equal(firstImagePayload.files?.length, 1, 'lokales Bild wird fuer die erste Nachricht hochgeladen');
  assert.equal(secondImagePayload.files?.length, 1, 'lokales Bild wird fuer jede weitere Nachricht erneut hochgeladen');
  assert.deepEqual(firstImagePayload.attachments, []);
  assert.deepEqual(secondImagePayload.attachments, []);

  const saved = await saveTempVoiceInterfaceDesign({
    guild: channel.guild,
    conf,
    template: { ...design, embeds: [design.embed] }
  });
  assert.equal(saved.design.embed.description, 'Alles hier ist frei editierbar.');
  await assert.rejects(
    saveTempVoiceInterfaceDesign({ guild: channel.guild, conf, template: { embeds: [design.embed, design.embed] } }),
    /genau ein Embed/i
  );

  const attempts = [];
  const channels = new Map();
  for (const id of ['refresh-1', 'refresh-2', 'refresh-3']) {
    const tracked = { ...entry, guildId: 'g1', interfaceChannelId: id, interfaceMessageId: `m-${id}` };
    await setChannelEntry(id, tracked);
    const shouldFail = id === 'refresh-2';
    const message = {
      edit: async (nextPayload) => {
        attempts.push({ id, nextPayload });
        if (shouldFail) throw new Error('Discord edit failed');
      }
    };
    channels.set(id, {
      ...channel,
      id,
      isTextBased: () => true,
      messages: { cache: new Map([[`m-${id}`, message]]) }
    });
  }
  const refreshGuild = { ...channel.guild, channels: { cache: channels } };
  for (const voice of channels.values()) voice.guild = refreshGuild;
  const refreshed = await refreshTempVoiceInterfaces(refreshGuild, conf);
  assert.equal(attempts.length, 3);
  assert.equal(refreshed.updated, 2);
  assert.equal(refreshed.failed, 1);
  assert.equal(refreshed.errors.length, 1);
  assert.deepEqual(attempts[0].nextPayload.attachments, [], 'ein entferntes Außenbild wird beim Edit wirklich geloescht');

  // Bereits durch den historischen Creation/Voice-Refresh-Race entstandene
  // Doppelpanels werden beim ersten Refresh sicher auf die gespeicherte
  // kanonische Nachricht reduziert.
  let duplicateDeletes = 0;
  const botId = 'tempvoice-bot';
  const componentRows = [{ components: [{ customId: 'fh_tv:rename' }] }];
  const canonical = {
    id: 'canonical-interface', author: { id: botId }, components: componentRows,
    edit: async () => {}
  };
  const duplicate = {
    id: 'duplicate-interface', author: { id: botId }, components: componentRows,
    delete: async () => { duplicateDeletes += 1; }
  };
  const unrelated = {
    id: 'unrelated-message', author: { id: botId }, components: [],
    delete: async () => { throw new Error('Normale Nachricht darf nicht geloescht werden'); }
  };
  const dedupeMessages = new Map([[canonical.id, canonical], [duplicate.id, duplicate], [unrelated.id, unrelated]]);
  const dedupeChannel = {
    ...channel,
    id: 'dedupe-channel',
    guild: null,
    isTextBased: () => true,
    messages: {
      cache: new Map([[canonical.id, canonical]]),
      fetch: async (query) => typeof query === 'object' ? dedupeMessages : dedupeMessages.get(String(query))
    }
  };
  const dedupeGuild = {
    id: 'dedupe-guild', name: 'Dedupe Guild',
    members: { me: { id: botId } },
    channels: { cache: new Map([[dedupeChannel.id, dedupeChannel]]) }
  };
  dedupeChannel.guild = dedupeGuild;
  await setChannelEntry(dedupeChannel.id, {
    ...entry,
    guildId: dedupeGuild.id,
    interfaceChannelId: dedupeChannel.id,
    interfaceMessageId: canonical.id
  });
  const deduped = await refreshTempVoiceInterfaces(dedupeGuild, conf);
  assert.equal(deduped.updated, 1);
  assert.equal(duplicateDeletes, 1, 'genau das verwaiste zweite TempVoice-Panel wird entfernt');

  const [rendererSource, indexSource, dashboardSource] = await Promise.all([
    fs.readFile(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/dashboard.js', import.meta.url), 'utf8')
  ]);
  assert.match(rendererSource, /tempVoiceInterface/);
  assert.match(rendererSource, /function tempVoiceStudioTemplate\s*\(/);
  assert.match(rendererSource, /function openTempVoiceStudio\s*\(/);
  assert.match(rendererSource, /function saveTempVoiceStudioTemplate\s*\(/);
  assert.match(rendererSource, /function confirmLeaveTempVoiceStudio\s*\(/);
  assert.match(rendererSource, /function hasUnsavedTempVoiceStudioChanges\s*\(/);
  assert.match(rendererSource, /clear-content[\s\S]{0,5000}tempVoiceInterface|tempVoiceInterface[\s\S]{0,5000}clear-content/);
  assert.match(indexSource, /saveTempVoiceInterfaceDesign[\s\S]{0,3000}persistEmbedDesign/);
  assert.match(dashboardSource, /app\.put\('\/api\/guild\/:guildId\/temp-voice\/design'/);
  assert.doesNotMatch(`${rendererSource}\n${indexSource}\n${dashboardSource}`, /\{tempVoiceBlock\}/);

  console.log('TempVoice embed studio smoke passed.');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
