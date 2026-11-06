/**
 * 云端转写：`POST /api/v1/ai/transcribe`（spec §6.2）。
 *
 * <p>这一段**只做一件事**：把本地录音交给接口。大小上限、未配置时的错误语义、
 * 「音频不落盘」都在服务端（`AgentTranscribeService`）。客户端不重复判断，
 * 否则两边规则会漂移。
 *
 * <p>特意只依赖 `transcribeAudio` 一个方法：单测里可以塞假实现，
 * 不必把整个 ApiClient 造出来。
 */

import type { Endpoints } from '../../../api/endpoints';

export interface CloudAsrResult {
  text: string;
  language?: string | null;
}

export function transcribeInCloud(
  api: Pick<Endpoints, 'transcribeAudio'>,
  uri: string,
): Promise<CloudAsrResult> {
  return api.transcribeAudio(uri);
}
