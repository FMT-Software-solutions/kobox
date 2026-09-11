import { useQuery } from '@tanstack/react-query';

import {
  fetchArrears,
  fetchCashByMethod,
  fetchCashByPlan,
  fetchCashReport,
  fetchCollections,
  fetchPlanMemberReport,
  type DateRange,
} from './api';

export const reportKeys = {
  all: ['reports'] as const,
  cash: (groupId: string, range: DateRange) =>
    [...reportKeys.all, 'cash', groupId, range.from, range.to] as const,
  byPlan: (groupId: string, range: DateRange) =>
    [...reportKeys.all, 'by-plan', groupId, range.from, range.to] as const,
  byMethod: (groupId: string, range: DateRange) =>
    [...reportKeys.all, 'by-method', groupId, range.from, range.to] as const,
  arrears: (groupId: string, range?: DateRange) =>
    [...reportKeys.all, 'arrears', groupId, range?.from ?? 'all', range?.to ?? 'all'] as const,
  collections: (groupId: string, range: DateRange) =>
    [...reportKeys.all, 'collections', groupId, range.from, range.to] as const,
};

export function useCashReport(groupId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: reportKeys.cash(groupId ?? '', range),
    queryFn: () => fetchCashReport(groupId!, range),
    enabled: Boolean(groupId),
  });
}

export function useCashByPlan(groupId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: reportKeys.byPlan(groupId ?? '', range),
    queryFn: () => fetchCashByPlan(groupId!, range),
    enabled: Boolean(groupId),
  });
}

export function useCashByMethod(groupId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: reportKeys.byMethod(groupId ?? '', range),
    queryFn: () => fetchCashByMethod(groupId!, range),
    enabled: Boolean(groupId),
  });
}

export function useArrears(groupId: string | undefined, range?: DateRange) {
  return useQuery({
    queryKey: reportKeys.arrears(groupId ?? '', range),
    queryFn: () => fetchArrears(groupId!, range),
    enabled: Boolean(groupId),
  });
}

export function useCollections(groupId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: reportKeys.collections(groupId ?? '', range),
    queryFn: () => fetchCollections(groupId!, range),
    enabled: Boolean(groupId),
  });
}

export function usePlanMemberReport(planId: string | undefined) {
  return useQuery({
    queryKey: [...reportKeys.all, 'plan-members', planId ?? ''] as const,
    queryFn: () => fetchPlanMemberReport(planId!),
    enabled: Boolean(planId),
  });
}
