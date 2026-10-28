export function orderedItems(items, identifiers = []) {
  const positions = new Map(identifiers.map((identifier, index) => [identifier, index]));
  return [...items].sort((left, right) => (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id - right.id);
}

export function createRecommendationRequest({fetchImpl = globalThis.fetch} = {}) {
  let generation = 0, controller;
  const invalidate = () => { generation++; controller?.abort(); };
  return {
    invalidate,
    async load({catalogVersion, contentId} = {}) {
      invalidate();
      const current = generation;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 6000);
      const query = new URLSearchParams({mode: contentId ? 'similar' : 'home'});
      if (contentId) query.set('contentId', String(contentId));
      try {
        const response = await fetchImpl(`/api/recommendations?${query}`, {credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'}, signal:requestController.signal});
        if (!response.ok) throw new Error('recommendations_unavailable');
        const data = await response.json();
        if (current !== generation) return null;
        if (data.catalogVersion !== catalogVersion) throw new Error('recommendations_version_mismatch');
        for (const key of contentId ? ['similarIds'] : ['heroIds','discoveryIds','sidebarIds','rankingIds']) {
          if (!Array.isArray(data[key]) || data[key].length > 100000 || data[key].some(identifier => !Number.isSafeInteger(identifier) || identifier <= 0)) throw new Error('recommendations_invalid');
        }
        return data;
      } catch (error) {
        if (current !== generation) return null;
        throw error;
      } finally { clearTimeout(timeout); }
    }
  };
}
