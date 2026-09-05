import { useEffect, useMemo, useRef, useState } from 'react';

const stats = [
  { label: 'Total images', value: '24,816', note: 'All indexed files' },
  { label: 'Personal photos', value: '18,204', note: 'Family, travel, events' },
  { label: 'Screenshots / documents', value: '4,928', note: 'Receipts, notes, captures' },
  { label: 'Duplicate candidates', value: '64', note: 'Temporary mock matches' },
];

const quickSearches = [
  'Find my certificate',
  'Show photos from my trip',
  'Find screenshots containing Python',
];

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const supportedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export default function DashboardPage({ activeSection }) {
  const [selectedFolderName, setSelectedFolderName] = useState('No folder selected');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Select a folder to load local images.');
  const [images, setImages] = useState([]);
  const [hasPickedFolder, setHasPickedFolder] = useState(false);
  const folderInputRef = useRef(null);

  const previewCount = images.length;

  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, [images]);

  const loadImagesFromFiles = async (files, folderLabel) => {
    const localImageFiles = Array.from(files).filter((file) => isSupportedImage(file));

    setHasPickedFolder(true);
    setSelectedFolderName(folderLabel);
    setLoading(true);
    setStatusMessage('Scanning folder and preparing previews...');

    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));

    await new Promise((resolve) => setTimeout(resolve, 150));

    const nextImages = localImageFiles.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      filename: file.name,
      fileSize: formatFileSize(file.size),
      imageType: getImageTypeLabel(file),
      modifiedDate: formatDate(file.lastModified),
      previewUrl: URL.createObjectURL(file),
    }));

    setImages(nextImages);
    setLoading(false);

    if (nextImages.length === 0) {
      setStatusMessage('No supported images were found in the selected folder.');
      return;
    }

    setStatusMessage(`Loaded ${nextImages.length} image${nextImages.length === 1 ? '' : 's'} from ${folderLabel}.`);
  };

  const scanFolder = async () => {
    if (window.showDirectoryPicker) {
      try {
        const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
        const files = [];

        for await (const [, handle] of directoryHandle.entries()) {
          if (handle.kind !== 'file') {
            continue;
          }

          const file = await handle.getFile();
          files.push(file);
        }

        await loadImagesFromFiles(files, directoryHandle.name || 'Selected folder');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          setStatusMessage('Folder selection canceled.');
        }

        return;
      }
    }

    folderInputRef.current?.click();
  };

  const handleFolderInputChange = async (event) => {
    const files = event.target.files;

    if (!files || files.length === 0) {
      setStatusMessage('Folder selection canceled.');
      return;
    }

    const folderLabel = files[0].webkitRelativePath.split('/')[0] || 'Selected folder';
    await loadImagesFromFiles(files, folderLabel);
  };

  const placeholderState = useMemo(() => {
    if (!hasPickedFolder) {
      return {
        title: 'No folder selected yet',
        message: 'Choose a local folder to populate the dashboard with your own images.',
      };
    }

    if (!loading && previewCount === 0) {
      return {
        title: 'No supported images found',
        message: 'The selected folder does not contain JPG, PNG, WEBP, or GIF files.',
      };
    }

    return null;
  }, [hasPickedFolder, loading, previewCount]);

  return (
    <div className="dashboard-page">
      {activeSection === 'Dashboard' ? (
        <>
          <section className="hero card-light dashboard-hero">
            <div className="hero-copy">
              <p className="hero-label">Library overview</p>
              <h3>A clear first look at your photo archive.</h3>
              <p className="hero-text">
                This dashboard gives a temporary mock overview of your image library, recent
                additions, and a quick search entry point for the main workflows.
              </p>
            </div>

            <div className="hero-metrics dashboard-metrics">
              <div className="metric card-dark">
                <span>Reviewed today</span>
                <strong>38</strong>
              </div>
              <div className="metric card-dark">
                <span>Albums touched</span>
                <strong>12</strong>
              </div>
              <div className="metric card-dark">
                <span>Loaded previews</span>
                <strong>{previewCount}</strong>
              </div>
            </div>
          </section>

          <section className="stats-grid" aria-label="Image library statistics">
            {stats.map((stat) => (
              <article key={stat.label} className="stat-card card-light">
                <p>{stat.label}</p>
                <strong>{stat.value}</strong>
                <span>{stat.note}</span>
              </article>
            ))}
          </section>

          <section className="dashboard-grid">
            <article className="content-panel card-light recent-images-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Recently added images</p>
                  <h3>Local images from the selected folder</h3>
                </div>
                <button type="button" className="link-button" onClick={scanFolder}>
                  Select Folder / Scan Folder
                </button>
              </div>

              <input
                ref={folderInputRef}
                className="hidden-folder-input"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                directory=""
                webkitdirectory=""
                multiple
                onChange={handleFolderInputChange}
              />

              <p className="scan-status">
                {loading ? 'Scanning folder...' : statusMessage}{' '}
                {hasPickedFolder ? `Folder: ${selectedFolderName}` : ''}
              </p>

              {placeholderState ? (
                <div className="empty-state">
                  <strong>{placeholderState.title}</strong>
                  <p>{placeholderState.message}</p>
                </div>
              ) : (
                <div className="recent-grid">
                  {images.map((image) => (
                    <article key={image.id} className="recent-card">
                      <div className="thumbnail thumbnail-live" aria-hidden="true">
                        <img src={image.previewUrl} alt="" />
                      </div>
                      <div className="recent-meta">
                        <strong>{image.filename}</strong>
                        <p>{image.fileSize}</p>
                        <span>{image.imageType}</span>
                        <span>{image.modifiedDate}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="content-panel card-dark quick-search-panel">
              <p className="section-kicker">Quick search</p>
              <h3>Jump directly into a search prompt</h3>
              <p>
                Search is only a placeholder for now, but the dashboard already provides a clear
                entry point for future natural-language and filter-based search.
              </p>

              <div className="quick-search-form" role="group" aria-label="Quick search placeholder">
                <input type="text" placeholder="Search your library" aria-label="Search your library" />
                <button type="button">Search</button>
              </div>

              <div className="quick-search-examples">
                {quickSearches.map((search) => (
                  <button key={search} type="button" className="example-chip">
                    {search}
                  </button>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : (
        <section className="placeholder-panel card-light">
          <p className="section-kicker">{activeSection}</p>
          <h3>Dashboard shell is ready.</h3>
          <p>
            This section will be filled in later. The current build keeps the layout and sidebar
            intact while the Dashboard shows the new overview content.
          </p>
        </section>
      )}
    </div>
  );
}

function isSupportedImage(file) {
  if (supportedImageTypes.has(file.type)) {
    return true;
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? supportedImageExtensions.has(extension) : false;
}

function getImageTypeLabel(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension) {
    return extension === 'jpg' ? 'JPEG' : extension.toUpperCase();
  }

  if (file.type) {
    return file.type.replace('image/', '').toUpperCase();
  }

  return 'IMAGE';
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}