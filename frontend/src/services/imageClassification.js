const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function classifyImageWithBackend(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('persist', 'true');
  formData.append('file_path', file.webkitRelativePath || file.name);
  formData.append('file_modified_at', new Date(file.lastModified).toISOString().slice(0, 19).replace('T', ' '));

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

export async function listImages(filters = {}) {
  const params = new URLSearchParams({ page: String(filters.page || 1), limit: String(filters.limit || 100) });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && !['page', 'limit'].includes(key)) params.set(key, value);
  });
  const response = await fetch(`${apiUrl}/api/images?${params}`);
  if (!response.ok) throw new Error(`Image library failed with status ${response.status}`);
  return response.json();
}

export async function getImageStats() {
  const response = await fetch(`${apiUrl}/api/images/stats`);
  if (!response.ok) throw new Error(`Image statistics failed with status ${response.status}`);
  return response.json();
}

export async function listReviewImages() {
  const response = await fetch(`${apiUrl}/api/review?limit=100`);
  if (!response.ok) throw new Error(`Review queue failed with status ${response.status}`);
  return response.json();
}

export async function resolveReview(id, decision) {
  const response = await fetch(`${apiUrl}/api/images/${id}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision) });
  if (!response.ok) throw new Error(`Review update failed with status ${response.status}`);
  return response.json();
}

export async function listDuplicates() {
  const response = await fetch(`${apiUrl}/api/duplicates`);
  if (!response.ok) throw new Error(`Duplicate lookup failed with status ${response.status}`);
  return response.json();
}

export async function updateImageMetadata(id, changes) {
  const response = await fetch(`${apiUrl}/api/images/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw new Error(`Image update failed with status ${response.status}`);
  return response.json();
}

export async function deleteImage(id, confirm = false) {
  const response = await fetch(`${apiUrl}/api/images/${id}?confirm=${String(confirm)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Image deletion failed with status ${response.status}`);
  return response.json();
}

export function imageContentUrl(id) {
  return `${apiUrl}/api/images/${id}/content`;
}
