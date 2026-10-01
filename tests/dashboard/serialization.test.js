import { describe, it, expect } from 'vitest';
import {
  messageUrl,
  serializeDashboardEmbed,
  serializeDashboardAttachment,
  serializeDashboardSticker,
  serializeDashboardComponent,
  serializeDashboardComponents,
  serializeOutsideImageAttachment
} from '../../src/dashboard/serialization.js';

describe('messageUrl', () => {
  it('builds a Discord message URL', () => {
    expect(messageUrl('g1', 'c1', 'm1')).toBe('https://discord.com/channels/g1/c1/m1');
  });
});

describe('serializeDashboardEmbed', () => {
  it('serializes a full embed', () => {
    const embed = {
      title: 'Test',
      description: 'Desc',
      url: 'https://example.com',
      type: 'rich',
      hexColor: '#ff0000',
      image: { url: 'https://img.png' },
      thumbnail: { url: 'https://thumb.png' },
      author: { name: 'Author', iconURL: 'https://icon.png' },
      footer: { text: 'Footer', iconURL: 'https://footer.png' },
      timestamp: { toISOString: () => '2026-01-01T00:00:00.000Z' },
      fields: [{ name: 'F1', value: 'V1', inline: true }]
    };
    const result = serializeDashboardEmbed(embed);
    expect(result.title).toBe('Test');
    expect(result.description).toBe('Desc');
    expect(result.color).toBe('#ff0000');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe('F1');
  });

  it('handles missing fields gracefully', () => {
    const result = serializeDashboardEmbed({});
    expect(result.title).toBe('');
    expect(result.fields).toEqual([]);
    expect(result.timestamp).toBeNull();
  });
});

describe('serializeDashboardAttachment', () => {
  it('serializes an attachment', () => {
    const att = { id: '123', name: 'file.png', url: 'https://file.png', contentType: 'image/png', size: 1024 };
    const result = serializeDashboardAttachment(att);
    expect(result.id).toBe('123');
    expect(result.name).toBe('file.png');
    expect(result.size).toBe(1024);
  });

  it('defaults name to Datei', () => {
    const result = serializeDashboardAttachment({ id: '1', url: 'https://x' });
    expect(result.name).toBe('Datei');
  });
});

describe('serializeDashboardSticker', () => {
  it('serializes a sticker', () => {
    const sticker = { id: '456', name: 'Test Sticker', format: 1 };
    const result = serializeDashboardSticker(sticker);
    expect(result.id).toBe('456');
    expect(result.url).toContain('456');
  });
});

describe('serializeDashboardComponent', () => {
  it('serializes a button component', () => {
    const component = {
      type: 2,
      custom_id: 'btn-1',
      label: 'Click',
      style: 1,
      disabled: false
    };
    const result = serializeDashboardComponent(component);
    expect(result.type).toBe(2);
    expect(result.customId).toBe('btn-1');
    expect(result.label).toBe('Click');
  });

  it('serializes a select menu with options', () => {
    const component = {
      type: 3,
      custom_id: 'select-1',
      options: [
        { label: 'Opt1', value: 'v1', description: 'Desc1' },
        { label: 'Opt2', value: 'v2', description: 'Desc2' }
      ],
      placeholder: 'Choose...'
    };
    const result = serializeDashboardComponent(component);
    expect(result.options).toHaveLength(2);
    expect(result.placeholder).toBe('Choose...');
  });

  it('returns null for invalid input', () => {
    expect(serializeDashboardComponent(null)).toBeNull();
    expect(serializeDashboardComponent('bad')).toBeNull();
  });
});

describe('serializeDashboardComponents', () => {
  it('serializes action rows', () => {
    const message = {
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: 'btn', label: 'OK', style: 1 }
          ]
        }
      ]
    };
    const result = serializeDashboardComponents(message);
    expect(result).toHaveLength(1);
    expect(result[0].components).toHaveLength(1);
  });

  it('returns empty array for no components', () => {
    expect(serializeDashboardComponents({})).toEqual([]);
    expect(serializeDashboardComponents(null)).toEqual([]);
  });
});

describe('serializeOutsideImageAttachment', () => {
  it('finds the first image attachment', () => {
    const message = {
      attachments: [
        { id: '1', name: 'photo.png', url: 'https://img1.png', contentType: 'image/png', size: 100 },
        { id: '2', name: 'photo.jpg', url: 'https://img2.jpg', contentType: 'image/jpeg', size: 200 }
      ]
    };
    const result = serializeOutsideImageAttachment(message);
    expect(result.id).toBe('1');
    expect(result.url).toBe('https://img1.png');
  });

  it('returns null for no attachments', () => {
    expect(serializeOutsideImageAttachment({ attachments: [] })).toBeNull();
    expect(serializeOutsideImageAttachment({})).toBeNull();
  });

  it('skips fh-asset files when other images exist', () => {
    const message = {
      attachments: [
        { id: '1', name: 'fh-asset-123.png', url: 'https://asset.png', contentType: 'image/png', size: 100 },
        { id: '2', name: 'real.png', url: 'https://real.png', contentType: 'image/png', size: 200 }
      ]
    };
    const result = serializeOutsideImageAttachment(message);
    expect(result.id).toBe('2');
  });
});
