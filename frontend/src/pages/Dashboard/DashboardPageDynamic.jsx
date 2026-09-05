import { useEffect, useMemo, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';
import { classifyImageWithBackend } from '../../services/imageClassification';

const quickSearches = [
  'Find my certificate',
  'Show photos from my trip',
  'Find screenshots containing Python',
];

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const supportedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export default function DashboardPageDynamic({ activeSection }) {
  const [selectedFolderName, setSelectedFolderName] = useState('No folder selected');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Select a folder to load local images.');
  const [scanProgress, setScanProgress] = useState(0);
  const [images, setImages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasPickedFolder, setHasPickedFolder] = useState(false);
  const folderInputRef = useRef(null);
  const imagesRef = useRef([]);
  const scanTokenRef = useRef(0);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      cleanupImagePreviews(imagesRef.current);
      scanTokenRef.current += 1;
    };
  }, []);

  const libraryStats = useMemo(() => {
    const totals = images.reduce(
      (accumulator, image) => {
        accumulator.total += 1;

        if (image.category === 'People & Family' || image.category === 'Events & Celebrations') {
          accumulator.personal += 1;
        }

        if (['Screenshots', 'Notes & Documents', 'Bills & Receipts'].includes(image.category)) {
          accumulator.documents += 1;
        }

        if (image.ocrText) {
          accumulator.ocrReady += 1;
        }

        return accumulator;
      },
      { total: 0, personal: 0, documents: 0, ocrReady: 0 },
    );

    return [
      {
        label: 'Total images',
        value: totals.total.toLocaleString(),
        note: hasPickedFolder ? `Loaded from ${selectedFolderName}` : 'Waiting for a folder',
      },
      {
        label: 'Personal photos',
        value: totals.personal.toLocaleString(),
        note: 'OCR + visual semantic analysis',
      },
      {
        label: 'Screenshots / documents',
        value: totals.documents.toLocaleString(),
        note: 'OCR + visual semantic analysis',
      },
      {
        label: 'Duplicate candidates',
        value: '0',
        note: 'pHash / duplicate detection not enabled yet',
      },
    ];
  }, [hasPickedFolder, images, selectedFolderName]);

  const previewCount = images.length;
  const filteredImages = useMemo(
    () => filterImages(images, searchQuery),
    [images, searchQuery],
  );

  const runSearch = (query = searchQuery) => {
    setSearchQuery(query.trim());
  };

  const loadImagesFromFiles = async (files, folderLabel) => {
    const scanToken = scanTokenRef.current + 1;
    scanTokenRef.current = scanToken;

    const localImageFiles = Array.from(files)
      .filter((file) => isSupportedImage(file))
      .sort((left, right) => right.lastModified - left.lastModified);

    setHasPickedFolder(true);
    setSelectedFolderName(folderLabel);
    setLoading(true);
    setScanProgress(0);
    setStatusMessage('Scanning folder and preparing previews...');

    cleanupImagePreviews(imagesRef.current);
    imagesRef.current = [];
    setImages([]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (localImageFiles.length === 0) {
      if (scanTokenRef.current !== scanToken) {
        return;
      }

      setLoading(false);
      setStatusMessage('No supported images were found in the selected folder.');
      return;
    }

    const createdUrls = [];
    const nextImages = [];

    for (let index = 0; index < localImageFiles.length; index += 1) {
      const file = localImageFiles[index];
      const previewUrl = URL.createObjectURL(file);
      createdUrls.push(previewUrl);

      if (scanTokenRef.current !== scanToken) {
        cleanupUrls(createdUrls);
        return;
      }

      setStatusMessage(`Classifying ${index + 1}/${localImageFiles.length}: ${file.name}`);
      let classification = null;
      let ocrText = '';
      try {
        classification = await classifyImageWithBackend(file);
        ocrText = classification.ocr_text || '';
      } catch (error) {
        try {
          const result = await recognize(file, 'eng', {
            logger: (message) => {
              if (scanTokenRef.current !== scanToken || message.status !== 'recognizing text') {
                return;
              }

              setScanProgress(
                Math.min(
                  99,
                  Math.round(((index + (message.progress || 0)) / localImageFiles.length) * 100),
                ),
              );
            },
          });

          ocrText = result.data.text.trim();
        } catch (ocrError) {
          ocrText = '';
        }
      }

      const category = classification?.category || classifyImage(file, ocrText);

      nextImages.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        filename: file.name,
        fileSize: formatFileSize(file.size),
        imageType: getImageTypeLabel(file),
        modifiedDate: formatDate(file.lastModified),
        category,
        ocrText,
        visualDescription: classification?.visual_description || '',
        previewUrl,
      });

      if (scanTokenRef.current !== scanToken) {
        cleanupUrls(createdUrls);
        return;
      }

      setImages([...nextImages]);
      setScanProgress(Math.round(((index + 1) / localImageFiles.length) * 100));
    }

    if (scanTokenRef.current !== scanToken) {
      cleanupUrls(createdUrls);
      return;
    }

    setLoading(false);

    if (nextImages.length === 0) {
      setStatusMessage('No supported images were found in the selected folder.');
      setScanProgress(0);
      return;
    }

    setStatusMessage(
      `Loaded ${nextImages.length} image${nextImages.length === 1 ? '' : 's'} from ${folderLabel}.`,
    );
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
      {activeSection === 'Dashboard' || activeSection === 'Search' ? (
        <>
          <section className="hero card-light dashboard-hero">
            <div className="hero-copy">
              <p className="hero-label">Library overview</p>
              <h3>A live look at your local photo archive.</h3>
              <p className="hero-text">
                MemoryOS scans the folder you select from your laptop, loads real image previews,
                and runs client-side OCR on supported files so the dashboard stays fully local.
              </p>
            </div>

            <div className="hero-metrics dashboard-metrics">
              <div className="metric card-dark">
                <span>Reviewed today</span>
                <strong>{previewCount}</strong>
              </div>
              <div className="metric card-dark">
                <span>OCR-ready files</span>
                <strong>{images.filter((image) => Boolean(image.ocrText)).length}</strong>
              </div>
              <div className="metric card-dark">
                <span>Loaded previews</span>
                <strong>{previewCount}</strong>
              </div>
            </div>
          </section>

          <section className="stats-grid" aria-label="Image library statistics">
            {libraryStats.map((stat) => (
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
                {loading ? `${statusMessage} ${scanProgress}%` : statusMessage}{' '}
                {hasPickedFolder ? `Folder: ${selectedFolderName}` : ''}
              </p>

              {placeholderState ? (
                <div className="empty-state">
                  <strong>{placeholderState.title}</strong>
                  <p>{placeholderState.message}</p>
                </div>
              ) : (
                <div className="recent-grid">
                  {filteredImages.map((image) => (
                    <article key={image.id} className="recent-card">
                      <div className="thumbnail thumbnail-live" aria-hidden="true">
                        <img src={image.previewUrl} alt="" />
                      </div>
                      <div className="recent-meta">
                        <strong>{image.filename}</strong>
                        <p>{image.fileSize}</p>
                        <span>{image.imageType}</span>
                        <span>{image.modifiedDate}</span>
                        <span>{image.category}</span>
                        {image.visualDescription ? <span>{image.visualDescription}</span> : null}
                        <p className="ocr-snippet">
                          {image.ocrText ? image.ocrText.slice(0, 120) : 'No OCR text detected yet.'}
                        </p>
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
                Search scans category, filename, OCR text, and visual description from the
                currently loaded folder.
              </p>

              <form
                className="quick-search-form"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  runSearch();
                }}
              >
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Try: certificates, family, travel"
                  aria-label="Search your library"
                />
                <button type="submit">Search</button>
                {searchQuery ? (
                  <button type="button" onClick={() => setSearchQuery('')}>
                    Clear
                  </button>
                ) : null}
              </form>

              <p className="scan-status">
                {searchQuery
                  ? `${filteredImages.length} of ${images.length} images match “${searchQuery}”.`
                  : `${images.length} scanned image${images.length === 1 ? '' : 's'} available to search.`}
              </p>

              <div className="search-help">
                Search examples: `family`, `personal photos`, `certificate`, `medical`, `bills`,
                `screenshots`, `travel`, or any filename/OCR text.
              </div>

              <div className="quick-search-examples">
                {quickSearches.map((search) => (
                  <button
                    key={search}
                    type="button"
                    className="example-chip"
                    onClick={() => runSearch(search)}
                  >
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
            intact while the Dashboard shows the live local scanning content.
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

function classifyImage(file, ocrText) {
  const source = `${file.name} ${ocrText}`.toLowerCase();

  const rules = [
    ['Government & Identity', /aadhaar|pan card|passport|driving licence|identity|id card/],
    ['Education', /certificate|degree|diploma|marksheet|transcript|university|college|assignment/],
    ['Medical & Health', /prescription|medical|hospital|doctor|medicine|patient|diagnosis/],
    ['Finance', /bank|tax|salary|statement|transaction|payment|loan/],
    ['Bills & Receipts', /receipt|invoice|bill|electricity|shopping|total amount|gst/],
    ['Work & Professional', /resume|cv|offer letter|employment|office|company|employee/],
    ['Travel', /flight|boarding pass|ticket|train|hotel|airport|trip|vacation/],
    ['Events & Celebrations', /birthday|wedding|party|festival|celebration|invitation/],
    ['Screenshots', /screenshot|screen capture|capture|mobile|application|website|chat|python/],
    ['Notes & Documents', /document|doc|scan|pdf|note|handwritten|whiteboard/],
  ];

  for (const [category, pattern] of rules) {
    if (pattern.test(source)) {
      return category;
    }
  }

  return 'Others';
}

const searchCategoryAliases = {
  personal: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  photo: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  photos: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  family: ['People & Family'],
  people: ['People & Family'],
  certificate: ['Education'],
  certificates: ['Education'],
  medical: ['Medical & Health'],
  health: ['Medical & Health'],
  bills: ['Bills & Receipts'],
  receipts: ['Bills & Receipts'],
  finance: ['Finance'],
  travel: ['Travel'],
  trip: ['Travel'],
  vacation: ['Travel'],
  screenshots: ['Screenshots'],
  screenshot: ['Screenshots'],
  python: ['Screenshots'],
  notes: ['Notes & Documents'],
};

const searchStopWords = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'my', 'of', 'show', 'the', 'where', 'find', 'containing']);

function filterImages(images, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return images;
  }

  const terms = normalizedQuery
    .split(/\s+/)
    .filter((term) => term && !searchStopWords.has(term));
  const categories = terms.flatMap((term) => searchCategoryAliases[term] || []);

  return images.filter((image) => {
    const searchableText = [
      image.filename,
      image.category,
      image.ocrText,
      image.visualDescription,
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => searchableText.includes(term)) || categories.includes(image.category);
  });
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

function cleanupImagePreviews(urls) {
  urls.forEach((item) => {
    const previewUrl = typeof item === 'string' ? item : item?.previewUrl;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  });
}
