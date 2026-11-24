import { describe, expect, it, vi } from 'vitest';

import { createAttachmentDownloader } from './attachment-downloader';
import { formatInstantViewPhotoUrl } from '../../telegram/instant-view-url';

describe('createAttachmentDownloader', () => {
  it('downloads QQ ob: attachment IDs through the current platform adapter', async () => {
    const downloadFile = vi.fn(async () => Buffer.from('qq image'));
    const download = createAttachmentDownloader({
      chatId: '1101575664',
      loadMessageAttachments: () => undefined,
      downloadFile: async () => { throw new Error('unused'); },
      platformAdapter: {
        kind: 'onebot',
        sendMessage: vi.fn(),
        downloadFile,
        downloadImage: vi.fn(),
      },
    });
    const fileRef = '8C8F1E77BE9C75B0DAFFF189A09345B6.jpg';

    await expect(download(`ob:${Buffer.from(fileRef).toString('base64')}`))
      .resolves.toEqual(Buffer.from('qq image'));
    expect(downloadFile).toHaveBeenCalledWith(fileRef, '1101575664');
  });

  it('routes Instant View photo URLs to the Telegram photo downloader', async () => {
    const downloadInstantViewPhoto = vi.fn(async () => Buffer.from('photo'));
    const download = createAttachmentDownloader({
      chatId: 'chat-1',
      loadMessageAttachments: () => undefined,
      downloadFile: async () => { throw new Error('unused'); },
      downloadInstantViewPhoto,
    });
    const fileId = formatInstantViewPhotoUrl({ pageUrl: 'https://example.com/article', photoId: '42' });

    await expect(download(fileId)).resolves.toEqual(Buffer.from('photo'));
    expect(downloadInstantViewPhoto).toHaveBeenCalledWith({
      pageUrl: 'https://example.com/article',
      photoId: '42',
    });
  });
});
