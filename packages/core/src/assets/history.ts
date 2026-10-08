/** The activity log (every change, who and when). */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey } from './keys';
import type { HistoryEvent } from './types';

export function useActivity(filters: Query) {
  return useQuery({ queryKey: assetsKey('history', 'all', filters), queryFn: () => assetsApi.get<Page<HistoryEvent>>('/history', filters) });
}
