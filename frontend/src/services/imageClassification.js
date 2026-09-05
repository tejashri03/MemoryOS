const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function classifyImageWithBackend(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('persist', 'true');

  const response = await fetch(`${apiUrl}/api/images/classify`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Image classification failed with status ${response.status}`);
  }

  return response.json();
}

export async function searchImages(query, filters = {}) {
  const params = new URLSearchParams({ q: query, page: String(filters.page || 1), limit: String(filters.limit || 30), sort: filters.sort || 'relevance' });
  Object.entries(filters).forEach(([key, value]) => {
    if (value && !['page', 'limit', 'sort'].includes(key)) params.set(key, value);
  });
  const response = await fetch(`${apiUrl}/api/search?${params}`);
  if (!response.ok) throw new Error(`Image search failed with status ${response.status}`);
  return response.json();
}

export function imageContentUrl(id) {
  return `${apiUrl}/api/images/${id}/content`;
}
