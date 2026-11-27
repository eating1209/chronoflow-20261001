import { useEffect, useState } from 'react';
import type { SearchResultItem } from '../shared/api/types';
import { userFacingError } from '../shared/errors';

/** 检索防抖：每敲一个字就发一次请求既费流量，也会让结果闪。 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 关键词检索（带防抖 + 请求取消）。
 *
 * <p>从 `AgendaScreen` 抽出来的：这段有 4 个状态（results / searching / error / 清理）
 * 和一个 setTimeout，混在 1000 行的组件里很难看清。单独成 hook 后，
 * 「空关键词不打请求」「过期响应不覆盖新结果」这两条约束都有了唯一归属。
 *
 * <p>关键处理：`cancelled` 标记必须在**每次关键词变化后重建**，
 * 否则慢请求返回时会覆盖掉新关键词的结果（用户会看到「搜 A 显示了 B 的结果」）。
 */
export function useDebouncedSearch(options: {
  keyword: string;
  search: (term: string) => Promise<SearchResultItem[]>;
}) {
  const { keyword, search } = options;

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = keyword.trim();
    // 空关键词直接清空，不发请求
    if (!trimmed) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await search(trimmed);
          if (!cancelled) {
            setResults(items);
            setError(null);
          }
        } catch (cause) {
          if (!cancelled) {
            setResults([]);
            setError(userFacingError(cause, '检索失败'));
          }
        } finally {
          if (!cancelled) {
            setSearching(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [keyword, search]);

  return { results, searching, error };
}
