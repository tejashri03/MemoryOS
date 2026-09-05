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
