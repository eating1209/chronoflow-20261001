import { describe, expect, it, vi } from 'vitest';

import type { Endpoints } from '../src/api/endpoints';
import { recognizeScheduleImage } from '../src/modules/vision/pipeline';
import { registerOcrEngine } from '../src/modules/vision/ocr/onDevice';

function fakeApi(items: Array<{ title?: string; kind?: 'EVENT' | 'TASK' }>): Endpoints {
  return {
    parseScheduleText: vi.fn(async () => ({ items })),
  } as unknown as Endpoints;
}

describe('截图 / 选图共用的识别链路', () => {
  it('OCR 出文字、服务端解析出草稿：返回可进确认页的草稿', async () => {
    registerOcrEngine({
      name: () => '测试 OCR',
      recognizeText: async () => '明天下午三点开会',
    });
    const api = fakeApi([{ title: '开会', kind: 'EVENT' }]);

    const result = await recognizeScheduleImage({
      uri: 'file:///tmp/share.png',
      api,
      today: '2026-11-18',
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.drafts.map((draft) => draft.title)).toEqual(['开会']);
      expect(result.drafts[0].kind).toBe('EVENT');
    }
    expect(api.parseScheduleText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '明天下午三点开会', today: '2026-11-18' }),
    );
  });

  it('截图没有文字：不调用服务端解析', async () => {
    registerOcrEngine({
      name: () => '测试 OCR',
      recognizeText: async () => '   ',
    });
    const api = fakeApi([{ title: '开会' }]);

    const result = await recognizeScheduleImage({
      uri: 'file:///tmp/blank.png',
      api,
      today: '2026-11-18',
    });

    expect(result.status).toBe('no-text');
    expect(api.parseScheduleText).not.toHaveBeenCalled();
  });

  it('有文字但没有可执行事项：返回 no-drafts，不打开空确认页', async () => {
    registerOcrEngine({
      name: () => '测试 OCR',
      recognizeText: async () => '今天天气不错',
    });
    const api = fakeApi([]);

    const result = await recognizeScheduleImage({
      uri: 'file:///tmp/chat.png',
      api,
      today: '2026-11-18',
    });

    expect(result.status).toBe('no-drafts');
  });
});
