(function () {
  'use strict';

  function create({ state, apiRequest, nativeEmojis, render, selectedGuildId }) {
    let requestId = 0;

    async function load(guildId) {
      if (!guildId || !state.authenticated) return;
      const targetGuildId = String(guildId);
      const currentRequestId = ++requestId;
      if (state.messageEmojiGuildId !== targetGuildId) {
        state.messageEmojis = [];
        state.messageEmojiFetchedAt = 0;
      }
      state.messageEmojiLoading = true;
      render();
      let response;
      try {
        response = await apiRequest({ path: '/api/guild/' + encodeURIComponent(targetGuildId) + '/message-emojis' });
      } catch (error) {
        if (currentRequestId === requestId) {
          state.messageEmojiLoading = false;
          render();
        }
        throw error;
      }
      if (currentRequestId !== requestId || targetGuildId !== String(selectedGuildId() || '')) return;
      state.messageEmojiLoading = false;
      const remoteEmojis = response.ok && Array.isArray(response.data?.emojis) ? response.data.emojis : [];
      state.messageEmojis = nativeEmojis.concat(remoteEmojis);
      state.messageEmojiGuildId = response.ok ? targetGuildId : '';
      if (response.ok) state.messageEmojiFetchedAt = Date.now();
      render();
    }

    return { load };
  }

  window.FHCCMessageEmojiLoader = { create };
})();
