import { beforeEach, describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useAdminDataWithCache from '@/hooks/useAdminDataWithCache';
import { setCache } from '@/lib/adminCache';
import { mockFetch } from '../helpers/fetch-mock';

beforeEach(() => {
  localStorage.clear();
});

describe('useAdminDataWithCache', () => {
  test('fetches, returns and caches data', async () => {
    const fetchMock = mockFetch({ '/api/admin/users': () => ({ body: { users: [1] } }) });
    const { result } = renderHook(() => useAdminDataWithCache('users', '/api/admin/users?page=1'));
    await waitFor(() => expect(result.current.data).toEqual({ users: [1] }));
    expect(result.current).toMatchObject({ loading: false, error: null, isCached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('admin-cache-users')!).data).toEqual({ users: [1] });
  });

  test('serves valid cached data without a request', async () => {
    setCache('users', { users: ['cached'] });
    const fetchMock = mockFetch({});
    const { result } = renderHook(() => useAdminDataWithCache('users', '/api/admin/users'));
    await waitFor(() => expect(result.current.isCached).toBe(true));
    expect(result.current.data).toEqual({ users: ['cached'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('skipCache and refetch always go to the server', async () => {
    setCache('users', { users: ['cached'] });
    let n = 0;
    mockFetch({ '/api/admin/users': () => { n += 1; return { body: { n } }; } });
    const { result } = renderHook(() => useAdminDataWithCache('users', '/api/admin/users', { skipCache: true }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    await act(() => result.current.refetch());
    expect(result.current.data).toEqual({ n: 2 });
  });

  test('reports HTTP errors', async () => {
    mockFetch({ '/api/admin/users': () => ({ status: 403, body: { error: 'Forbidden' } }) });
    const { result } = renderHook(() => useAdminDataWithCache('users', '/api/admin/users'));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error!.message).toMatch(/^Failed to fetch data/);
    expect(result.current.data).toBeNull();
  });

  test('wraps non-Error rejections', async () => {
    // A non-Error rejection, as some libraries throw strings
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    mockFetch({ '/api/admin/users': () => { throw 'boom'; } });
    const { result } = renderHook(() => useAdminDataWithCache('users', '/api/admin/users'));
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
  });
});
