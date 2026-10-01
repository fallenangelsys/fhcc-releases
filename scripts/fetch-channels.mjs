#!/usr/bin/env node
/**
 * Holt die echte Channel-Struktur vom laufenden Bot über die Health-API.
 */
import http from 'node:http';

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

try {
  // Versuche den Bot über die Health-API zu erreichen
  const health = await fetch('http://127.0.0.1:3000/api/health');
  console.log('Bot Status:', health.ok ? 'Online' : 'Offline');
  console.log('Guild:', health.guildName);
  console.log('Guild ID:', health.guildId);
  
  // Versuche die Channel-Liste über die Server-Verwaltung API zu holen
  const channels = await fetch('http://127.0.0.1:3000/api/channels');
  if (channels && Array.isArray(channels)) {
    // Kategorien filtern und sortieren
    const categories = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
    
    for (const cat of categories) {
      const children = channels
        .filter(c => c.parent_id === cat.id)
        .sort((a, b) => a.position - b.position);
      
      console.log(`\n${cat.name}`);
      for (const ch of children) {
        console.log(`<#${ch.id}> ${ch.name}`);
      }
    }
  }
} catch (error) {
  console.error('Fehler:', error.message);
  console.error('Bot läuft möglicherweise nicht auf Port 3000');
}
